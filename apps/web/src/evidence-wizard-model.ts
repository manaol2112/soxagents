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
  VERDICTS,
  type Verdict,
} from "./evidence-assurance-model.ts";
import { MAX_UPLOAD_BYTES } from "./evidence-model.ts";
import { formatBytes } from "./format.ts";
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
  /** Already held before this session: shown where it is, and not moved here. */
  duplicate: boolean;
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
    duplicate: value.duplicate === true,
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

/** The upload route's answer for one file: stored, already held, refused with the
 * server's sentence, or not reached (which can be tried again). */
export function uploadAnswer(
  status: number,
  body: unknown,
): { state: UploadState; fileId: string | null; detail: string } {
  const raw = isRecord(body) ? body : {};
  const fileId = uuidOrNull(raw.file_id);
  if (status === 200 && fileId !== null) {
    return {
      state: raw.duplicate === true ? "duplicate" : "stored",
      fileId,
      detail: "",
    };
  }
  if (status === 409) {
    const said = str(raw.detail);
    return {
      state: "refused",
      fileId: null,
      detail:
        said !== ""
          ? sentence(said)
          : "The upload was refused. Start the wizard again.",
    };
  }
  if (status === 413) {
    return {
      state: "refused",
      fileId: null,
      // As the upload plan and the drop zone say the limit (25 MB, decimal).
      detail: `It is larger than ${MAX_UPLOAD_BYTES / 1_000_000} MB, so it was not added.`,
    };
  }
  if (status === 400 || status === 422) {
    return {
      state: "refused",
      fileId: null,
      detail: "Its name or contents were not accepted, so it was not added.",
    };
  }
  if (status === 403 || status === 404) {
    return {
      state: "refused",
      fileId: null,
      detail: "Your role cannot add evidence to this control.",
    };
  }
  return {
    state: "failed",
    fileId: null,
    detail: "It did not reach the evidence store. Try again.",
  };
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
 * SOX FY2027 · One request to Joanna Rose Manaol, due Nov 23, 2026"), and who the side
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
 * the reader was not sure of it, reading it again where its reading failed. */
export function needsFix(file: BatchFile): NeedsFix | null {
  if (file.placement.status !== "NEEDS_PERSON") {
    return null;
  }
  const reason = file.placement.reason;
  if (file.read.status === "FAILED" || /\bread it again\b/i.test(reason)) {
    return "reread";
  }
  return /\bconfirm its kind\b/i.test(reason) ? "confirm-kind" : null;
}

export type FileLine = {
  key: string;
  fileId: string | null;
  name: string;
  folder: string;
  mark: FileMark;
  meta: string;
  track: [TrackState, TrackState, TrackState, TrackState];
  /** The share of its bytes sent, while it is being sent. */
  sent: number | null;
  /** What is happening to it now, in words; null once it is sorted. */
  activity: {
    text: string;
    on: boolean;
    tone: "plain" | "warning" | "danger";
  } | null;
  kind: { label: string; confidence: string; low: boolean } | null;
  dest: Destination | null;
  /** From a row: a better fit the reader is sure of; nothing moves without a person. */
  suggestion: { requirementId: string; text: string } | null;
  /** Already held: shown where it is, with no action here. */
  duplicate: boolean;
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
          text: "Secured. Waiting for a reader",
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
        return {
          text: `Not added. ${upload.detail}`,
          on: false,
          tone: "danger",
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
    return { text: "Secured. Waiting for a reader", on: false, tone: "plain" };
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
      ? "done"
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
    return {
      key: upload?.key ?? `file-${file?.fileId ?? name}`,
      fileId: file?.fileId ?? upload?.fileId ?? null,
      name,
      folder: upload?.folder ?? "",
      mark,
      meta: fileMeta(mark, size, file?.read.pages ?? null),
      track: trackOf(upload, file),
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
      return [line({ ...upload, state: "duplicate" }, null)];
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
  return lines;
}

// ---------------------------------------------------------------------------------------
// Step 2: the pipeline, the elapsed time and the estimate
// ---------------------------------------------------------------------------------------

export type StageState = "wait" | "active" | "done";

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
  checked: number;
  /** Items whose check is queued, at work, or about to be queued: exactly. */
  checkingItems: number;
  uploading: boolean;
  /** Something is being read or sorted. */
  reading: boolean;
  /** An item's check is queued or at work, or about to be queued. */
  checking: boolean;
  done: boolean;
  stages: StageLine[];
};

function lastRead(batch: BatchState | null): number | null {
  const times = (batch?.files ?? [])
    .map((file) => file.read.finishedAt)
    .filter((time): time is number => time !== null);
  return times.length === 0 ? null : Math.max(...times);
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
  const checked = items.filter((item) => checkEnded(item.check)).length;
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

  const secureState: StageState =
    secureTotal === 0 ? "wait" : uploading ? "active" : "done";
  const readState: StageState =
    total === 0
      ? "wait"
      : !uploading && arriving.length === 0 && read === files.length
        ? "done"
        : read > 0 || files.some((file) => file.read.status === "WORKING")
          ? "active"
          : "wait";
  const sortState: StageState =
    total === 0
      ? "wait"
      : allSorted
        ? "done"
        : sorted > 0 || read > 0
          ? "active"
          : "wait";
  const checkState: StageState =
    items.length === 0
      ? allSorted && total > 0
        ? "done"
        : "wait"
      : allSorted && !checking
        ? "done"
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
      count:
        readState === "wait"
          ? total > 0
            ? "Waiting for a reader"
            : "Waiting"
          : `Read ${read} of ${total}`,
      flag: "",
    },
    {
      key: "sort",
      name: "Classify and sort",
      state: sortState,
      count: sortState === "wait" ? "Waiting" : `Sorted ${sorted} of ${total}`,
      flag: needs > 0 ? `${needs} ${needs === 1 ? "needs" : "need"} you` : "",
    },
    {
      key: "check",
      name: "Check against attributes",
      state: checkState,
      count:
        items.length === 0
          ? checkState === "done"
            ? "No item to check"
            : "Waiting for sorted files"
          : checkState === "wait"
            ? allSorted
              ? "Waiting to start"
              : "Waiting for sorted files"
            : `Checked ${checked} of ${plural(items.length, "item")}`,
      flag: "",
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
    checkingItems: coming.length,
    uploading,
    reading,
    checking,
    done,
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
  const checks = (batch?.items ?? [])
    .map((item) =>
      item.check?.finishedAt === null || item.check?.finishedAt === undefined
        ? null
        : timeOf(item.check.finishedAt),
    )
    .filter((time): time is number => time !== null);
  const last = lastRead(batch);
  const all = [...checks, ...(last === null ? [] : [last])];
  return all.length === 0 ? null : Math.max(...all);
}

/** Seconds since the session began, on the server's clock; once it is done, how long it
 * took (to its last reading or check, else to when this page saw it done). Before the
 * server has the batch, since this browser started it. */
export function elapsedSeconds(facts: {
  createdAt: number | null;
  /** The server's clock now (serverClock). */
  now: number;
  done: boolean;
  finished: number | null;
  /** When this browser started the session, on its clock adjusted to the server's. */
  startedAt: number | null;
}): number {
  const start = facts.createdAt ?? facts.startedAt;
  if (start === null) {
    return 0;
  }
  const end =
    facts.done && facts.finished !== null && facts.finished >= start
      ? facts.finished
      : facts.now;
  return Math.max(0, Math.floor((end - start) / 1000));
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
    return `Sorted ${now.sorted} of ${plural(now.files, "file")}.`;
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
          text: checkLine(check, facts.attributes, files),
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
  const lead =
    n === 0
      ? notAdded > 0
        ? `No file was added. ${capital(plural(notAdded, "file"))} could not be added: each says why.`
        : "No file has been added yet."
      : placed === 0
        ? `None of the ${plural(n, "file")} could be sorted into an item.${extra.length > 0 ? ` ${capital(extra.join("; "))}.` : ""}`
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
  const rank = (line: FileLine) =>
    line.dest?.kind === "needs"
      ? 0
      : line.activity?.tone === "danger" && line.file === null
        ? 2
        : 1;
  return lines
    .filter(
      (line) =>
        line.dest?.kind === "needs" ||
        line.dest?.kind === "out" ||
        (line.file === null &&
          (line.upload?.state === "refused" ||
            line.upload?.state === "failed")),
    )
    .sort((a, b) => rank(a) - rank(b));
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

/** The footer note on Results. */
export function resultsNote(progress: Progress): string {
  const needs =
    progress.needs > 0
      ? ` · ${plural(progress.needs, "file")} ${progress.needs === 1 ? "needs" : "need"} you`
      : "";
  return `${plural(progress.checked, "item")} checked by two readings${needs}. Nothing is accepted until you accept it.`;
}

/** The footer note on Analyze once it is done. */
export function finishedNote(seconds: number, progress: Progress): string {
  return `Finished in ${formatElapsed(seconds)}.${
    progress.needs > 0
      ? ` ${plural(progress.needs, "file")} ${progress.needs === 1 ? "needs" : "need"} you.`
      : ""
  }`;
}

// ---------------------------------------------------------------------------------------
// The list's line, and the session this browser remembers
// ---------------------------------------------------------------------------------------

/** The line on the D&I list while a session is open: "Analyzing 7 files · Read 3 of 7 ·
 * 0:42", then "7 files analyzed: 5 sorted into the items, 1 needs you." */
export function progressLine(facts: {
  progress: Progress | null;
  summary: BatchSummary | null;
  seconds: number;
}): { text: string; done: boolean; action: string } | null {
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
        `Analyzing ${plural(files, "file")}`,
        now,
        formatElapsed(facts.seconds),
      ]
        .filter((part) => part !== "")
        .join(" · "),
      done: false,
      action: "Show progress",
    };
  }
  const needs = p?.needs ?? s?.needsPerson ?? 0;
  const placed = p?.placed ?? null;
  const by =
    s !== null && s.createdBy !== "" ? ` Added by ${s.createdBy}.` : "";
  return {
    text: `${plural(files, "file")} analyzed${
      placed !== null ? `: ${placed} sorted into the items` : ""
    }${needs > 0 ? `${placed !== null ? "," : ":"} ${needs} ${needs === 1 ? "needs" : "need"} you` : ""}.${by}`,
    done: true,
    action: "See results",
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
