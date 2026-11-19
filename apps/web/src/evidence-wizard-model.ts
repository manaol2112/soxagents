/**
 * The D&I evidence wizard (docs/evidence-wizard.md; the product owner's prototype, approved
 * 13 November 2026): files added on the D&I list are secured, read, sorted into the
 * control's D&I items and checked against the attributes, in one window of three steps
 * (Add files, Analyze, Results).
 *
 * Pure. The server decides everything the window shows: what was stored, what was read,
 * where each file went and what the two readings found (GET .../evidence-batches/{batch},
 * section 2.4). This module reads its answer and words it. A value it does not know falls
 * back to the cautious reading: a reading not known to have ended is still under way, a
 * placement not known is a person's to choose, a confidence not known is low, and a check
 * not known to have ended is still running (each item's check is parsed by
 * evidence-assurance-model, by the D&I list's own rules). Nothing reads as placed,
 * supported or accepted on this page's own guess, no progress is made up, and no internal
 * code reaches the screen. A file can change place between two reads (a person moved it
 * here or elsewhere): every line is worded from the latest answer, never from memory.
 */

import { lettersSpan } from "./design-evidence-model.ts";
import {
  type AssuredAttribute,
  type AssuredRequest,
  assuranceRow,
  issueDecided,
  keyedOf,
  type Lettered,
  type Passage,
  parseAssurance,
  READINGS_DISAGREE,
  RESULT_UNREAD,
  type Result,
  type ReviewView,
  requestCheck,
  uploadHeldLine,
  VERDICTS,
  type Verdict,
} from "./evidence-assurance-model.ts";
import { MAX_UPLOAD_BYTES } from "./evidence-model.ts";
import { formatBytes, formatDate } from "./format.ts";
import type { IconName } from "./icon-name.ts";
import { failureNoteOf, plainNote } from "./run-failure.ts";

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (value: unknown): string | null =>
  typeof value === "string" && UUID.test(value) ? value : null;
const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
const timeOf = (value: unknown): number | null => {
  const text = str(value);
  if (text === "") {
    return null;
  }
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : time;
};
const distinct = <T>(items: readonly T[], key: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const at = key(item);
    if (seen.has(at)) {
      return false;
    }
    seen.add(at);
    return true;
  });
};

/** "1 file", "2 files"; `many` for an irregular plural. */
export const plural = (count: number, word: string, many?: string): string =>
  `${count} ${count === 1 ? word : (many ?? `${word}s`)}`;

/** "A", "A and B", "A, B and C". */
export function listAnd(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const capital = (text: string): string =>
  text === "" ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
/** A server's sentence as a person reads it: capitalized, ending with a full stop. */
const sentence = (text: string): string => {
  const plain = capital(text.trim());
  return plain === "" || /[.!?…]$/.test(plain) ? plain : `${plain}.`;
};

// ---------------------------------------------------------------------------------------
// What the server sends (section 2.4)
// ---------------------------------------------------------------------------------------

export const READ_STATUSES = ["PENDING", "WORKING", "READY", "FAILED"] as const;
export type ReadStatus = (typeof READ_STATUSES)[number];
export type ReadMethod = "TEXT" | "OCR" | "NONE";
export const PLACEMENT_STATUSES = [
  "PLACED",
  "NEEDS_PERSON",
  "NOT_DESIGN",
  "PENDING",
] as const;
export type PlacementStatus = (typeof PLACEMENT_STATUSES)[number];
export type Confidence = "high" | "medium" | "low";

export type BatchRead = {
  status: ReadStatus;
  /** How the text was taken; NONE until the reading ends. */
  method: ReadMethod;
  pages: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** The reader's note, in a plain sentence, once the reading ended. */
  note: string;
  /** The server's failure sentence for a reading that failed, where it sent one
   * (run-failure.ts); absent otherwise. */
  failureNote?: string;
  /** Whether the reading took text from the file, on the server's word (read.text_read):
   * false for one that failed, one whose images no text recognition read, one with
   * nothing readable, and one not ended. An older server that does not say it: a reading
   * that ended READY. */
  textRead: boolean;
  /** What clears a file whose text was not read, as things stand (read.action): read it
   * again, or replace it; null where nothing does now, or its text was read. */
  action: "READ_AGAIN" | "REPLACE" | null;
};

/** A reading's one sentence when it ended without a usable answer (it failed), or null:
 * the server's failure sentence, else the reader's note, else how to go on. The file's
 * own "Read it again" sits beside it where the reading needs a person (needsFix). */
export function runFailureLine(
  read: Pick<BatchRead, "status" | "note" | "failureNote">,
  failureNote: string = read.failureNote ?? "",
): string | null {
  if (read.status !== "FAILED") {
    return null;
  }
  const said = plainNote(failureNote) || plainNote(sentence(read.note));
  return `Could not be read. ${said !== "" ? said : "Nothing from it is placed. Read it again, or add a clearer copy."}`;
}

export type Classification = {
  /** The server's word for the file's kind: shown in words (label), never as is. */
  kind: string;
  label: string;
  confidence: Confidence;
  summary: string;
};

export type Suggestion = {
  requirementId: string;
  title: string;
  reason: string;
};

export type Placement = {
  status: PlacementStatus;
  method: "AGENT" | "PERSON";
  /** The items it is placed on (PLACED only). */
  requirementIds: string[];
  reason: string;
  suggestions: Suggestion[];
  /** The version a move is made at: 0 before any placement is recorded. */
  version: number;
};

export type Address = { code: string; verdict: Verdict };

export type BatchFile = {
  fileId: string;
  name: string;
  sizeBytes: number | null;
  extension: string;
  read: BatchRead;
  /** Null until the file is read. */
  classification: Classification | null;
  placement: Placement;
  /** The attributes whose verified passages are in this file (once its items' checks are
   * reviewed): unique code and verdict pairs. */
  addresses: Address[];
  /** Already held before this session: shown where it is, and not moved here. A file
   * restored by this session is not one: it is read again as a file added now. */
  duplicate: boolean;
  /** Withdrawn from this control and restored by being dropped in this session (product
   * owner, 17 November 2026, "Restore and read"): read again, as a file added now. */
  restored: boolean;
  /** The server's word on where the file stands, where this page reads it: it left the
   * control's D&I items (NOT_DESIGN), or its reading ended (SORTED, NEEDS_PERSON,
   * FAILED, READ); "" for anything else. */
  stage: string;
};

export type BatchItem = {
  requirementId: string;
  title: string;
  /** "Request PBC-1A2B3C4D", or "Not yet requested". */
  requestTitle: string;
  letters: string[];
  fileIds: string[];
  /** The item's check (its entry of GET .../evidence-assurance); null while it has none. */
  check: AssuredRequest | null;
  /** What each file addresses in this item's own check, by file; null where the server
   * sent no such map (an older server: the file's own list stands in). */
  addresses: Record<string, Address[]> | null;
};

export type BatchStages = {
  stored: number;
  read: number;
  sorted: number;
  checkedItems: number;
  items: number;
  files: number;
};

export type BatchState = {
  batchId: string;
  controlId: string;
  /** The item the wizard was opened on (a row's Upload); null for the whole control. */
  chosenRequirementId: string | null;
  createdAt: number | null;
  /** The server's clock when it answered: elapsed time is measured on it. */
  serverNow: number | null;
  stages: BatchStages;
  files: BatchFile[];
  items: BatchItem[];
};

const KIND_LABELS: Readonly<Record<string, string>> = {
  population: "Population or listing",
  walkthrough: "Walkthrough evidence",
  design: "Design evidence",
  configuration: "Configuration or settings",
  change_history: "Change history or audit log",
  report: "Key report or query",
  policy: "Policy or procedure",
  sample: "Sample evidence",
  other: "Other",
};

/** A file's kind in words: the server's label, or its known kind's; never a code. */
function kindLabel(kind: string, label: string): string {
  const looksLikeCode = (text: string) => /^[a-z][a-z0-9_]*$/.test(text);
  if (label !== "" && !looksLikeCode(label)) {
    return label;
  }
  return KIND_LABELS[kind] ?? KIND_LABELS[label] ?? "Type not identified";
}

function parseRead(value: unknown): BatchRead {
  const raw = isRecord(value) ? value : {};
  const status = READ_STATUSES.find((item) => item === raw.status) ?? "PENDING";
  const ended = status === "READY" || status === "FAILED";
  const pages = whole(raw.pages);
  return {
    status,
    method: !ended
      ? "NONE"
      : raw.method === "OCR"
        ? "OCR"
        : raw.method === "TEXT"
          ? "TEXT"
          : "NONE",
    pages: pages !== null && pages > 0 ? pages : null,
    startedAt: timeOf(raw.started_at),
    finishedAt: ended ? timeOf(raw.finished_at) : null,
    note: ended ? str(raw.note).slice(0, 300) : "",
    textRead:
      typeof raw.text_read === "boolean"
        ? raw.text_read && status === "READY"
        : status === "READY",
    action:
      ended && (raw.action === "READ_AGAIN" || raw.action === "REPLACE")
        ? raw.action
        : null,
    ...(status === "FAILED" && failureNoteOf(raw) !== ""
      ? { failureNote: failureNoteOf(raw) }
      : {}),
  };
}

function parseClassification(
  value: unknown,
  read: BatchRead,
): Classification | null {
  // A file not read yet has no type: whatever came with it is not shown.
  if (!isRecord(value) || read.status !== "READY") {
    return null;
  }
  const kind = str(value.kind).slice(0, 40);
  const confidence: Confidence =
    value.confidence === "high" || value.confidence === "medium"
      ? value.confidence
      : "low";
  return {
    kind,
    label: kindLabel(kind, str(value.label).slice(0, 80)),
    confidence,
    summary: str(value.summary).slice(0, 300),
  };
}

function parseSuggestion(value: unknown): Suggestion | null {
  if (!isRecord(value)) {
    return null;
  }
  const requirementId = uuidOrNull(value.requirement_id);
  return requirementId === null
    ? null
    : {
        requirementId,
        title: str(value.title).slice(0, 200),
        reason: str(value.reason).slice(0, 300),
      };
}

function parsePlacement(value: unknown, read: BatchRead): Placement {
  const raw = isRecord(value) ? value : {};
  const said = PLACEMENT_STATUSES.find((item) => item === raw.status) ?? null;
  const requirementIds = distinct(
    (Array.isArray(raw.requirement_ids) ? raw.requirement_ids : [])
      .map(uuidOrNull)
      .filter((id): id is string => id !== null),
    (id) => id,
  ).slice(0, 14);
  const ended = read.status === "READY" || read.status === "FAILED";
  // A placement this page does not know is a person's to choose once the file is read,
  // and still to come before; "placed" with no item named is not taken as placed.
  const status: PlacementStatus =
    said === null
      ? ended
        ? "NEEDS_PERSON"
        : "PENDING"
      : said === "PLACED" && requirementIds.length === 0
        ? "NEEDS_PERSON"
        : said;
  return {
    status,
    method: raw.method === "PERSON" ? "PERSON" : "AGENT",
    requirementIds: status === "PLACED" ? requirementIds : [],
    reason: str(raw.reason).slice(0, 500),
    suggestions: distinct(
      (Array.isArray(raw.suggestions) ? raw.suggestions : [])
        .map(parseSuggestion)
        .filter((item): item is Suggestion => item !== null),
      (item) => item.requirementId,
    ).slice(0, 5),
    version: whole(raw.version) ?? 0,
  };
}

/** A file's extension as the server takes it: the part after the last dot. */
export function extensionOf(name: string): string {
  const at = name.lastIndexOf(".");
  if (at <= 0 || at === name.length - 1) {
    return "";
  }
  const tail = name.slice(at + 1);
  return /^[a-z0-9]{1,10}$/i.test(tail) ? tail.toLowerCase() : "";
}

/** Unique code and verdict pairs; a verdict this page does not know is a judgment. */
function parseAddresses(value: unknown): Address[] {
  return distinct(
    (Array.isArray(value) ? value : [])
      .filter(isRecord)
      .map((item) => ({
        code: str(item.code).slice(0, 8),
        verdict: VERDICTS.find((each) => each === item.verdict) ?? "UNSETTLED",
      }))
      .filter((item) => item.code !== ""),
    (item) => `${item.code}:${item.verdict}`,
  );
}

/** The server's per-file stages this page acts on: the file left the control's D&I
 * items, or its reading ended. */
const ENDED_STAGES = ["NOT_DESIGN", "SORTED", "NEEDS_PERSON", "FAILED", "READ"];

function parseFile(value: unknown): BatchFile | null {
  if (!isRecord(value)) {
    return null;
  }
  const fileId = uuidOrNull(value.file_id);
  if (fileId === null) {
    return null;
  }
  const name = str(value.name).slice(0, 200) || "A file with no name";
  const stage = ENDED_STAGES.find((item) => item === value.stage) ?? "";
  const said = parseRead(value.read);
  // Where the server's stage says the reading ended, it ended (the reading's own record
  // can lag a move made elsewhere).
  const read: BatchRead =
    stage !== "" && (said.status === "PENDING" || said.status === "WORKING")
      ? { ...said, status: stage === "FAILED" ? "FAILED" : "READY" }
      : said;
  const placement = parsePlacement(value.placement, read);
  const extension = str(value.extension).toLowerCase();
  return {
    fileId,
    name,
    sizeBytes: whole(value.size_bytes),
    extension: /^[a-z0-9]{1,10}$/.test(extension)
      ? extension
      : extensionOf(name),
    read,
    classification: parseClassification(value.classification, read),
    // A file the server says left this control's D&I items (refiled elsewhere, or out
    // of D&I) is out, whatever its last placement named.
    placement:
      stage === "NOT_DESIGN" && placement.status !== "NOT_DESIGN"
        ? { ...placement, status: "NOT_DESIGN", requirementIds: [] }
        : placement,
    addresses: parseAddresses(value.addresses),
    // A restored file stores nothing new, but it is no longer the one held as it was: it
    // goes through the stages again, so it is not shown as already held.
    duplicate: value.duplicate === true && value.restored !== true,
    restored: value.restored === true,
    stage,
  };
}

/** One file's entry: the answer to a person's placement. */
export function parseBatchFile(value: unknown): BatchFile | null {
  return parseFile(value);
}

function parseItem(value: unknown): BatchItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const requirementId = uuidOrNull(value.requirement_id);
  if (requirementId === null) {
    return null;
  }
  // The item's check is the assurance chain's entry, read by the D&I list's parser: one
  // that names no item is taken as this item's.
  const entry = isRecord(value.assurance)
    ? {
        ...value.assurance,
        requirement_id: value.assurance.requirement_id ?? requirementId,
      }
    : null;
  const check =
    entry === null
      ? null
      : (parseAssurance({ requests: [entry] })?.requests.find(
          (item) => item.requirementId === requirementId,
        ) ?? null);
  return {
    requirementId,
    title: str(value.title).slice(0, 200) || "An item of the control",
    requestTitle: str(value.request_title).slice(0, 80),
    letters: distinct(
      (Array.isArray(value.letters) ? value.letters : [])
        .map((item) => str(item).slice(0, 8))
        .filter((item) => item !== ""),
      (item) => item,
    ),
    fileIds: distinct(
      (Array.isArray(value.file_ids) ? value.file_ids : [])
        .map(uuidOrNull)
        .filter((id): id is string => id !== null),
      (id) => id,
    ),
    check,
    // { "<file_id>": [{code, verdict}] }: this item's own check only.
    addresses: isRecord(value.addresses)
      ? Object.fromEntries(
          Object.entries(value.addresses)
            .filter(([fileId]) => UUID.test(fileId))
            .map(([fileId, list]) => [fileId, parseAddresses(list)]),
        )
      : null,
  };
}

/** The batch's state (GET .../controls/{c}/evidence-batches/{b}); null when the body is
 * not one. A file or an item listed twice keeps its first entry. */
export function parseBatch(value: unknown): BatchState | null {
  if (!isRecord(value)) {
    return null;
  }
  const batchId = uuidOrNull(value.batch_id);
  if (batchId === null) {
    return null;
  }
  const files = distinct(
    (Array.isArray(value.files) ? value.files : [])
      .map(parseFile)
      .filter((item): item is BatchFile => item !== null),
    (item) => item.fileId,
  ).slice(0, 500);
  const items = distinct(
    (Array.isArray(value.items) ? value.items : [])
      .map(parseItem)
      .filter((item): item is BatchItem => item !== null),
    (item) => item.requirementId,
  );
  const stages = isRecord(value.stages) ? value.stages : {};
  const ended = (file: BatchFile) =>
    file.read.status === "READY" || file.read.status === "FAILED";
  return {
    batchId,
    controlId: uuidOrNull(value.control_id) ?? "",
    chosenRequirementId: uuidOrNull(value.chosen_requirement_id),
    createdAt: timeOf(value.created_at),
    serverNow: timeOf(value.server_now),
    // The server's counts; where it sent none, what its lists show.
    stages: {
      stored: whole(stages.stored) ?? files.length,
      read: whole(stages.read) ?? files.filter(ended).length,
      sorted:
        whole(stages.sorted) ??
        files.filter((file) => file.placement.status !== "PENDING").length,
      checkedItems:
        whole(stages.checked_items) ??
        items.filter((item) => checkEnded(item.check)).length,
      items: whole(stages.items) ?? items.length,
      files: whole(stages.files) ?? files.length,
    },
    files,
    items,
  };
}

/** A check that has ended, as the server counts them: reviewed, held or failed. */
function checkEnded(check: AssuredRequest | null): boolean {
  return (
    check !== null &&
    (check.status === "REVIEWED" ||
      check.status === "HELD" ||
      check.status === "FAILED")
  );
}

/** One wizard session, as the list of the control's recent ones shows it
 * (GET .../controls/{c}/evidence-batches): most recent first. */
export type BatchSummary = {
  batchId: string;
  createdAt: number | null;
  createdBy: string;
  chosenRequirementId: string | null;
  files: number;
  inProgress: boolean;
  needsPerson: number;
  notDesign: number;
  finished: boolean;
  finishedAt: number | null;
};

/** The control's recent wizard sessions; null when the body is not that list (an older
 * server has no such route). A session not known to have finished is in progress. */
export function parseBatchList(value: unknown): BatchSummary[] | null {
  if (!isRecord(value) || !Array.isArray(value.batches)) {
    return null;
  }
  return distinct(
    value.batches
      .filter(isRecord)
      .map((item): BatchSummary | null => {
        const batchId = uuidOrNull(item.batch_id);
        if (batchId === null) {
          return null;
        }
        const finished = item.finished === true;
        return {
          batchId,
          createdAt: timeOf(item.created_at),
          createdBy: str(item.created_by_name).slice(0, 120),
          chosenRequirementId: uuidOrNull(item.chosen_requirement_id),
          files: whole(item.files) ?? 0,
          // The server sends how many files are still under way; a count it did not
          // send is read from whether it finished.
          inProgress:
            typeof item.in_progress === "number"
              ? item.in_progress > 0
              : typeof item.in_progress === "boolean"
                ? item.in_progress
                : !finished,
          needsPerson: whole(item.needs_person) ?? 0,
          notDesign: whole(item.not_design) ?? 0,
          finished,
          finishedAt: finished ? timeOf(item.finished_at) : null,
        };
      })
      .filter((item): item is BatchSummary => item !== null),
    (item) => item.batchId,
  ).slice(0, 10);
}

/** The session the list shows a line for and reopens, so none is lost: the latest one
 * still under way or whose files still need a person, else the latest finished one; a
 * session put away with Done in this browser only while something is under way in it
 * again. The list comes latest first. */
export function batchToShow(
  list: readonly BatchSummary[],
  dismissed: ReadonlySet<string>,
): BatchSummary | null {
  const rank = (item: BatchSummary): number | null =>
    dismissed.has(item.batchId)
      ? item.inProgress
        ? 0
        : null
      : item.inProgress || item.needsPerson > 0
        ? 0
        : 1;
  let best: { item: BatchSummary; rank: number } | null = null;
  for (const item of list) {
    const at = rank(item);
    if (at !== null && (best === null || at < best.rank)) {
      best = { item, rank: at };
    }
  }
  return best?.item ?? null;
}

// ---------------------------------------------------------------------------------------
// The routes: reading a batch, a person's placement, an upload's answer
// ---------------------------------------------------------------------------------------

/** The API path behind GET /workspace/evidence-batches: one batch's state with `batch`,
 * the control's recent sessions without it; null when an id is not one. */
export function batchReadPath(params: URLSearchParams): string | null {
  const organization = params.get("organization") ?? "";
  const project = params.get("project") ?? "";
  const control = params.get("control") ?? "";
  const batch = params.get("batch") ?? "";
  if (
    ![organization, project, control].every((id) => UUID.test(id)) ||
    (batch !== "" && !UUID.test(batch))
  ) {
    return null;
  }
  const base = `/organizations/${organization}/projects/${project}/controls/${control}/evidence-batches`;
  return batch === "" ? base : `${base}/${batch}`;
}

export type PlacementWrite =
  | { error: "invalid" }
  | { path: string; body: { requirement_ids: string[]; version: number } };

/** A person's placement (POST /workspace/evidence-batches): the items the file goes to,
 * none for "not D&I evidence", at the version of the placement the person saw. */
export function placementWrite(
  fields: Record<string, unknown>,
): PlacementWrite {
  const ids = [
    "organization_id",
    "project_id",
    "control_id",
    "batch_id",
    "file_id",
  ].map((key) => str(fields[key]));
  const wanted = Array.isArray(fields.requirement_ids)
    ? fields.requirement_ids
    : null;
  const version = whole(fields.version);
  if (
    !ids.every((id) => UUID.test(id)) ||
    wanted === null ||
    wanted.length > 14 ||
    !wanted.every((id) => typeof id === "string" && UUID.test(id)) ||
    new Set(wanted).size !== wanted.length ||
    version === null
  ) {
    return { error: "invalid" };
  }
  const [organization, project, control, batch, file] = ids;
  return {
    path: `/organizations/${organization}/projects/${project}/controls/${control}/evidence-batches/${batch}/files/${file}/placement`,
    body: { requirement_ids: wanted as string[], version },
  };
}

/** What a person reads when a move did not go through; null when the server confirmed
 * it. A refusal is the server's own sentence (the placement changed, the file is still
 * being read, it is withdrawn, it may not go there). */
export function placementProblem(status: number, detail = ""): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 409) {
    return detail.trim() !== ""
      ? sentence(detail)
      : "The file could not be moved now. It is shown where it is.";
  }
  if (status === 403) {
    return "Your role cannot move evidence.";
  }
  if (status === 404) {
    return "This file is no longer part of this upload.";
  }
  if (status === 422) {
    return "That choice could not be sent. Choose again.";
  }
  return "The file could not be moved. Try again in a moment.";
}

export type UploadState =
  | "queued"
  | "sending"
  | "stored"
  | "duplicate"
  | "refused"
  | "failed";

/** One file of this session's upload, as this browser sends it. */
export type Upload = {
  key: string;
  name: string;
  folder: string;
  size: number;
  /** Bytes sent so far. */
  sent: number;
  state: UploadState;
  fileId: string | null;
  /** Why it was not added, in a sentence; "" otherwise. */
  detail: string;
  /** When the server answered it (this browser's clock): a batch read after that which
   * no longer lists the file means it is gone from this upload (removed). */
  answeredAt?: number;
  /** Withdrawn from this control earlier, and restored by this drop: read again. */
  restored?: boolean;
  /** Refused because it stays withdrawn (withdrawn from another control): its row links
   * to the withdrawn files. */
  withdrawn?: boolean;
  /** The control it was withdrawn from, as the server names it ("ITGC-AC-02 (SAP ERP)");
   * null where it was on no control, or was not refused as withdrawn. */
  withdrawnFrom?: string | null;
};

/** A file this browser stored that the server's batch, read after the file was stored,
 * no longer lists: removed from this upload (withdrawn), here or elsewhere. It is gone:
 * no row, no count, and the session can finish without it. `readAt` is when that batch
 * arrived (this browser's clock); without it the batch is taken as the latest. */
export function goneFromBatch(
  upload: Upload,
  batch: BatchState | null,
  readAt?: number | null,
): boolean {
  if (batch === null || upload.state !== "stored" || upload.fileId === null) {
    return false;
  }
  if (batch.files.some((file) => file.fileId === upload.fileId)) {
    return false;
  }
  return (
    readAt === undefined ||
    readAt === null ||
    upload.answeredAt === undefined ||
    readAt >= upload.answeredAt
  );
}

/** The files this page has seen in a session's batch, by id. */
export type SeenFiles = { batchId: string; ids: ReadonlySet<string> };

/** The files seen so far, with a new read of the batch: the same value where it adds
 * none (so no render follows), a fresh start for another session. */
export function seenFiles(
  before: SeenFiles | null,
  batch: BatchState,
): SeenFiles {
  const ids = batch.files.map((file) => file.fileId);
  if (before === null || before.batchId !== batch.batchId) {
    return { batchId: batch.batchId, ids: new Set(ids) };
  }
  return ids.every((id) => before.ids.has(id))
    ? before
    : { batchId: before.batchId, ids: new Set([...before.ids, ...ids]) };
}

/** How many files have left this upload (withdrawn), counted once each: this browser's
 * stored files the batch no longer lists (goneFromBatch), and any file this page saw in
 * the batch that it no longer lists. A session taken up again has no uploads of this
 * browser's, so counting only those read "No file has been added yet." after its last
 * file was withdrawn (E1 final design review). */
export function withdrawnCount(
  uploads: readonly Upload[],
  batch: BatchState | null,
  readAt: number | null | undefined,
  seen: SeenFiles | null,
): number {
  if (batch === null) {
    return 0;
  }
  const listed = new Set(batch.files.map((file) => file.fileId));
  const gone = new Set<string>();
  for (const upload of uploads) {
    if (upload.fileId !== null && goneFromBatch(upload, batch, readAt)) {
      gone.add(upload.fileId);
    }
  }
  if (seen !== null && seen.batchId === batch.batchId) {
    for (const id of seen.ids) {
      if (!listed.has(id)) {
        gone.add(id);
      }
    }
  }
  return gone.size;
}

/** The upload route's answer for one file, as its row's state: stored (or restored),
 * already held, refused with the server's sentence, or not reached (which can be tried
 * again). Every answer says `restored` and `withdrawn`, so an answer replaces what an
 * earlier try of the same row said. */
export function uploadAnswer(
  status: number,
  body: unknown,
): {
  state: UploadState;
  fileId: string | null;
  detail: string;
  restored: boolean;
  withdrawn: boolean;
  withdrawnFrom: string | null;
} {
  const raw = isRecord(body) ? body : {};
  const answer = (
    state: UploadState,
    fileId: string | null,
    detail: string,
  ) => ({
    state,
    fileId,
    detail,
    restored: false,
    withdrawn: false,
    withdrawnFrom: null as string | null,
  });
  const fileId = uuidOrNull(raw.file_id);
  if (status === 200 && fileId !== null) {
    // Withdrawn from this control and restored by the drop (17 November 2026): it is
    // secured and read again as a file added now, not one already held.
    if (raw.restored === true) {
      return { ...answer("stored", fileId, ""), restored: true };
    }
    return answer(raw.duplicate === true ? "duplicate" : "stored", fileId, "");
  }
  if (status === 409) {
    const said = str(raw.detail);
    return {
      ...answer(
        "refused",
        null,
        said !== ""
          ? sentence(said)
          : "The upload was refused. Start the wizard again.",
      ),
      // It stays withdrawn (withdrawn from another control): its row links to the
      // withdrawn files, where it is restored; files withdrawn from the same control
      // are said once, together (refusalBlocks).
      withdrawn: raw.withdrawn === true,
      withdrawnFrom:
        raw.withdrawn === true && str(raw.withdrawn_from) !== ""
          ? str(raw.withdrawn_from).slice(0, 200)
          : null,
    };
  }
  if (status === 413) {
    // As the upload plan and the drop zone say the limit (25 MB, decimal).
    return answer(
      "refused",
      null,
      `It is larger than ${MAX_UPLOAD_BYTES / 1_000_000} MB, so it was not added.`,
    );
  }
  if (status === 400 || status === 422) {
    return answer(
      "refused",
      null,
      "Its name or contents were not accepted, so it was not added.",
    );
  }
  if (status === 403 || status === 404) {
    return answer(
      "refused",
      null,
      "Your role cannot add evidence to this control.",
    );
  }
  return answer(
    "failed",
    null,
    "It did not reach the evidence store. Try again.",
  );
}

// ---------------------------------------------------------------------------------------
// The control's D&I items, as the wizard offers them
// ---------------------------------------------------------------------------------------

/** A D&I item of the control: where a file can go, and what the side panel shows. */
export type WizardItem = {
  requirementId: string;
  title: string;
  /** "Policy or procedure". */
  kind: string;
  icon: IconName;
  /** What its evidence shows: "Design" for a policy or procedure, "Implementation" for
   * one instance's records; "" where the category does not say. */
  shows: "Design" | "Implementation" | "";
  letters: string[];
  /** Files it holds now. */
  files: number;
  /** It still expects evidence, so a file can be placed on it. */
  choosable: boolean;
  accepted: boolean;
  /** A person can accept what it holds now (the list's own rule). */
  canAccept: boolean;
  /** Who accepted its evidence, where the plan says. */
  acceptedBy: string;
  version: number;
  /** Its files, any upload, by id: a passage in one opens there. */
  held: Array<{ id: string; name: string }>;
};

/** The requirement states a file can still be placed on (the server's own rule:
 * evidence_wizard.design_items). An empty status is an older plan body: the server
 * decides then. */
const EXPECTING = ["PLANNED", "AWAITING_DEPENDENCY", "REQUESTED", ""];

/** The list's rows and the plan's requirements, as the wizard reads them. */
export function wizardItems(
  rows: ReadonlyArray<{
    id: string;
    title: string;
    kind: string;
    icon: IconName;
    categories: readonly string[];
    letters: readonly string[];
    files: number;
    aside: boolean;
    planState: string;
    canAccept: boolean;
  }>,
  requirements: ReadonlyArray<{
    id: string;
    status: string;
    version: number;
    pendingChange: { add?: true } | null;
    sufficiencyBy: string | null;
    files: ReadonlyArray<{ fileId: string; name: string }>;
  }>,
): WizardItem[] {
  return rows.map((row) => {
    const plan = requirements.find((item) => item.id === row.id);
    const accepted = row.planState === "ACCEPTED";
    return {
      requirementId: row.id,
      title: row.title,
      kind: row.kind,
      icon: row.icon,
      shows: row.categories.includes("PROCESS_DOCUMENTATION")
        ? "Design"
        : row.categories.includes("CONTROL_EXECUTION")
          ? "Implementation"
          : "",
      letters: [...row.letters],
      files: row.files,
      choosable:
        !row.aside &&
        !accepted &&
        EXPECTING.includes(plan?.status ?? "") &&
        plan?.pendingChange?.add !== true,
      accepted,
      canAccept: row.canAccept,
      acceptedBy: plan?.sufficiencyBy ?? "",
      version: plan?.version ?? 0,
      held: (plan?.files ?? []).map((file) => ({
        id: file.fileId,
        name: file.name,
      })),
    };
  });
}

/** What the window's header says of the control and its requests. */
export type WizardContext = {
  controlRef: string;
  controlTitle: string;
  system: string;
  engagement: string;
  /** The requests the D&I items travel in, as the list's delivery lines say them: the
   * recipient ("" where nothing goes anywhere), their role, and "Due Nov 23, 2026". */
  requests: ReadonlyArray<{ to: string; role: string; due: string }>;
};

/** "Add evidence for ITGC-AC-03 Periodic User Access Review", its line ("SAP S/4HANA ·
 * SOX FY2027 · One request to Jamie Lynn Morales, due Nov 23, 2026"), and who the side
 * panel says the evidence was requested from. */
export function windowHeading(context: WizardContext): {
  title: string;
  sub: string;
  requested: { to: string; rest: string } | null;
} {
  const control = [context.controlRef, context.controlTitle]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(" ");
  const named = context.requests.filter((item) => item.to.trim() !== "");
  const first = named[0];
  const due = (text: string) =>
    text === "" ? "" : `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  const requests =
    first === undefined
      ? ""
      : named.length === 1
        ? `One request to ${first.to}${first.due !== "" ? `, ${due(first.due)}` : ""}`
        : `${named.length} requests to ${listAnd([...new Set(named.map((item) => item.to))])}`;
  return {
    title: control === "" ? "Add D&I evidence" : `Add evidence for ${control}`,
    sub: [context.system, context.engagement, requests]
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .join(" · "),
    requested:
      first === undefined
        ? null
        : {
            to: first.to,
            rest: [first.role, due(first.due)]
              .filter((part) => part !== "")
              .join(", "),
          },
  };
}

/** "The six attributes", "The 14 attributes". */
export function attributesTitle(count: number): string {
  const words = [
    "no",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
  ];
  return count === 1
    ? "The one attribute"
    : `The ${words[count] ?? String(count)} attributes`;
}

// ---------------------------------------------------------------------------------------
// A file's mark and line
// ---------------------------------------------------------------------------------------

export type MarkKind = "pdf" | "scan" | "xls" | "csv" | "doc" | "img" | "file";
/** A file's type mark: a small page with its kind on it, repeated in words. */
export type FileMark = { mark: MarkKind; label: string; type: string };

const MARKS: Readonly<Record<string, FileMark>> = {
  pdf: { mark: "pdf", label: "PDF", type: "PDF" },
  xlsx: { mark: "xls", label: "XLS", type: "Excel workbook" },
  xlsm: { mark: "xls", label: "XLS", type: "Excel workbook" },
  xls: { mark: "xls", label: "XLS", type: "Excel workbook" },
  csv: { mark: "csv", label: "CSV", type: "CSV" },
  doc: { mark: "doc", label: "DOC", type: "Word document" },
  docx: { mark: "doc", label: "DOC", type: "Word document" },
  png: { mark: "img", label: "IMG", type: "PNG image" },
  jpg: { mark: "img", label: "IMG", type: "JPEG image" },
  jpeg: { mark: "img", label: "IMG", type: "JPEG image" },
  gif: { mark: "img", label: "IMG", type: "GIF image" },
  webp: { mark: "img", label: "IMG", type: "WebP image" },
  heic: { mark: "img", label: "IMG", type: "HEIC image" },
  tif: { mark: "img", label: "IMG", type: "TIFF image" },
  tiff: { mark: "img", label: "IMG", type: "TIFF image" },
  bmp: { mark: "img", label: "IMG", type: "Bitmap image" },
  txt: { mark: "file", label: "TXT", type: "Text file" },
  msg: { mark: "file", label: "MSG", type: "Email message" },
  eml: { mark: "file", label: "EML", type: "Email message" },
  ppt: { mark: "file", label: "PPT", type: "PowerPoint deck" },
  pptx: { mark: "file", label: "PPT", type: "PowerPoint deck" },
  zip: { mark: "file", label: "ZIP", type: "ZIP archive" },
};

/** A PDF whose text was recognised from scanned pages reads as a scan: the server's
 * reading method says so once the reading ends. */
export function fileMark(
  name: string,
  extension = "",
  method: ReadMethod = "NONE",
): FileMark {
  const ext = (extension || extensionOf(name)).toLowerCase();
  const known = MARKS[ext];
  if (known?.mark === "pdf" && method === "OCR") {
    return { mark: "scan", label: "SCAN", type: "Scanned PDF" };
  }
  if (known !== undefined) {
    return known;
  }
  return ext === ""
    ? { mark: "file", label: "FILE", type: "File" }
    : {
        mark: "file",
        label: ext.slice(0, 4).toUpperCase(),
        type: `${ext.toUpperCase()} file`,
      };
}

/** "PDF · 1.2 MB · 14 pages": each part only where it is known. */
export function fileMeta(
  mark: FileMark,
  size: number | null,
  pages: number | null = null,
): string {
  return [
    mark.type,
    size === null ? "" : formatBytes(size),
    pages === null ? "" : plural(pages, "page"),
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

const CONFIDENCE_WORDS: Record<Confidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

// ---------------------------------------------------------------------------------------
// Step 1: the files queued
// ---------------------------------------------------------------------------------------

export type Queued = {
  key: string;
  name: string;
  folder: string;
  size: number;
  /** Why it will not be sent ("Larger than 25 MB", "Already in the list"); "" when it
   * will be. */
  skipped: string;
};

/** The queue's head: "7 files ready" and "8.0 MB in all", of the files that will go. */
export function queueHead(queue: readonly Queued[]): {
  title: string;
  size: string;
} {
  const going = queue.filter((item) => item.skipped === "");
  return {
    title: `${plural(going.length, "file")} ready`,
    size: `${formatBytes(going.reduce((sum, item) => sum + item.size, 0))} in all`,
  };
}

/** The primary action on Add files: "Analyze 7 files", or why there is none. */
export function analyzeLabel(queue: readonly Queued[]): {
  label: string;
  ready: boolean;
} {
  const going = queue.filter((item) => item.skipped === "").length;
  if (going > 0) {
    return { label: `Analyze ${plural(going, "file")}`, ready: true };
  }
  return {
    label:
      queue.length === 0 ? "Add files to analyze" : "No file here can be added",
    ready: false,
  };
}

/** The same file queued twice (name, folder and size) goes once. */
export function withoutRepeats(
  current: readonly Queued[],
  added: readonly Queued[],
): Queued[] {
  const seen = new Set(
    current
      .filter((item) => item.skipped === "")
      .map((item) => `${item.folder}/${item.name}:${item.size}`),
  );
  return [
    ...current,
    ...added.map((item) => {
      const at = `${item.folder}/${item.name}:${item.size}`;
      if (item.skipped !== "") {
        return item;
      }
      if (seen.has(at)) {
        return { ...item, skipped: "Already in the list" };
      }
      seen.add(at);
      return item;
    }),
  ];
}

// ---------------------------------------------------------------------------------------
// Step 2: each file's row
// ---------------------------------------------------------------------------------------

/** A track segment: Secured, Read, Classified, Sorted. */
export type TrackState = "wait" | "active" | "done" | "failed" | "needs";

export type Choice = { value: string; label: string };
/** The choice that keeps a file out of the D&I items. */
export const OUT = "out";
export const OUT_LABEL = "Not D&I evidence: keep in the control’s files";

export type Destination =
  | {
      kind: "placed";
      titles: string[];
      /** "your choice", "placed by a person", or "". */
      note: string;
    }
  | {
      kind: "needs";
      reason: string;
      choices: Choice[];
      /** The choice selected first: the agent's first suggestion, or none. */
      preselect: string;
      /** The action the reason names, offered beside the choice: confirm the file's
       * kind, or read it again; null where it names none. */
      fix: NeedsFix | null;
    }
  | { kind: "out"; note: string; reason: string };

/** What a "Needs you" reason asks a person to do first (the reading's own actions). */
export type NeedsFix = "confirm-kind" | "reread";

/** The action a file that needs a person can take in place: confirming its kind where
 * the reader was not sure of it, reading it again where its reading failed or the server
 * says reading it again can read it now (read.action; design review, 18 November 2026:
 * the reason's words offered it while text recognition was not available). */
export function needsFix(file: BatchFile): NeedsFix | null {
  if (file.placement.status !== "NEEDS_PERSON") {
    return null;
  }
  if (file.read.status === "FAILED" || file.read.action === "READ_AGAIN") {
    return "reread";
  }
  return /\bconfirm its kind\b/i.test(file.placement.reason)
    ? "confirm-kind"
    : null;
}

/** A file whose reading ended with none of its text read, on its own reading's word
 * (before it is placed as after). */
const textNotReadOf = (file: BatchFile): boolean =>
  readEnded(file) && !file.read.textRead;

export type FileLine = {
  key: string;
  fileId: string | null;
  name: string;
  folder: string;
  mark: FileMark;
  meta: string;
  track: [TrackState, TrackState, TrackState, TrackState];
  /** The track's step names: Secured, Read, Classified, then Sorted, or "Needs you"
   * while a person must place the file (one meaning for Sorted: placed or ruled out). */
  trackLabels: [string, string, string, string];
  /** It never reached the evidence store (refused, or not reached): the row shows one
   * red "Not added" chip in place of the track. */
  notAdded: boolean;
  /** The share of its bytes sent, while it is being sent. */
  sent: number | null;
  /** What is happening to it now, in words; null once it is sorted. */
  activity: {
    text: string;
    on: boolean;
    /** "note": the reason a file was not added, beside its red "Not added" chip. */
    tone: "plain" | "warning" | "danger" | "note";
  } | null;
  kind: { label: string; confidence: string; low: boolean } | null;
  dest: Destination | null;
  /** From a row: a better fit the reader is sure of; nothing moves without a person. */
  suggestion: { requirementId: string; text: string } | null;
  /** Already held: shown where it is, with no action here. */
  duplicate: boolean;
  /** Withdrawn from this control and restored by this drop: read again as a file added
   * now (product owner, 17 November 2026). */
  restored: boolean;
  /** Not added because it stays withdrawn (withdrawn from another control): the row
   * offers the way to the withdrawn files (withdrawnFilesHref). */
  withdrawn: boolean;
  /** The control it was withdrawn from, when it stays withdrawn; else null. */
  withdrawnFrom: string | null;
  /** Set when two or more rows were refused for the same reason (withdrawn from the same
   * control): the reason and the link are said once, above them (refusalBlocks), and
   * the row shows only its name, its size and its "Not added" chip. Null otherwise. */
  group: string | null;
  /** It did not reach the server: it can be sent again. */
  retry: boolean;
  /** A person can move it here: its own file of this upload, read. */
  movable: boolean;
  version: number;
  /** The items it is placed on. */
  on: string[];
  /** The upload's own row, where this browser sent it. */
  upload: Upload | null;
  file: BatchFile | null;
};

/** A file's Read step where none of its text was read (amber, never a tick). */
export const NOT_READ_STEP = "Not read";

/** Past this, a reading still under way says it is taking longer than usual. */
export const STALLED_AFTER_MS = 180_000;

/** Facts the rows are worded with. `now` is the server's clock. */
export type RowFacts = {
  items: readonly WizardItem[];
  chosenRequirementId: string | null;
  /** The session was opened in this browser, so a row's choice is the person's own. */
  mine: boolean;
  now: number;
  /** Suggestions a person set aside with "Leave it". */
  leftAlone?: ReadonlySet<string>;
  /** When the batch arrived (this browser's clock): see goneFromBatch. */
  readAt?: number | null;
};

const readEnded = (file: BatchFile): boolean =>
  file.read.status === "READY" || file.read.status === "FAILED";

function titleOf(
  id: string,
  batch: BatchState | null,
  items: readonly WizardItem[],
): string {
  return (
    batch?.items.find((item) => item.requirementId === id)?.title ??
    items.find((item) => item.requirementId === id)?.title ??
    "an item of the control"
  );
}

/** Where a file a person must place can go: the agent's suggestions first (the first
 * marked suggested), then the control's other items that still expect evidence, then
 * "not D&I evidence". */
export function choicesFor(
  file: BatchFile,
  items: readonly WizardItem[],
  batch: BatchState | null,
): { choices: Choice[]; preselect: string } {
  const open = items.filter((item) => item.choosable);
  const suggested = file.placement.suggestions.filter(
    (item) =>
      open.some((each) => each.requirementId === item.requirementId) ||
      items.length === 0,
  );
  const choices: Choice[] = [
    ...suggested.map((item, at) => ({
      value: item.requirementId,
      label: `${item.title || titleOf(item.requirementId, batch, items)}${at === 0 ? " (suggested)" : ""}`,
    })),
    ...open
      .filter(
        (item) =>
          !suggested.some((each) => each.requirementId === item.requirementId),
      )
      .map((item) => ({ value: item.requirementId, label: item.title })),
    { value: OUT, label: OUT_LABEL },
  ];
  return { choices, preselect: suggested[0]?.requirementId ?? "" };
}

/** A restored file before its new reading starts. */
export const RESTORED_WAITING =
  "Restored from the withdrawn files. Waiting for a reader";
/** Said after a restored file's type and size, for as long as its row is shown. */
export const RESTORED_META = "Restored";
/** The link a row refused because the file stays withdrawn offers. */
export const WITHDRAWN_LINK = "Open withdrawn files";
/** The chip a row that never reached the evidence store shows in place of its track. */
export const NOT_ADDED_CHIP = "Not added";
/** The track's last step while a person must place the file. */
export const NEEDS_YOU_STEP = "Needs you";

/** The Evidence library's Withdrawn list, searched for the file: where a file withdrawn
 * from another control is restored (Evidence, Evidence library, Withdrawn). The page's
 * own address for that view (evidence-model parseEvidenceView: tab, queue, q). */
export function withdrawnFilesHref(
  organizationId: string,
  projectId: string,
  fileName: string,
): string {
  const params = new URLSearchParams({
    organization: organizationId,
    project: projectId,
    section: "evidence",
    tab: "files",
    queue: "withdrawn",
  });
  const query = fileName.trim().slice(0, 120);
  if (query !== "") {
    params.set("q", query);
  }
  return `/?${params.toString()}`;
}

function activityOf(
  upload: Upload | null,
  file: BatchFile | null,
  now: number,
): FileLine["activity"] {
  if (file === null) {
    if (upload === null) {
      return null;
    }
    switch (upload.state) {
      case "queued":
        return { text: "Waiting to be secured", on: false, tone: "plain" };
      case "sending":
        return upload.sent < upload.size
          ? {
              text: `Securing the file and its custody record · ${formatBytes(upload.sent)} of ${formatBytes(upload.size)}`,
              on: true,
              tone: "plain",
            }
          : {
              text: "Storing the file and its custody record",
              on: true,
              tone: "plain",
            };
      case "stored":
        return {
          text:
            upload.restored === true
              ? RESTORED_WAITING
              : "Secured. Waiting for a reader",
          on: false,
          tone: "plain",
        };
      case "duplicate":
        return {
          text: "Already added earlier, so it was not added again",
          on: false,
          tone: "plain",
        };
      default:
        // The row's "Not added" chip says what happened; this is only the reason.
        return {
          text: upload.detail,
          on: false,
          tone: "note",
        };
    }
  }
  if (file.duplicate) {
    return {
      text: "Already added earlier: shown where it is",
      on: false,
      tone: "plain",
    };
  }
  const read = file.read;
  if (read.status === "PENDING") {
    return {
      text: file.restored ? RESTORED_WAITING : "Secured. Waiting for a reader",
      on: false,
      tone: "plain",
    };
  }
  if (read.status === "WORKING") {
    if (read.startedAt !== null && now - read.startedAt > STALLED_AFTER_MS) {
      return {
        text: "Still reading: this file is taking longer than usual",
        on: true,
        tone: "warning",
      };
    }
    return {
      text:
        read.pages !== null
          ? `Reading ${plural(read.pages, "page")}`
          : "Reading the file",
      on: true,
      tone: "plain",
    };
  }
  if (read.status === "FAILED") {
    return {
      text: runFailureLine(read) ?? "",
      on: false,
      tone: "danger",
    };
  }
  return file.placement.status === "PENDING"
    ? { text: "Sorting", on: true, tone: "plain" }
    : null;
}

function trackOf(
  upload: Upload | null,
  file: BatchFile | null,
  /** None of its text was read, as an item's check says it: its Read step is amber. */
  notRead = false,
): FileLine["track"] {
  const secured: TrackState =
    file !== null
      ? "done"
      : upload === null || upload.state === "queued"
        ? "wait"
        : upload.state === "sending"
          ? "active"
          : upload.state === "refused" || upload.state === "failed"
            ? "failed"
            : "done";
  if (file === null) {
    return [secured, "wait", "wait", "wait"];
  }
  const status = file.read.status;
  const read: TrackState =
    status === "READY"
      ? notRead
        ? "needs"
        : "done"
      : status === "FAILED"
        ? "failed"
        : status === "WORKING"
          ? "active"
          : "wait";
  const classified: TrackState =
    status === "READY" ? "done" : status === "FAILED" ? "failed" : "wait";
  const placement = file.placement.status;
  const sorted: TrackState = !readEnded(file)
    ? "wait"
    : placement === "PENDING"
      ? "active"
      : placement === "NEEDS_PERSON"
        ? "needs"
        : "done";
  return [secured, read, classified, sorted];
}

function destinationOf(
  file: BatchFile,
  batch: BatchState | null,
  facts: RowFacts,
): Destination | null {
  // Where it went is said once its reading ended (the agent sorts as it reads), or at
  // once for a file already held.
  if (!readEnded(file) && !file.duplicate) {
    return null;
  }
  const placement = file.placement;
  if (placement.status === "PLACED") {
    const chosen =
      facts.chosenRequirementId !== null &&
      placement.requirementIds.includes(facts.chosenRequirementId);
    return {
      kind: "placed",
      titles: placement.requirementIds.map((id) =>
        titleOf(id, batch, facts.items),
      ),
      note:
        placement.method !== "PERSON"
          ? ""
          : chosen && placement.version <= 1
            ? facts.mine
              ? "your choice"
              : "chosen on its row"
            : // Moved by a person: here, or elsewhere (the Evidence center, the list).
              "placed by a person",
    };
  }
  if (placement.status === "NOT_DESIGN") {
    return {
      kind: "out",
      note: placement.method === "PERSON" ? "kept out by a person" : "",
      reason: placement.reason,
    };
  }
  if (placement.status === "NEEDS_PERSON") {
    const { choices, preselect } = choicesFor(file, facts.items, batch);
    return {
      kind: "needs",
      reason:
        placement.reason !== ""
          ? sentence(placement.reason)
          : "The agent could not tell where it goes. Choose where it goes.",
      choices,
      preselect,
      fix: needsFix(file),
    };
  }
  return null;
}

function suggestionOf(
  file: BatchFile,
  batch: BatchState | null,
  facts: RowFacts,
): FileLine["suggestion"] {
  const placement = file.placement;
  if (
    file.duplicate ||
    placement.status !== "PLACED" ||
    placement.method !== "PERSON" ||
    !readEnded(file) ||
    facts.leftAlone?.has(file.fileId) === true
  ) {
    return null;
  }
  const better = placement.suggestions.find(
    (item) =>
      !placement.requirementIds.includes(item.requirementId) &&
      facts.items.some(
        (each) => each.requirementId === item.requirementId && each.choosable,
      ),
  );
  if (better === undefined) {
    return null;
  }
  return {
    requirementId: better.requirementId,
    text:
      better.reason !== ""
        ? better.reason
        : `Move it to ${better.title || titleOf(better.requirementId, batch, facts.items)}?`,
  };
}

/** Every file of the session in the order it was added: this browser's uploads first
 * (each with the server's entry once it has one), then the server's files no upload here
 * sent (reopened later, or from another device). */
export function fileLines(
  uploads: readonly Upload[],
  batch: BatchState | null,
  facts: RowFacts,
): FileLine[] {
  const byId = new Map((batch?.files ?? []).map((file) => [file.fileId, file]));
  const sent = new Set<string>();
  const line = (upload: Upload | null, file: BatchFile | null): FileLine => {
    const name = file?.name ?? upload?.name ?? "A file";
    const mark = fileMark(name, file?.extension ?? "", file?.read.method);
    const size = file?.sizeBytes ?? upload?.size ?? null;
    const restored = file?.restored ?? upload?.restored === true;
    const meta = fileMeta(mark, size, file?.read.pages ?? null);
    return {
      key: upload?.key ?? `file-${file?.fileId ?? name}`,
      fileId: file?.fileId ?? upload?.fileId ?? null,
      name,
      folder: upload?.folder ?? "",
      mark,
      meta: restored ? [meta, RESTORED_META].filter(Boolean).join(" · ") : meta,
      track: trackOf(upload, file, file !== null && textNotReadOf(file)),
      trackLabels: [
        "Secured",
        file !== null && textNotReadOf(file) ? NOT_READ_STEP : "Read",
        "Classified",
        file !== null &&
        file.placement.status === "NEEDS_PERSON" &&
        readEnded(file)
          ? NEEDS_YOU_STEP
          : "Sorted",
      ],
      notAdded:
        file === null &&
        (upload?.state === "refused" || upload?.state === "failed"),
      sent:
        file === null && upload?.state === "sending" && upload.size > 0
          ? Math.min(1, upload.sent / upload.size)
          : null,
      activity: activityOf(upload, file, facts.now),
      kind:
        file === null || file.read.status !== "READY"
          ? null
          : file.classification === null
            ? { label: "Type not identified", confidence: "", low: true }
            : {
                label: file.classification.label,
                confidence: CONFIDENCE_WORDS[file.classification.confidence],
                low: file.classification.confidence === "low",
              },
      dest: file === null ? null : destinationOf(file, batch, facts),
      suggestion: file === null ? null : suggestionOf(file, batch, facts),
      duplicate: file?.duplicate ?? upload?.state === "duplicate",
      restored,
      withdrawn:
        file === null &&
        upload?.state === "refused" &&
        upload.withdrawn === true,
      withdrawnFrom:
        file === null &&
        upload?.state === "refused" &&
        upload.withdrawn === true
          ? (upload.withdrawnFrom ?? null)
          : null,
      group: null,
      retry: file === null && upload?.state === "failed",
      // A file already held stays where it is, unless it needs a person: then the
      // person chooses here, where the list sends them.
      movable:
        file !== null &&
        readEnded(file) &&
        (!file.duplicate || file.placement.status === "NEEDS_PERSON"),
      version: file?.placement.version ?? 0,
      on: file?.placement.requirementIds ?? [],
      upload,
      file,
    };
  };
  const lines = uploads.flatMap((upload) => {
    // Removed from this upload: gone, here and in every count.
    if (goneFromBatch(upload, batch, facts.readAt)) {
      return [];
    }
    const file =
      upload.fileId === null ? null : (byId.get(upload.fileId) ?? null);
    // The same file added twice is one entry: the second upload reads as already held.
    if (file !== null && sent.has(file.fileId)) {
      return [line({ ...upload, state: "duplicate", restored: false }, null)];
    }
    if (file !== null) {
      sent.add(file.fileId);
    }
    return [line(upload, file)];
  });
  for (const file of batch?.files ?? []) {
    if (!sent.has(file.fileId)) {
      lines.push(line(null, file));
    }
  }
  return groupRefusals(lines);
}

/** The key two refused rows share when one sentence says why for both: withdrawn from
 * the same named control. A file withdrawn before it was filed, or refused for any other
 * reason, keeps its own sentence. */
function refusalKey(line: FileLine): string | null {
  return line.withdrawn && line.withdrawnFrom !== null
    ? `withdrawn:${line.withdrawnFrom}`
    : null;
}

function groupRefusals(lines: FileLine[]): FileLine[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = refusalKey(line);
    if (key !== null) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return lines.map((line) => {
    const key = refusalKey(line);
    return key !== null && (counts.get(key) ?? 0) > 1
      ? { ...line, group: key }
      : line;
  });
}

/** The control ref a Withdrawn list is searched by ("ITGC-AC-02" of "ITGC-AC-02 (SAP
 * ERP)"): the list matches it in its control column (evidence-model filterWithdrawn). */
export function withdrawnQuery(withdrawnFrom: string): string {
  const at = withdrawnFrom.indexOf(" (");
  return (at > 0 ? withdrawnFrom.slice(0, at) : withdrawnFrom).trim();
}

/** A run of rows as a list shows them: a row, or a group of rows refused for one reason,
 * said once above them with one link to the withdrawn files of that control. */
export type RefusalBlock =
  | { kind: "line"; key: string; line: FileLine }
  | {
      kind: "group";
      key: string;
      /** "9 files were withdrawn from ITGC-AC-02 (SAP ERP). Restoring them returns
       * them to that control, not this one." */
      note: string;
      /** What the Withdrawn list is searched for (the control's ref). */
      query: string;
      lines: FileLine[];
    };

/** The rows in their order, each group of refused rows gathered where its first row is,
 * with its one sentence and its one link. */
export function refusalBlocks(lines: readonly FileLine[]): RefusalBlock[] {
  const blocks: RefusalBlock[] = [];
  const groups = new Map<string, Extract<RefusalBlock, { kind: "group" }>>();
  for (const line of lines) {
    if (line.group === null || line.withdrawnFrom === null) {
      blocks.push({ kind: "line", key: line.key, line });
      continue;
    }
    const known = groups.get(line.group);
    if (known !== undefined) {
      known.lines.push(line);
      continue;
    }
    const block: Extract<RefusalBlock, { kind: "group" }> = {
      kind: "group",
      key: `group-${line.key}`,
      note: "",
      query: withdrawnQuery(line.withdrawnFrom),
      lines: [line],
    };
    groups.set(line.group, block);
    blocks.push(block);
  }
  for (const block of groups.values()) {
    const from = block.lines[0]?.withdrawnFrom ?? "";
    block.note = `${block.lines.length} files were withdrawn from ${from}. Restoring them returns them to that control, not this one.`;
  }
  return blocks;
}

// ---------------------------------------------------------------------------------------
// Step 2: the pipeline, the elapsed time and the estimate
// ---------------------------------------------------------------------------------------

/** A stage's state; "problem" where it ended with nothing done (the Secure stage when no
 * file was secured): red, never the done tick; "partial" where it ended with something
 * left for a person (files not added, files to place): amber (docs/design-system.md, the
 * meaning map). */
export type StageState = "wait" | "active" | "done" | "partial" | "problem";

export type StageLine = {
  key: "secure" | "read" | "sort" | "check";
  name: string;
  state: StageState;
  /** "Read 3 of 7". */
  count: string;
  /** "1 needs you", "1 not added": said after the count; "" otherwise. */
  flag: string;
};

/** After the last reading ends, a check not queued yet is waited for this long. */
export const CHECK_GRACE_MS = 60_000;

/** Where the whole session stands, from the server's records and this browser's uploads.
 * `now` is the server's clock. */
export type Progress = {
  /** Files the session holds or is still sending. */
  files: number;
  secured: number;
  notAdded: number;
  read: number;
  sorted: number;
  needs: number;
  notDesign: number;
  placed: number;
  items: number;
  /** Items whose check gave a verdict: reviewed. A held one is not checked (design
   * review, 18 November 2026: "Checked 1 of 1 item" sat over "Not checked"). */
  checked: number;
  /** Files whose reading ended but none of whose text was read, as an item's check
   * says it (held, or checked without them): never counted as read. */
  notRead: number;
  /** Items whose check ended, or will not come, without a verdict and without failing:
   * held, or not checked; counted once the session's work is over. */
  unchecked: number;
  /** Of the files not read, those on the items not checked. */
  notReadUnchecked: number;
  /** Items whose check did not finish (FAILED, e.g. no model): never counted as checked,
   * and never shown as done (design review round 4, 18 November 2026). */
  failedChecks: number;
  /** Items whose check is queued, at work, or about to be queued: exactly. */
  checkingItems: number;
  uploading: boolean;
  /** Something is being read or sorted. */
  reading: boolean;
  /** An item's check is queued or at work, or about to be queued. */
  checking: boolean;
  done: boolean;
  /** The session ended with no file added: every file it sent was refused or did not
   * reach the server. Its stages, its finished line and its footer all say so. */
  nothingAdded: boolean;
  stages: StageLine[];
};

function lastRead(batch: BatchState | null): number | null {
  const times = (batch?.files ?? [])
    .map((file) => file.read.finishedAt)
    .filter((time): time is number => time !== null);
  return times.length === 0 ? null : Math.max(...times);
}

/** When the reading of the session's files began, on the server's clock: the earliest
 * reading start; null before any file's reading started. */
export function firstRead(batch: BatchState | null): number | null {
  const times = (batch?.files ?? [])
    .map((file) => file.read.startedAt)
    .filter((time): time is number => time !== null);
  return times.length === 0 ? null : Math.min(...times);
}

/** A pause between readings longer than this is time nobody worked: files added later. */
export const IDLE_AFTER_MS = 5 * 60 * 1000;

/** The pauses between the session's readings, on the server's clock: from the end of one
 * run of readings to the start of the next, where nothing was read for IDLE_AFTER_MS. Files
 * dropped into a session 12 minutes apart, each read in under a second, read "Analyzed in
 * 23 min 43 s" (E1 design review, round 10). */
export function idleGaps(batch: BatchState | null): Array<[number, number]> {
  const runs = (batch?.files ?? [])
    .map((file) => file.read)
    .filter(
      (read): read is BatchRead & { startedAt: number } =>
        read.startedAt !== null,
    )
    .map((read): [number, number] => [
      read.startedAt,
      read.finishedAt ?? Number.POSITIVE_INFINITY,
    ])
    .sort((one, two) => one[0] - two[0]);
  const gaps: Array<[number, number]> = [];
  let end = Number.NEGATIVE_INFINITY;
  for (const [from, to] of runs) {
    if (from - end > IDLE_AFTER_MS && end !== Number.NEGATIVE_INFINITY) {
      gaps.push([end, from]);
    }
    end = Math.max(end, to);
  }
  return gaps;
}

/** An item's check still to come: queued or at work, or not queued yet within a minute
 * of its last file's reading (the server queues it once the batch is read). */
function checkComing(
  item: BatchItem,
  batch: BatchState | null,
  now: number,
): boolean {
  const status = item.check?.status ?? null;
  if (status === "QUEUED" || status === "CHECKING") {
    return true;
  }
  if (status === null || status === "NOT_CHECKED" || status === "OUT_OF_DATE") {
    // The server queues the items' checks once the batch's last file is read: while any
    // is still being read, the check is still to come.
    if ((batch?.files ?? []).some((file) => !readEnded(file))) {
      return true;
    }
    const last = lastRead(batch);
    return last === null ? status === null : now - last < CHECK_GRACE_MS;
  }
  return false;
}

export function progressOf(
  every: readonly Upload[],
  batch: BatchState | null,
  now: number,
  /** When the batch arrived (this browser's clock): see goneFromBatch. */
  readAt?: number | null,
): Progress {
  // A file removed from this upload is gone: it holds nothing back.
  const uploads = every.filter((item) => !goneFromBatch(item, batch, readAt));
  const files = batch?.files ?? [];
  const known = new Set(files.map((file) => file.fileId));
  const sending = uploads.filter(
    (item) => item.state === "queued" || item.state === "sending",
  );
  // Stored by the server, not in its answer yet: still to read.
  const arriving = uploads.filter(
    (item) =>
      item.state === "stored" &&
      item.fileId !== null &&
      !known.has(item.fileId),
  );
  const total = files.length + sending.length + arriving.length;
  // This browser's uploads where it sent any; reopened, the server's stored files.
  const secureTotal = uploads.length > 0 ? uploads.length : files.length;
  const secured =
    uploads.length > 0
      ? uploads.filter(
          (item) => item.state === "stored" || item.state === "duplicate",
        ).length
      : files.length;
  const notAdded = uploads.filter(
    (item) => item.state === "refused" || item.state === "failed",
  ).length;
  const read = files.filter(readEnded).length;
  // A file none of whose text was read, on its own reading's word: its reading ended,
  // but it was not read, before it is placed as after (design review, 18 November 2026).
  const notRead = files.filter(textNotReadOf).length;
  const sorted = files.filter(
    (file) => readEnded(file) && file.placement.status !== "PENDING",
  ).length;
  // A file already held that needs a person counts too: it is chosen here.
  const needs = files.filter(
    (file) => readEnded(file) && file.placement.status === "NEEDS_PERSON",
  ).length;
  const notDesign = files.filter(
    (file) => readEnded(file) && file.placement.status === "NOT_DESIGN",
  ).length;
  const placed = files.filter(
    (file) => readEnded(file) && file.placement.status === "PLACED",
  ).length;
  const items = batch?.items ?? [];
  const failedChecks = items.filter(
    (item) => item.check?.status === "FAILED",
  ).length;
  // A failed check ended, but it gave no verdict: it is not "checked"; nor is a held one.
  const checked = items.filter(
    (item) => item.check?.status === "REVIEWED",
  ).length;
  const uploading = sending.length > 0;
  const reading =
    arriving.length > 0 ||
    files.some(
      (file) => !readEnded(file) || file.placement.status === "PENDING",
    );
  const coming = items.filter((item) => checkComing(item, batch, now));
  const checking = coming.length > 0;
  const allSorted = !uploading && !reading;
  const done = allSorted && !checking && (batch !== null || uploads.length > 0);
  // Once nothing is still to come: the items neither checked nor failed (held, or never
  // checked) are said as not checked, amber, never as done.
  const uncheckedItems =
    allSorted && !checking
      ? items.filter(
          (item) =>
            item.check?.status !== "REVIEWED" &&
            item.check?.status !== "FAILED",
        )
      : [];
  const unchecked = uncheckedItems.length;
  // Of the files not read, those on the items not checked: what the finish names.
  const onUnchecked = new Set(uncheckedItems.flatMap((item) => item.fileIds));
  const notReadUnchecked = files.filter(
    (file) => textNotReadOf(file) && onUnchecked.has(file.fileId),
  ).length;
  // Nothing reached the evidence store: no stage after Secure has anything to do.
  const nothingAdded = done && total === 0 && secured === 0 && notAdded > 0;

  const secureState: StageState =
    secureTotal === 0
      ? "wait"
      : uploading
        ? "active"
        : secured === 0 && notAdded > 0
          ? "problem"
          : notAdded > 0
            ? "partial"
            : "done";
  const readState: StageState =
    total === 0
      ? "wait"
      : !uploading && arriving.length === 0 && read === files.length
        ? notRead > 0
          ? "partial"
          : "done"
        : read > 0 || files.some((file) => file.read.status === "WORKING")
          ? "active"
          : "wait";
  const sortState: StageState =
    total === 0
      ? "wait"
      : allSorted
        ? needs > 0
          ? "partial"
          : "done"
        : sorted > 0 || read > 0
          ? "active"
          : "wait";
  // With no item to check while files wait for a person, the check waits for them.
  const checkState: StageState =
    items.length === 0
      ? allSorted && total > 0 && needs === 0
        ? "done"
        : "wait"
      : allSorted && !checking
        ? failedChecks > 0
          ? "problem"
          : unchecked > 0
            ? "partial"
            : "done"
        : checked > 0 || items.some((item) => item.check?.status === "CHECKING")
          ? "active"
          : "wait";
  const stages: StageLine[] = [
    {
      key: "secure",
      name: "Secure",
      state: secureState,
      count:
        secureState === "wait"
          ? "Waiting"
          : `Secured ${secured} of ${secureTotal}`,
      flag: notAdded > 0 ? `${notAdded} not added` : "",
    },
    {
      key: "read",
      name: "Read",
      state: readState,
      count: nothingAdded
        ? "Nothing to read"
        : readState === "wait"
          ? total > 0
            ? "Waiting for a reader"
            : "Waiting"
          : `Read ${read - notRead} of ${total}`,
      flag: notRead > 0 ? `${notRead} not read` : "",
    },
    {
      key: "sort",
      name: "Classify and sort",
      state: sortState,
      count: nothingAdded
        ? "Nothing to sort"
        : sortState === "wait"
          ? "Waiting"
          : `Sorted ${sorted - needs} of ${total}`,
      flag: needs > 0 ? `${needs} ${needs === 1 ? "needs" : "need"} you` : "",
    },
    {
      key: "check",
      name: "Check against attributes",
      state: checkState,
      count:
        items.length === 0
          ? checkState === "done" || nothingAdded
            ? "No item to check"
            : allSorted && needs > 0
              ? `Waiting for ${plural(needs, "file")} to be placed`
              : "Waiting for sorted files"
          : checkState === "wait"
            ? allSorted
              ? "Waiting to start"
              : "Waiting for sorted files"
            : checkState === "problem"
              ? `${failedChecks + unchecked} of ${plural(items.length, "item")} not checked`
              : checkState === "partial" && checked === 0
                ? `${plural(unchecked, "item")} not checked`
                : `Checked ${checked} of ${plural(items.length, "item")}`,
      flag:
        checkState === "partial" && checked > 0
          ? `${unchecked} not checked`
          : "",
    },
  ];
  return {
    files: total,
    secured,
    notAdded,
    read,
    sorted,
    needs,
    notDesign,
    placed,
    items: items.length,
    checked,
    notRead,
    unchecked,
    notReadUnchecked,
    failedChecks,
    checkingItems: coming.length,
    uploading,
    reading,
    checking,
    done,
    nothingAdded,
    stages,
  };
}

/** The server's clock now, from its last answer: the time it said, plus the time since
 * that answer arrived here. Without an answer, this browser's clock. */
export function serverClock(
  serverNow: number | null,
  receivedAt: number | null,
  now: number,
): number {
  return serverNow === null || receivedAt === null
    ? now
    : serverNow + (now - receivedAt);
}

/** When the session's work ended, on the server's clock: its last reading or its items'
 * last check; null where the server sent neither. */
export function finishedAt(batch: BatchState | null): number | null {
  const last = lastRead(batch);
  const checks = (batch?.items ?? [])
    .map((item) =>
      item.check?.finishedAt === null || item.check?.finishedAt === undefined
        ? null
        : timeOf(item.check.finishedAt),
    )
    // A check finished long after the session's last reading was run again later (an
    // acceptance reopened, a re-check): it is not this session's analysis, and counting
    // it made "Analyzed in" read 11:44:30 for a session of 44 seconds (E1 design review,
    // round 9).
    .filter(
      (time): time is number =>
        time !== null && (last === null || time - last <= RECHECK_AFTER_MS),
    );
  const all = [...checks, ...(last === null ? [] : [last])];
  return all.length === 0 ? null : Math.max(...all);
}

/** How long after a session's last reading an item's check can still be its own. */
export const RECHECK_AFTER_MS = 15 * 60 * 1000;

/** A duration as a person says it: "48 s", "2 min 5 s", "1 h 4 min" (never a clock
 * time: "Analyzed in 11:44:30" read as one; E1 design review, round 9). */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  }
  if (minutes > 0) {
    return rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`;
  }
  return `${rest} s`;
}

/** Seconds since the session began, on the server's clock; once it is done, how long it
 * took (to its last reading or check, else to when this page saw it done). It begins
 * when this page added its first file; for a session taken up again, when its files'
 * reading began (firstRead), never when the batch was created: a session taken up an
 * hour later read "Analyzed in 1 h 28 min" for files read in seconds; and pauses between
 * its readings (idleGaps) are not counted (E1 design review, round 10). */
export function elapsedSeconds(facts: {
  createdAt: number | null;
  /** The server's clock now (serverClock). */
  now: number;
  done: boolean;
  finished: number | null;
  /** When this page added the session's first file, on its clock adjusted to the
   * server's; null for a session taken up again. */
  startedAt: number | null;
  /** The earliest reading start of the session's files (firstRead). */
  firstRead?: number | null;
  /** The pauses between its readings (idleGaps): not counted. */
  idle?: ReadonlyArray<readonly [number, number]>;
}): number {
  const start = facts.startedAt ?? facts.firstRead ?? facts.createdAt;
  if (start === null) {
    return 0;
  }
  const end =
    facts.done && facts.finished !== null && facts.finished >= start
      ? facts.finished
      : facts.now;
  const paused = (facts.idle ?? []).reduce(
    (total, [from, to]) =>
      total + Math.max(0, Math.min(to, end) - Math.max(from, start)),
    0,
  );
  return Math.max(0, Math.floor((end - start - paused) / 1000));
}

/** "0:42", "12:05", "1:02:03". */
export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}

/** A plain estimate beside the elapsed time: about 10 seconds a file to read, and 1 to
 * 3 minutes an item for its two readings. */
export function estimateText(files: number): string {
  const range =
    files <= 3
      ? "1 to 3 minutes"
      : files <= 8
        ? "2 to 4 minutes"
        : "3 to 6 minutes";
  return `Usually ${range} for ${plural(files, "file")}`;
}

/** How long until the session is read again: every 2 seconds while files are sent,
 * read or sorted, every 5 while items are checked, and not at all once nothing is under
 * way. With the window closed, every 10 seconds for the list's line. */
export function pollDelay(facts: {
  open: boolean;
  uploading: boolean;
  reading: boolean;
  checking: boolean;
}): number | null {
  const busy = facts.uploading || facts.reading || facts.checking;
  if (!facts.open) {
    return busy ? 10_000 : null;
  }
  if (facts.uploading || facts.reading) {
    return 2_000;
  }
  return facts.checking ? 5_000 : null;
}

/** What the polite live region says when the session moves on; null when nothing worth
 * saying changed. */
export function announcement(
  before: Progress | null,
  now: Progress,
): string | null {
  if (before === null) {
    return null;
  }
  if (now.done && !before.done) {
    return "Analysis finished. The results are ready.";
  }
  if (now.checked > before.checked) {
    return `Checked ${now.checked} of ${plural(now.items, "item")} against the attributes.`;
  }
  if (
    now.stages[3]?.state === "active" &&
    before.stages[3]?.state !== "active"
  ) {
    return "Checking the items against the attributes.";
  }
  if (now.needs > before.needs) {
    return `${plural(now.needs, "file")} ${now.needs === 1 ? "needs" : "need"} you: choose where ${now.needs === 1 ? "it goes" : "they go"}.`;
  }
  if (now.sorted > before.sorted) {
    return `Sorted ${now.sorted - now.needs} of ${plural(now.files, "file")}.`;
  }
  if (now.read > before.read) {
    return `Read ${now.read} of ${plural(now.files, "file")}.`;
  }
  if (now.secured > before.secured && !now.uploading) {
    return `All ${plural(now.secured, "file")} secured.`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Step 2: each item's card, its two readings drawn as lanes
// ---------------------------------------------------------------------------------------

export type Lane = { state: StageState; text: string };

export type ItemCard = {
  requirementId: string;
  title: string;
  kind: string;
  icon: IconName;
  /** "4 files". */
  count: string;
  fileNames: string[];
  status: {
    text: string;
    mode: "wait" | "on" | "done" | "held" | "failed";
  };
  /** The two readings, one after the other, then the comparison, from the check's real
   * stage; null where the check is not at work or done. */
  lanes: { first: Lane; second: Lane; compare: Lane } | null;
  /** Once the check is reviewed, its results by state: "Supported: B C D E". */
  tally: Tally[];
};

export type Tone = "success" | "danger" | "warning" | "neutral";
export type Tally = {
  key: AttrState;
  tone: Tone;
  icon: IconName;
  text: string;
};

const WAITING: Lane = { state: "wait", text: "Waiting" };
const AFTER_FIRST: Lane = { state: "wait", text: "After the first reading" };
const AFTER_BOTH: Lane = { state: "wait", text: "After both readings" };
const LANE_DONE: Lane = { state: "done", text: "Done" };

/** The lanes from the check's stage: the first reading is at work in ASSESS, the second
 * in VERIFY, the comparison in COMPARE (the server runs them one after the other). */
function lanesOf(check: AssuredRequest | null): ItemCard["lanes"] {
  const status = check?.status ?? null;
  if (status === null || status === "QUEUED" || status === "NOT_CHECKED") {
    return { first: WAITING, second: AFTER_FIRST, compare: AFTER_BOTH };
  }
  if (status === "REVIEWED") {
    return {
      first: LANE_DONE,
      second: LANE_DONE,
      compare: { state: "done", text: "Done" },
    };
  }
  if (status !== "CHECKING") {
    return null;
  }
  switch (check?.stage ?? null) {
    case "GATE":
      return {
        first: { state: "wait", text: "Starting" },
        second: AFTER_FIRST,
        compare: AFTER_BOTH,
      };
    case "ASSESS":
      return {
        first: { state: "active", text: "Reading" },
        second: AFTER_FIRST,
        compare: AFTER_BOTH,
      };
    case "VERIFY":
      return {
        first: LANE_DONE,
        second: { state: "active", text: "Reading" },
        compare: AFTER_BOTH,
      };
    case "COMPARE":
      return {
        first: LANE_DONE,
        second: LANE_DONE,
        compare: { state: "active", text: "Comparing" },
      };
    case "DONE":
      return {
        first: LANE_DONE,
        second: LANE_DONE,
        compare: { state: "active", text: "Finishing" },
      };
    default:
      // A stage this page does not know: the check is at work, which reading is not said.
      return null;
  }
}

/** The span of letters as the list says them: "A to F", "B and D". */
function spanOf(letters: readonly string[], all: readonly string[]): string {
  return lettersSpan(letters, all);
}

const against = (letters: readonly string[], all: readonly string[]) =>
  letters.length === 0
    ? "against the attributes"
    : `against attribute${letters.length === 1 ? "" : "s"} ${spanOf(letters, all)}`;

export function itemCards(
  batch: BatchState | null,
  facts: {
    items: readonly WizardItem[];
    attributes: readonly Lettered[];
    now: number;
  },
): ItemCard[] {
  const all = facts.attributes.map((item) => item.letter);
  return (batch?.items ?? []).map((item) => {
    const known = facts.items.find(
      (each) => each.requirementId === item.requirementId,
    );
    const files = (batch?.files ?? []).filter((file) =>
      item.fileIds.includes(file.fileId),
    );
    const check = item.check;
    const status = check?.status ?? null;
    const stillRead = files.some((file) => !readEnded(file));
    // The server queues the items' checks once the batch's last file is read.
    const othersRead = (batch?.files ?? []).some((file) => !readEnded(file));
    const coming = checkComing(item, batch, facts.now);
    const line = (): ItemCard["status"] => {
      if (status === "REVIEWED") {
        return {
          text: `Checked ${against(item.letters, all)}`,
          mode: "done",
        };
      }
      if (status === "CHECKING") {
        return {
          text: `Checking ${against(item.letters, all)}`,
          mode: "on",
        };
      }
      if (status === "HELD" || status === "FAILED") {
        return {
          // Held because no file's text was read: said for this upload's files, so the
          // card's count, its line and the footer agree; the rest of the request's
          // files are said apart (design review, 18 November 2026).
          text:
            (check === null
              ? null
              : uploadHeldLine(
                  check,
                  item.fileIds,
                  (fileId) =>
                    files.find((file) => file.fileId === fileId)?.name ??
                    "A file",
                )) ?? checkLine(check, facts.attributes, files),
          mode: status === "HELD" ? "held" : "failed",
        };
      }
      if (status === "OUT_OF_DATE" && !coming) {
        return {
          text: checkLine(check, facts.attributes, files),
          mode: "held",
        };
      }
      if (coming) {
        return stillRead
          ? { text: "Waiting for its files to be read", mode: "wait" }
          : othersRead
            ? { text: "Waiting for the other files to be read", mode: "wait" }
            : { text: "Waiting to start the check", mode: "wait" };
      }
      return { text: "Not checked against the attributes yet", mode: "held" };
    };
    const shown = line();
    const results =
      status === "REVIEWED"
        ? attributeRows(item, batch, {
            attributes: facts.attributes,
            items: facts.items,
          })
        : [];
    return {
      requirementId: item.requirementId,
      title: item.title,
      kind: known?.kind ?? "",
      icon: known?.icon ?? "file",
      count: plural(item.fileIds.length, "file"),
      fileNames: files.map((file) => file.name),
      status: shown,
      lanes:
        shown.mode === "held" || shown.mode === "failed"
          ? null
          : lanesOf(check),
      tally: tallyOf(results, true),
    };
  });
}

/** The check's one line where it did not finish with results: why it is held, failed,
 * or out of date, as the D&I list says it. */
function checkLine(
  check: AssuredRequest | null,
  attributes: readonly Lettered[],
  files: readonly BatchFile[],
): string {
  if (check === null) {
    return "Not checked against the attributes yet.";
  }
  return requestCheck(
    check,
    attributes,
    files.map((file) => ({ id: file.fileId, name: file.name })),
    (letters) =>
      lettersSpan(
        letters,
        attributes.map((item) => item.letter),
      ),
  ).line;
}

// ---------------------------------------------------------------------------------------
// Step 3: each attribute's result, in words with a mark
// ---------------------------------------------------------------------------------------

export type AttrState =
  | "SUPPORTED"
  | "PARTLY"
  | "NOT_SATISFIED"
  | "JUDGMENT"
  | "DECIDED"
  | "NOT_ADDRESSED"
  | "NOT_CHECKED";

/** Each state in words and with a mark: the colour repeats them and never replaces
 * them. */
export const ATTR_WORDS: Record<
  AttrState,
  { label: string; icon: IconName; tone: Tone; short: string }
> = {
  SUPPORTED: {
    label: "Supported",
    icon: "checkCircle",
    tone: "success",
    short: "Supported",
  },
  PARTLY: {
    label: "Shown in part",
    icon: "layers",
    tone: "neutral",
    short: "Shown in part",
  },
  NOT_SATISFIED: {
    label: "Not satisfied",
    icon: "xCircle",
    tone: "danger",
    short: "Not satisfied",
  },
  JUDGMENT: {
    label: "Your judgment needed",
    icon: "help",
    tone: "warning",
    short: "Your judgment",
  },
  DECIDED: {
    label: "Issue decided",
    icon: "checkCircle",
    tone: "neutral",
    short: "Issue decided",
  },
  NOT_ADDRESSED: {
    label: "Not addressed by these files",
    icon: "minusCircle",
    tone: "neutral",
    short: "Not addressed",
  },
  NOT_CHECKED: {
    label: "Not checked",
    icon: "minusCircle",
    tone: "neutral",
    short: "Not checked",
  },
};

/** What one reading found, in an auditor's words, with whether it finds it met. */
const READING_WORDS: Record<
  Result,
  { words: string; met: "met" | "part" | "not" | "unclear" }
> = {
  MET: { words: "Met", met: "met" },
  PARTLY_MET: { words: "Met in part", met: "part" },
  NOT_MET: { words: "Not met", met: "not" },
  CONTRADICTED: { words: "Contradicted by the evidence", met: "not" },
  CANNOT_TELL: { words: "Could not tell", met: "unclear" },
  NOT_ADDRESSED: { words: "Not addressed", met: "unclear" },
  SHOWN_IN_PART: { words: "Shown in part", met: "part" },
};

const READING_WHO = {
  ASSESSOR: "First reading",
  REVIEWER: "Second reading, without seeing the first",
} as const;

export type ShownQuote = {
  quote: string;
  fileId: string | null;
  fileName: string;
  location: string;
  page: number | null;
  /** The file is known here, so the viewer opens it at the passage. */
  opens: boolean;
};

export type AttributeRow = {
  key: string;
  letter: string;
  /** The attribute's wording; "" where the control no longer has it. */
  wording: string;
  state: AttrState;
  label: string;
  icon: IconName;
  tone: Tone;
  /** The result in one sentence (the server's), or why it was not checked. */
  reason: string;
  quotes: ShownQuote[];
  /** What the readings looked for and did not find. */
  missing: string[];
  /** Both readings, where they do not agree, or where both fall short differently. */
  readings: Array<{
    who: string;
    result: string;
    met: "met" | "part" | "not" | "unclear";
    reason: string;
  }>;
  findingId: string | null;
};

function stateOfAttribute(item: AssuredAttribute): AttrState {
  if (item.verdict === "SUPPORTED") {
    return "SUPPORTED";
  }
  if (item.verdict === "PARTLY_SUPPORTED") {
    return "PARTLY";
  }
  if (item.verdict === "ISSUE") {
    return issueDecided(item) ? "DECIDED" : "NOT_SATISFIED";
  }
  if (item.verdict === "NOT_ADDRESSED") {
    return "NOT_ADDRESSED";
  }
  return "JUDGMENT";
}

function labelOf(state: AttrState, item: AssuredAttribute | null): string {
  if (state === "SUPPORTED" && item?.shows === "DESIGN") {
    return "Supported (design)";
  }
  if (state === "SUPPORTED" && item?.shows === "IMPLEMENTATION") {
    return "Supported (implementation)";
  }
  // Not concluded only because a file has not been read: the file is waited on, not the
  // person's judgment (14 November 2026).
  if (state === "JUDGMENT" && item?.pending === "FILE_NOT_READ") {
    return WAITING_LABEL;
  }
  return ATTR_WORDS[state].label;
}

/** The label of an attribute that waits on a file not read yet. */
export const WAITING_LABEL = "Waiting on a file";

/** The files a passage can be in: this session's and the item's own. */
function namesFor(
  item: BatchItem,
  batch: BatchState | null,
  items: readonly WizardItem[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const file of batch?.files ?? []) {
    names.set(file.fileId, file.name);
  }
  for (const held of items.find(
    (each) => each.requirementId === item.requirementId,
  )?.held ?? []) {
    if (!names.has(held.id)) {
      names.set(held.id, held.name);
    }
  }
  return names;
}

function quotesOf(
  item: AssuredAttribute,
  names: ReadonlyMap<string, string>,
): ShownQuote[] {
  // The attribute's own passages; where it has none, those its elements rest on.
  const own: Passage[] = item.passages;
  const passages =
    own.length > 0 ? own : item.elements.flatMap((element) => element.passages);
  return distinct(passages, (p) => `${p.fileId ?? ""}:${p.location}:${p.quote}`)
    .slice(0, 2)
    .map((passage) => {
      const name =
        passage.fileId === null ? undefined : names.get(passage.fileId);
      return {
        quote: passage.quote,
        fileId: passage.fileId,
        fileName: name ?? "A file of this item",
        location: passage.location,
        page: passage.page,
        opens: name !== undefined && passage.fileId !== null,
      };
    });
}

/** One item's attributes as Results lists them: its own letters first, in the control's
 * order, each with its state; then any other attribute the files bear on. An attribute
 * the item does not ask for and the files do not bear on is left out. Before its check
 * is reviewed, each of its letters reads "Not checked". */
export function attributeRows(
  item: BatchItem,
  batch: BatchState | null,
  facts: {
    attributes: readonly Lettered[];
    items: readonly WizardItem[];
    /** The item's last reviewed check, seen earlier this session: shown while the
     * check runs again, marked as from before the change. */
    previous?: AssuredRequest | null;
  },
): AttributeRow[] {
  const check =
    item.check?.status === "REVIEWED" ? item.check : (facts.previous ?? null);
  const order = facts.attributes.map((each) => each.letter);
  const at = (letter: string) =>
    order.indexOf(letter) < 0 ? order.length : order.indexOf(letter);
  const wordingOf = (letter: string, attributeId: string) =>
    (
      facts.attributes.find((each) => each.id === attributeId) ??
      facts.attributes.find((each) => each.letter === letter)
    )?.text ?? "";
  const notChecked = (letter: string, reason: string): AttributeRow => ({
    key: `letter:${letter}`,
    letter,
    wording: wordingOf(letter, ""),
    state: "NOT_CHECKED",
    label: ATTR_WORDS.NOT_CHECKED.label,
    icon: ATTR_WORDS.NOT_CHECKED.icon,
    tone: ATTR_WORDS.NOT_CHECKED.tone,
    reason,
    quotes: [],
    missing: [],
    readings: [],
    findingId: null,
  });
  if (check === null) {
    return [...item.letters]
      .sort((a, b) => at(a) - at(b))
      .map((letter) => notChecked(letter, ""));
  }
  const names = namesFor(item, batch, facts.items);
  const letterOf = (attribute: AssuredAttribute) =>
    facts.attributes.find((each) => each.id === attribute.attributeId)
      ?.letter ?? attribute.code;
  const rows: AttributeRow[] = check.attributes
    .filter(
      (attribute) =>
        attribute.verdict !== "NOT_ADDRESSED" ||
        attribute.expected ||
        item.letters.includes(letterOf(attribute)),
    )
    .map((attribute) => {
      const letter = letterOf(attribute);
      const state = stateOfAttribute(attribute);
      const words = ATTR_WORDS[state];
      const reason =
        attribute.summary !== ""
          ? sentence(attribute.summary)
          : state === "JUDGMENT"
            ? attribute.understood
              ? READINGS_DISAGREE
              : RESULT_UNREAD
            : "";
      return {
        key:
          attribute.attributeId !== ""
            ? attribute.attributeId
            : `code:${letter}`,
        letter,
        wording: wordingOf(letter, attribute.attributeId),
        state,
        label: labelOf(state, attribute),
        icon: attribute.pending === "FILE_NOT_READ" ? "clock" : words.icon,
        tone: words.tone,
        reason,
        quotes: state === "JUDGMENT" ? [] : quotesOf(attribute, names),
        missing: state === "SUPPORTED" ? [] : attribute.absent.slice(0, 4),
        readings: attribute.views.map((view) => {
          const said = view.result === null ? null : READING_WORDS[view.result];
          return {
            who: READING_WHO[view.role],
            result: said?.words ?? "Could not tell",
            met: said?.met ?? "unclear",
            reason:
              view.reason !== "" ? sentence(view.reason) : "It gave no reason.",
          };
        }),
        findingId: attribute.findingId,
      };
    });
  // A letter of the item the reviewed check sent nothing for is said, never skipped.
  for (const letter of item.letters) {
    if (!rows.some((row) => row.letter === letter)) {
      rows.push(notChecked(letter, "The check returned no result for it."));
    }
  }
  const own = (row: AttributeRow) =>
    item.letters.includes(row.letter) ? 0 : 1;
  return rows.sort(
    (a, b) =>
      own(a) - own(b) ||
      at(a.letter) - at(b.letter) ||
      a.letter.localeCompare(b.letter),
  );
}

/** The rows' states counted: "4 supported", or with the letters, "Supported: B C D E". */
export function tallyOf(
  rows: readonly AttributeRow[],
  withLetters: boolean,
): Tally[] {
  const keys: AttrState[] = [
    "SUPPORTED",
    "PARTLY",
    "NOT_SATISFIED",
    "JUDGMENT",
    "DECIDED",
    "NOT_ADDRESSED",
    "NOT_CHECKED",
  ];
  return keys
    .map((key) => ({
      key,
      letters: rows.filter((row) => row.state === key).map((row) => row.letter),
    }))
    .filter((group) => group.letters.length > 0)
    .map(({ key, letters }) => ({
      key,
      tone: ATTR_WORDS[key].tone,
      icon: ATTR_WORDS[key].icon,
      text: withLetters
        ? `${ATTR_WORDS[key].short}: ${letters.join(" ")}`
        : `${letters.length} ${ATTR_WORDS[key].short.toLowerCase()}`,
    }));
}

// ---------------------------------------------------------------------------------------
// Step 3: the results
// ---------------------------------------------------------------------------------------

export type ItemResult = {
  requirementId: string;
  title: string;
  kind: string;
  icon: IconName;
  shows: "Design" | "Implementation" | "";
  requestTitle: string;
  letters: string[];
  /** "Policy or procedure · Design · 1 file". */
  sub: string;
  fileIds: string[];
  /** Files its check also read that came before this session. */
  earlier: number;
  /** The check is queued or at work again: what shows is from before the change. */
  rechecking: boolean;
  /** Why the check has no results, with "Check again" where the list offers it; `short`
   * is the few words the summary's "Not checked" line uses. */
  hold: { text: string; short: string; rerun: string | null } | null;
  attributes: AttributeRow[];
  tally: Tally[];
  /** The check's review of the item's evidence (docs/evidence-assurance.md, section
   * 10), read above its attributes: the proposed outcome in words with its mark, why,
   * and what to ask for next. Null for a check without one (the first engine's, or one
   * that has not finished), which reads exactly as it did. */
  review: ItemReview | null;
  accept: {
    state: "accepted" | "open" | "waiting";
    /** What accepting marks as evidenced, and what it leaves open (the list's words). */
    note: string;
  };
};

/** An item's review as the Results step shows it: the D&I list's own words. */
export type ItemReview = {
  /** "Additional evidence needed": proposed, never a conclusion. */
  label: string;
  icon: IconName;
  tone: Tone;
  explanation: string;
  /** Each follow-up's request, as the list words it. */
  followUps: Array<{ key: string; request: string }>;
  /** "2 more follow-ups are not listed here."; "" where every one is listed. */
  more: string;
};

/** The review of a finished check as the Results step shows it, or null. */
export function itemReview(review: ReviewView | null): ItemReview | null {
  return review === null
    ? null
    : {
        label: review.label,
        icon: review.icon,
        tone: review.tone,
        explanation: review.explanation,
        followUps: review.followUps.map((item) => ({
          key: item.key,
          request: item.request,
        })),
        more: review.more,
      };
}

export type ResultsSummary = {
  /** "5 of 7 files sorted into 2 items. 1 file needs you; 1 is not D&I evidence." */
  lead: string;
  lines: Array<{
    key: AttrState;
    tone: Tone;
    icon: IconName;
    label: string;
    text: string;
  }>;
};

export function itemResults(
  batch: BatchState | null,
  facts: {
    items: readonly WizardItem[];
    attributes: readonly Lettered[];
    now: number;
    previous?: Readonly<Record<string, AssuredRequest>>;
  },
): ItemResult[] {
  const letters = facts.attributes.map((item) => item.letter);
  const span = (some: readonly string[]) => lettersSpan(some, letters);
  const keyed = keyedOf({
    requests: (batch?.items ?? [])
      .map((item) => item.check)
      .filter((item): item is AssuredRequest => item !== null),
    summary: null,
  });
  return (batch?.items ?? []).map((item) => {
    const known = facts.items.find(
      (each) => each.requirementId === item.requirementId,
    );
    const status = item.check?.status ?? null;
    const coming = checkComing(item, batch, facts.now);
    const rechecking =
      coming && facts.previous?.[item.requirementId] !== undefined;
    const files = (batch?.files ?? []).filter((file) =>
      item.fileIds.includes(file.fileId),
    );
    const attributes = attributeRows(item, batch, {
      attributes: facts.attributes,
      items: facts.items,
      previous: rechecking
        ? (facts.previous?.[item.requirementId] ?? null)
        : null,
    });
    const hold: ItemResult["hold"] =
      status === "REVIEWED" || rechecking
        ? null
        : coming
          ? {
              text: "The check is still running.",
              short: "still being checked",
              rerun: null,
            }
          : {
              text: sentence(checkLine(item.check, facts.attributes, files)),
              short:
                status === "HELD"
                  ? "on hold"
                  : status === "FAILED"
                    ? "the check did not finish"
                    : status === "OUT_OF_DATE"
                      ? "out of date"
                      : "not checked yet",
              // The list's own "Check now" and "Check again" (a hold is cleared on its row).
              rerun:
                status === "FAILED" || status === "OUT_OF_DATE"
                  ? "Check again"
                  : status === "HELD"
                    ? null
                    : "Check now",
            };
    const row =
      item.check === null
        ? null
        : assuranceRow({
            requirementId: item.requirementId,
            files: files.map((file) => ({ id: file.fileId, name: file.name })),
            assurance: { requests: [item.check], summary: null },
            attributes: facts.attributes,
            span,
            keyed,
          });
    const accepted = known?.accepted === true;
    const kind = known?.kind ?? "";
    const shows =
      item.check?.lens === "DESIGN_DOCUMENT"
        ? "Design"
        : item.check?.lens === "INSTANCE_RECORD"
          ? "Implementation"
          : (known?.shows ?? "");
    return {
      requirementId: item.requirementId,
      title: item.title,
      kind,
      icon: known?.icon ?? "file",
      shows,
      requestTitle: item.requestTitle,
      letters: item.letters,
      sub: [kind, shows, plural(item.fileIds.length, "file")]
        .filter((part) => part !== "")
        .join(" · "),
      fileIds: item.fileIds,
      earlier: (item.check?.fileIds ?? []).filter(
        (id) => !item.fileIds.includes(id),
      ).length,
      rechecking,
      hold,
      attributes,
      // While the check runs again its counts are from before the change: not shown.
      tally:
        status === "REVIEWED" && !rechecking ? tallyOf(attributes, false) : [],
      // The review is the finished check's own: while it runs again there is none.
      review:
        status === "REVIEWED" && !rechecking
          ? itemReview(row?.check.review ?? null)
          : null,
      accept: accepted
        ? {
            state: "accepted",
            note:
              known?.acceptedBy !== undefined && known.acceptedBy !== ""
                ? `Accepted by ${known.acceptedBy}.`
                : "",
          }
        : coming
          ? {
              state: "waiting",
              note: rechecking
                ? "Checking again. You can accept once the check finishes."
                : "The check is still running. You can accept once it finishes.",
            }
          : known?.canAccept !== true
            ? {
                state: "waiting",
                note:
                  known === undefined
                    ? "This item is not on the list now, so its evidence is accepted there."
                    : files.some((file) => !readEnded(file))
                      ? "Its files are still being read."
                      : "Its files are not on the list yet. Accept once the list shows them.",
              }
            : { state: "open", note: row?.acceptNote ?? "" },
    };
  });
}

/** The summary line first, then a line per state: what is supported, shown in part, not
 * satisfied, left to the person's judgment, and not checked, each naming its item. */
export function resultsSummary(
  batch: BatchState | null,
  results: readonly ItemResult[],
  progress: Progress,
  /** This upload's files withdrawn here: said where none is left (E1 design review). */
  withdrawn = 0,
): ResultsSummary {
  const notAdded = progress.notAdded;
  const n = (batch?.files ?? []).length;
  const placed = progress.placed;
  const needs = progress.needs;
  const out = progress.notDesign;
  const itemsWith = results.filter((item) => item.fileIds.length > 0).length;
  const extra = [
    needs > 0
      ? `${plural(needs, "file")} ${needs === 1 ? "needs" : "need"} you`
      : "",
    out > 0 ? `${out} ${out === 1 ? "is" : "are"} not D&I evidence` : "",
    notAdded > 0
      ? `${notAdded} ${notAdded === 1 ? "was" : "were"} not added`
      : "",
  ].filter((part) => part !== "");
  const notAddedLine =
    notAdded > 0
      ? ` ${plural(notAdded, "file")} ${notAdded === 1 ? "was" : "were"} not added.`
      : "";
  // Never "None of the 1 file" (design review, 17 November 2026).
  const noneSorted =
    n === 1
      ? "The file could not be sorted into an item."
      : n === 2
        ? "Neither file could be sorted into an item."
        : `None of the ${n} files could be sorted into an item.`;
  const lead =
    n === 0
      ? notAdded > 0
        ? `${noneAdded(notAdded)}. The list shows why.`
        : withdrawn > 0
          ? `No files left in this upload · ${withdrawn} withdrawn`
          : "No file has been added yet."
      : placed === 0 && needs === n
        ? `${n === 1 ? "The file needs you: choose where it goes." : `${n} files need you: choose where they go.`}${notAddedLine}`
        : placed === 0
          ? `${noneSorted}${extra.length > 0 ? ` ${capital(extra.join("; "))}.` : ""}`
          : `${placed === n ? plural(n, "file") : `${placed} of ${plural(n, "file")}`} sorted into ${plural(itemsWith, "item")}.${extra.length > 0 ? ` ${capital(extra.join("; "))}.` : ""}`;
  const lines: ResultsSummary["lines"] = [];
  const add = (key: AttrState, text: string) => {
    if (text !== "") {
      lines.push({
        key,
        tone: ATTR_WORDS[key].tone,
        icon: ATTR_WORDS[key].icon,
        label: ATTR_WORDS[key].short,
        text,
      });
    }
  };
  // As the prototype says it: the letters of each item, by what their evidence shows
  // ("B, C, D, E (design) and A, B, C, D (implementation)").
  // An item checked again after a change speaks from its new check only: until it
  // ends, it is in the "Not checked" line, never with its results from before.
  const settled = results.filter((item) => !item.rechecking);
  const supported = settled.flatMap((item) => {
    const rows = item.attributes.filter((row) => row.state === "SUPPORTED");
    return [
      { word: " (design)", label: "Supported (design)" },
      { word: " (implementation)", label: "Supported (implementation)" },
      { word: "", label: "Supported" },
    ]
      .map((group) => ({
        word: group.word,
        letters: rows
          .filter((row) => row.label === group.label)
          .map((row) => row.letter),
      }))
      .filter((group) => group.letters.length > 0)
      .map((group) => `${group.letters.join(", ")}${group.word}`);
  });
  add("SUPPORTED", supported.length > 0 ? `${listAnd(supported)}.` : "");
  const on = (state: AttrState) =>
    settled.flatMap((item) =>
      item.attributes
        .filter((row) => row.state === state)
        .map((row) => `${row.letter} on ${item.title}`),
    );
  const said = (state: AttrState) => {
    const parts = on(state);
    return parts.length > 0 ? `${parts.join(", ")}.` : "";
  };
  add("PARTLY", said("PARTLY"));
  add("NOT_SATISFIED", said("NOT_SATISFIED"));
  add("JUDGMENT", said("JUDGMENT"));
  const unchecked = results.flatMap((item) =>
    item.rechecking
      ? [`${item.title} (being checked again)`]
      : item.hold === null
        ? []
        : [`${item.title} (${item.hold.short})`],
  );
  add("NOT_CHECKED", unchecked.length > 0 ? `${listAnd(unchecked)}.` : "");
  return { lead, lines };
}

/** The files Results sets apart, before the items: those a person must place, those
 * that are not D&I evidence, and those this browser could not add. */
export function filesApart(lines: readonly FileLine[]): FileLine[] {
  // Design review, 17 November 2026: the files not added are a section of their own
  // (filesNotAdded); these are the files in the control that are not in an item.
  const rank = (line: FileLine) => (line.dest?.kind === "needs" ? 0 : 1);
  return lines
    .filter(
      (line) =>
        !line.notAdded &&
        (line.dest?.kind === "needs" || line.dest?.kind === "out"),
    )
    .sort((a, b) => rank(a) - rank(b));
}

/** The files this browser could not add (refused, or not reached): Results' own
 * section, headed "{n} not added". */
export function filesNotAdded(lines: readonly FileLine[]): FileLine[] {
  return lines.filter((line) => line.notAdded);
}

/** "2 not added". */
export function notAddedTitle(count: number): string {
  return `${count} not added`;
}

/** "2 files are not in an item". */
export function apartTitle(count: number): string {
  return count === 1
    ? "1 file is not in an item"
    : `${count} files are not in an item`;
}

/** What a file of an item addresses, once its item's check is reviewed: the letters
 * whose verified passages are in it. */
export function addressesLine(
  file: BatchFile | null,
  batch: BatchState | null,
  /** The item whose card shows the file: its own check's map is read. */
  requirementId?: string,
):
  | { kind: "letters"; letters: string[]; spoken: string }
  | { kind: "none" }
  | { kind: "later" }
  | { kind: "unknown" } {
  if (file === null) {
    return { kind: "later" };
  }
  const item =
    requirementId === undefined
      ? undefined
      : (batch?.items ?? []).find(
          (each) => each.requirementId === requirementId,
        );
  const on = (batch?.items ?? []).filter((each) =>
    file.placement.requirementIds.includes(each.requirementId),
  );
  // This item's check, or, asked without an item, every item the file is on.
  const reviewed =
    item !== undefined
      ? item.check?.status === "REVIEWED"
      : on.length > 0 && on.every((each) => each.check?.status === "REVIEWED");
  if (!reviewed) {
    return { kind: "later" };
  }
  // The item's own map (the server's items[].addresses); without one, the file's own
  // list stands in only where the file is on this one item: on several, its letters mix
  // the items' checks, and nothing is said rather than the wrong letters.
  const list =
    item?.addresses != null
      ? (item.addresses[file.fileId] ?? [])
      : on.length <= 1 || item === undefined
        ? file.addresses
        : null;
  if (list === null) {
    return { kind: "unknown" };
  }
  const letters = distinct(
    list.map((each) => each.code),
    (code) => code,
  );
  if (letters.length === 0) {
    return { kind: "none" };
  }
  const verdictWords: Record<Verdict, string> = {
    SUPPORTED: "supported",
    PARTLY_SUPPORTED: "shown in part",
    ISSUE: "not satisfied",
    UNSETTLED: "your judgment needed",
    NOT_ADDRESSED: "not addressed",
  };
  return {
    kind: "letters",
    letters,
    spoken: listAnd(
      list.map((each) => `${each.code} (${verdictWords[each.verdict]})`),
    ),
  };
}

/** Said after a move that leaves an item with no evidence: the server asks for it again
 * in a new draft (the requests follow the evidence). */
export const ASKED_AGAIN =
  "That item is asked for again in a new draft, which needs approval before it is sent.";

/** The sentence for `count` items a move left with no evidence; "" for none. */
export function askedAgain(count: number): string {
  return count === 0
    ? ""
    : count === 1
      ? ASKED_AGAIN
      : "Those items are asked for again in a new draft, which needs approval before it is sent.";
}

/** What a person reads when confirming a file's kind or reading it again did not go
 * through; null when the server confirmed it. A refusal is the server's sentence. */
export function readingProblem(status: number, detail = ""): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 409) {
    return detail.trim() !== ""
      ? sentence(detail)
      : "The file’s reading changed meanwhile. It is shown as it is now: try again.";
  }
  if (status === 403 || status === 404) {
    return "Your role cannot change this file’s reading.";
  }
  if (status === 422) {
    return "This file’s reading is not known here yet. Refresh the page and try again.";
  }
  return "That could not be done. Try again in a moment.";
}

/** The items a move takes a file off (`from`, not in `to`) that then hold no evidence:
 * no other file of this upload placed on them, and none held before it. */
export function leftWithout(
  fileId: string,
  from: readonly string[],
  to: readonly string[],
  items: readonly WizardItem[],
  batch: BatchState | null,
): string[] {
  return from
    .filter((id) => !to.includes(id))
    .filter((id) => {
      const others = (batch?.files ?? []).some(
        (file) =>
          file.fileId !== fileId &&
          file.placement.status === "PLACED" &&
          file.placement.requirementIds.includes(id),
      );
      const held = (
        items.find((item) => item.requirementId === id)?.held ?? []
      ).some((file) => file.id !== fileId);
      return !others && !held;
    });
}

/** After this many reads in a row that did not reach the server, the window says so and
 * keeps trying, further apart each time. */
export const UNREACHABLE_AFTER = 3;
export const UNREACHABLE = "Can’t reach the server. Retrying.";

/** How long until the next read after `failures` reads in a row did not reach the
 * server: the usual pace, then doubling, at most 30 seconds. While nothing would be read
 * again (null) a failed read still tries again. */
export function retryDelay(
  delay: number | null,
  failures: number,
): number | null {
  if (failures <= 0) {
    return delay;
  }
  const base = delay ?? 2_000;
  return failures < UNREACHABLE_AFTER
    ? base
    : Math.min(30_000, base * 2 ** (failures - UNREACHABLE_AFTER + 1));
}

/** The elapsed time shown never runs backwards: a newer answer that moves the clock
 * offset back keeps the time already shown, until the session is done (then its own
 * record stands). */
export function steadySeconds(
  shown: number | null,
  next: number,
  done: boolean,
): number {
  return done || shown === null ? next : Math.max(shown, next);
}

/** The footer note on Results; nothing where no file is left to accept (E1 design
 * review: "Nothing is accepted until you accept it" under an empty upload). Where an
 * item in view is accepted, the note opens with how many, and never says nothing is (E1
 * final design review: "Nothing is accepted" under a card reading "Accepted by ..."). */
export function resultsNote(progress: Progress, accepted = 0): string {
  if (progress.files === 0) {
    return "";
  }
  const needs =
    progress.needs > 0
      ? ` · ${plural(progress.needs, "file")} ${progress.needs === 1 ? "needs" : "need"} you`
      : "";
  if (accepted > 0) {
    const checked =
      progress.checked > 0
        ? ` · ${plural(progress.checked, "item")} checked by two readings`
        : "";
    return `${plural(accepted, "item")} accepted${checked}${needs}.`;
  }
  // Design review, 17 November 2026: no "0 items checked by two readings".
  if (progress.checked === 0) {
    return progress.needs > 0
      ? `${plural(progress.needs, "file")} ${progress.needs === 1 ? "needs" : "need"} you. Nothing is accepted until you accept it.`
      : "Nothing is accepted until you accept it.";
  }
  return `${plural(progress.checked, "item")} checked by two readings${needs}. Nothing is accepted until you accept it.`;
}

/** Results' line on how long it took: "Analyzed in 0:42", "Analyzed in under a
 * second"; "" when no file was added (nothing was analyzed). */
export function analyzedLine(seconds: number, progress: Progress): string {
  // Nothing ran, or nothing is left of it (every file withdrawn).
  if (progress.nothingAdded || progress.files === 0) {
    return "";
  }
  return seconds < 1
    ? "Analyzed in under a second"
    : `Analyzed in ${formatDuration(seconds)}`;
}

/** How the Analyze step says it ended, once it is done: the line under the elapsed time,
 * whether the clock is shown, the footer's note and its tone, the footer's main action,
 * and whether See results is the primary button. One story (the owner's rule, 17
 * November 2026; the design review the same day): green only when every file was added
 * and none waits for a person; amber when some were not added or files need a person;
 * red when none was added, where the clock is hidden (nothing ran) and the main action
 * adds files instead of opening results there are none of. */
export type Finish = {
  /** Where the elapsed clock was while work ran (the clock is not shown once it is
   * done); "" when no file was added (the red Secure stage and the footer say it). */
  short: string;
  /** The footer's note. */
  note: string;
  tone: "success" | "warning" | "problem";
  action: "results" | "add";
  /** See results is the primary button, unless a file waits for a person: then the
   * row's own choice is the one primary action. */
  primary: boolean;
};

/** "None of the 9 files were added", "Neither file was added", "The file was not added". */
export function noneAdded(count: number): string {
  return count === 1
    ? "The file was not added"
    : count === 2
      ? "Neither file was added"
      : `None of the ${count} files were added`;
}

/** "Finished in 0:42", or "Finished in under a second" (never "0:00", which reads as
 * never read). The seconds are the server's: the batch's start to its last reading. */
export function tookLine(seconds: number): string {
  return seconds < 1
    ? "Finished in under a second"
    : `Finished in ${formatElapsed(seconds)}`;
}

/** " 1 item not checked: 3 files could not be read.", after the finish, the files those
 * on the items not checked; " 3 files could not be read." where files not read are on no
 * such item (they wait for a person); "" where nothing is unread or unchecked. */
function uncheckedWords(
  progress: Pick<Progress, "unchecked" | "notRead" | "notReadUnchecked">,
) {
  const items = progress.unchecked;
  const files = progress.notReadUnchecked;
  if (items <= 0) {
    return progress.notRead > 0
      ? ` ${plural(progress.notRead, "file")} could not be read.`
      : "";
  }
  return ` ${plural(items, "item")} not checked${
    files > 0 ? `: ${plural(files, "file")} could not be read` : ""
  }.`;
}

export function finishOf(seconds: number, progress: Progress): Finish {
  const took = tookLine(seconds);
  const needs =
    progress.needs > 0
      ? ` ${plural(progress.needs, "file")} ${progress.needs === 1 ? "needs" : "need"} you.`
      : "";
  const primary = progress.needs === 0;
  // A check that did not finish is said, and the finish is never green over it.
  const failed =
    progress.failedChecks > 0
      ? ` ${plural(progress.failedChecks, "check")} did not finish.`
      : "";
  // An item held (its files not read) is not checked: said, and never green over it.
  const unchecked = uncheckedWords(progress);
  if (progress.nothingAdded) {
    return {
      short: "",
      // Design review round 3: the reason may sit on the row or in a group's note
      // (several files withdrawn from one control), so the line points at the list.
      note: `${noneAdded(progress.notAdded)}. The list shows why.`,
      tone: "problem",
      action: "add",
      primary: true,
    };
  }
  if (progress.notAdded > 0) {
    const of = progress.secured + progress.notAdded;
    return {
      short: took,
      note: `${took}. ${progress.notAdded} of ${plural(of, "file")} ${progress.notAdded === 1 ? "was" : "were"} not added.${needs}${failed}${unchecked}`,
      tone: "warning",
      action: "results",
      primary,
    };
  }
  return {
    short: took,
    note: `${took}.${needs}${failed}${unchecked}`,
    tone:
      progress.needs > 0 ||
      progress.failedChecks > 0 ||
      progress.unchecked > 0 ||
      progress.notRead > 0
        ? "warning"
        : "success",
    action: "results",
    primary,
  };
}

/** The Files pane's count: what is sorted (placed, or ruled out) of the files, and how
 * many wait for a person; when none was added, how many were not. */
export function filesCount(progress: Progress): string {
  if (progress.nothingAdded) {
    return `${plural(progress.notAdded, "file")} not added`;
  }
  const placedOrOut = progress.sorted - progress.needs;
  return `${placedOrOut} of ${progress.files} sorted${
    progress.needs > 0
      ? ` · ${progress.needs} ${progress.needs === 1 ? "needs" : "need"} you`
      : ""
  }`;
}

/** The D&I items pane: its note ("Two readings each", or nothing when no file was added)
 * and what it says while it holds no item. */
export function itemsPane(progress: Progress): { note: string; empty: string } {
  if (progress.nothingAdded) {
    return { note: "", empty: "Nothing to check. No file was added." };
  }
  return {
    note: "Two readings each",
    empty:
      progress.needs > 0
        ? "Files appear here once placed."
        : progress.done
          ? "No file went to a D&I item, so nothing is checked against the attributes."
          : "Each D&I item appears here as files are sorted into it.",
  };
}

/** The footer note on Analyze once it is done. */
export function finishedNote(seconds: number, progress: Progress): string {
  return finishOf(seconds, progress).note;
}

// ---------------------------------------------------------------------------------------
// The list's line, and the session this browser remembers
// ---------------------------------------------------------------------------------------

/** The list line's action where an earlier upload's files wait to be placed. */
export const PLACE_FILES = "Place files";

/** Whether the control has a session newer than this one in its list (latest first, as
 * the server sends it; by its time where both have one). */
export function isEarlierSession(
  list: readonly BatchSummary[],
  batchId: string,
): boolean {
  const at = list.findIndex((item) => item.batchId === batchId);
  if (at < 0) {
    return false;
  }
  const self = list[at]?.createdAt ?? null;
  return list.some(
    (item, index) =>
      item.batchId !== batchId &&
      (item.createdAt !== null && self !== null
        ? item.createdAt > self
        : index < at),
  );
}

/** The line on the D&I list while a session is open: "Reading 7 files · Read 3 of 7 ·
 * 0:42", then "7 files read: 5 sorted into the items, 1 needs you." (one verb on the D&I
 * Evidence step, "Reading": E1 design review, round 5). */
export function progressLine(facts: {
  progress: Progress | null;
  summary: BatchSummary | null;
  seconds: number;
  /** A newer session of the control exists (isEarlierSession): this one is shown only for
   * its files that still wait for a person, so only they are said. */
  earlier?: boolean;
}): {
  text: string;
  done: boolean;
  action: string;
  /** How the line is marked: under way, or, once done, as the window's finish says it
   * (green, amber, red). */
  tone: "working" | "success" | "warning" | "problem";
} | null {
  const p = facts.progress;
  const s = facts.summary;
  if (p === null && s === null) {
    return null;
  }
  const files = p?.files ?? s?.files ?? 0;
  // Before the batch is read, only the list's `finished` ends a session: a session with
  // no file at work (in_progress 0) may still be checking its items.
  const done = p !== null ? p.done : s?.finished === true;
  if (!done) {
    const stage = p?.stages.find((item) => item.state === "active") ?? null;
    // The items whose check is still to come or at work, exactly; not every item.
    const now =
      p === null
        ? ""
        : (stage === null || stage.key === "check") && p.checkingItems > 0
          ? `Checking ${plural(p.checkingItems, "item")} against the attributes`
          : stage !== null && stage.key !== "check"
            ? stage.count
            : "";
    return {
      text: [
        `Reading ${plural(files, "file")}`,
        now,
        formatElapsed(facts.seconds),
      ]
        .filter((part) => part !== "")
        .join(" · "),
      done: false,
      action: "Show progress",
      tone: "working",
    };
  }
  if (p?.nothingAdded === true) {
    // As the window says it: nothing was added, so there is nothing analyzed.
    return {
      text: "No file was added.",
      done: true,
      action: "See why",
      tone: "problem",
    };
  }
  const needs = p?.needs ?? s?.needsPerson ?? 0;
  const placed = p?.placed ?? null;
  const notAdded = p?.notAdded ?? 0;
  const failedChecks = p?.failedChecks ?? 0;
  const failed =
    failedChecks > 0 ? ` ${plural(failedChecks, "check")} did not finish.` : "";
  const unchecked = p === null ? "" : uncheckedWords(p);
  const by =
    s !== null && s.createdBy !== "" ? ` Added by ${s.createdBy}.` : "";
  const needsYou = `${plural(needs, "file")} ${needs === 1 ? "needs" : "need"} you`;
  // Nothing placed: no "0 sorted" clause (design review, 17 November 2026).
  const unplaced = [
    needs > 0 ? needsYou : "",
    notAdded > 0 ? `${notAdded} not added` : "",
  ]
    .filter((part) => part !== "")
    .join("; ");
  const tone =
    notAdded > 0 || needs > 0 || failedChecks > 0 || unchecked !== ""
      ? "warning"
      : "success";
  // Only files of the upload wait, none of them placed: said as what it is, an earlier
  // upload's files to place, so it never reads as the files on a request (design
  // review, 18 November 2026). Same target as See results. Round 4, the same day: a
  // session older than the control's latest, shown because a file of it still waits for
  // a person, says only that. Its other counts (what it sorted, a check of an item it
  // placed on, perhaps another request) are its own past and read as the first request
  // row's, which the banner sits above ("1 check did not finish" over "Check on hold").
  if (
    needs > 0 &&
    (facts.earlier === true ||
      (placed === 0 && notAdded === 0 && failed === ""))
  ) {
    const when =
      s?.createdAt != null && Number.isFinite(s.createdAt)
        ? ` on ${formatDate(new Date(s.createdAt).toISOString())}`
        : "";
    const who =
      s !== null && s.createdBy !== ""
        ? ` Added by ${s.createdBy}${when}.`
        : when !== ""
          ? ` Added${when}.`
          : "";
    return {
      text: `${plural(needs, "file")} from an earlier upload ${needs === 1 ? "is" : "are"} waiting to be placed.${who}`,
      done: true,
      action: PLACE_FILES,
      tone: "warning",
    };
  }
  return {
    text:
      placed === 0 && unplaced !== ""
        ? `${capital(unplaced)}.${failed}${unchecked}${by}`
        : `${plural(files, "file")} read${
            placed !== null ? `: ${placed} sorted into the items` : ""
          }${needs > 0 ? `${placed !== null ? "," : ":"} ${needs} ${needs === 1 ? "needs" : "need"} you` : ""}.${
            notAdded > 0 ? ` ${notAdded} not added.` : ""
          }${failed}${unchecked}${by}`,
    done: true,
    action: "See results",
    // Green only when every file was added, none waits for a person, and every item's
    // check gave a verdict.
    tone,
  };
}

/** The session this browser remembers for a control (sessionStorage): a hint only, as
 * the server's list of sessions is the record. */
export type SessionHint = {
  batchId: string;
  requirementId: string | null;
  /** Finished sessions put away with Done. */
  dismissed: string[];
  /** The window was open on it: a page refresh that loses the page opens it again. */
  open?: true;
};

export const hintKey = (controlId: string): string =>
  `aw.evidence-wizard.${controlId}`;

export function readHint(raw: string | null): SessionHint | null {
  if (raw === null || raw === "") {
    return null;
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) {
      return null;
    }
    const batchId = uuidOrNull(value.batch) ?? "";
    return {
      batchId,
      requirementId: uuidOrNull(value.requirement),
      dismissed: (Array.isArray(value.dismissed) ? value.dismissed : [])
        .map(uuidOrNull)
        .filter((id): id is string => id !== null)
        .slice(-20),
      ...(value.open === true ? { open: true as const } : {}),
    };
  } catch {
    return null;
  }
}

export function writeHint(hint: SessionHint): string {
  return JSON.stringify({
    batch: hint.batchId,
    requirement: hint.requirementId,
    dismissed: hint.dismissed.slice(-20),
    ...(hint.open === true ? { open: true } : {}),
  });
}
