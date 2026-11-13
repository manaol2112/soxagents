/**
 * The evidence assurance chain on the D&I Evidence list (docs/evidence-assurance.md,
 * sections 6 and 7). The in-force files of each D&I request are read together, as one
 * walkthrough, against the control's approved attributes by two independent readings,
 * and code on the server decides what stands: one run per request. This module reads
 * what the server sent and words it for the request's row: a check not run yet, a check
 * at work, a check on hold with the one action that clears it, a check to run again, a
 * file left out of the readings with why, and a finished check with each attribute's
 * state.
 *
 * Pure. Nothing here decides a verdict: the server does. A value this module does not
 * know falls back to the cautious reading, never to "supported": an unknown status reads
 * as still being checked (nothing of it is shown), an unknown verdict as needing the
 * person's judgment, and support that came without what support needs (the agreed
 * result, a passage) is not shown as support. Nothing reads as an issue unless the
 * server's verdict says both readings agree on it, and no file of the request is left
 * out of what the row says without saying so. D&I needs both the design and its
 * implementation: an attribute is evidenced only where the records of an instance show
 * it, never on a policy's word alone.
 */

import {
  CLOSED_STATUSES,
  FINDING_STATUSES,
  type FindingStatus,
} from "./evidence-findings-model.ts";
import type { IconName } from "./icon-name.ts";

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (value: unknown): string | null =>
  typeof value === "string" && UUID.test(value) ? value : null;

// What the server sends (section 6)

export const STATUSES = [
  "NOT_CHECKED",
  "QUEUED",
  "CHECKING",
  "HELD",
  "REVIEWED",
  "FAILED",
  "OUT_OF_DATE",
] as const;
export type CheckStatus = (typeof STATUSES)[number];

export const STAGES = ["GATE", "ASSESS", "VERIFY", "COMPARE", "DONE"] as const;
export type Stage = (typeof STAGES)[number];

export const VERDICTS = [
  "SUPPORTED",
  // The request shows some of the attribute's elements and does not bear on the rest:
  // the rest is left to other requests. Never an issue, never a finding.
  "PARTLY_SUPPORTED",
  "ISSUE",
  "UNSETTLED",
  "NOT_ADDRESSED",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export const RESULTS = [
  "MET",
  "PARTLY_MET",
  "NOT_MET",
  "CONTRADICTED",
  "CANNOT_TELL",
  "NOT_ADDRESSED",
  // A partly supported attribute's result: some elements shown, the rest not borne on.
  "SHOWN_IN_PART",
] as const;
export type Result = (typeof RESULTS)[number];

/** An element's agreed result; null where the two readings differ on it. */
export type ElementResult = Exclude<Result, "SHOWN_IN_PART">;

const HELD_CODES = [
  "CUSTODY",
  "UNREADABLE",
  "READ_FAILED",
  "KIND_UNSURE",
  "POPULATION",
  "NO_ATTRIBUTES",
  "TOO_LARGE",
] as const;
/** Why the gate stopped a check, or left a file out. OTHER is a code this page does
 * not know. */
export type HeldCode = (typeof HELD_CODES)[number] | "OTHER";

export type Lens = "DESIGN_DOCUMENT" | "INSTANCE_RECORD";

/** What a supported attribute's evidence shows: the documented design (a policy or
 * procedure requires it) or its implementation (the records of an instance show it). */
export type Shows = "DESIGN" | "IMPLEMENTATION";

/** A file's own words a result rests on, and where they sit. */
export type Passage = {
  quote: string;
  /** The file the words are in; null where the server named none this page can read
   * and the request read more than one file. */
  fileId: string | null;
  /** "Page 3", "Image 2", "Sheet Users, row 4, column B"; "" where the server located
   * nothing. */
  location: string;
  page: number | null;
};

/** One reading's answer for an attribute: both, where the readings do not agree, or
 * where the request does not ask for the attribute. */
export type View = {
  role: "ASSESSOR" | "REVIEWER";
  result: Result | null;
  reason: string;
};

/** One part of an attribute's criteria (its condition, what passes), with the result
 * both readings agree on for it. */
export type AssuredElement = {
  key: string;
  text: string;
  /** Null where the two readings differ on the element. */
  result: ElementResult | null;
  passages: Passage[];
  absent: string[];
};

export type AssuredAttribute = {
  /** "" where the server sent none this page can read: its code is then its letter. */
  attributeId: string;
  code: string;
  expected: boolean;
  verdict: Verdict;
  /** False when what the server sent could not be taken as it stands (a verdict this
   * page does not know, or one its own result contradicts): shown as needing the
   * person's judgment, without the claim that two readings disagree. */
  understood: boolean;
  result: Result | null;
  /** What a supported attribute's evidence shows; null where it is not supported or
   * the server did not say. */
  shows: Shows | null;
  /** The attribute's elements, each with its agreed result; empty where the server
   * sent none. */
  elements: AssuredElement[];
  summary: string;
  passages: Passage[];
  absent: string[];
  views: View[];
  findingId: string | null;
  /** The finding's status, where the server sent one this page knows. */
  findingStatus: FindingStatus | null;
};

/** A file the gate left out of the readings; the run went ahead on the rest. */
export type HeldFile = { fileId: string; code: HeldCode; reason: string };

/** One request's latest run. */
export type AssuredRequest = {
  requirementId: string;
  runId: string | null;
  status: CheckStatus;
  stage: Stage | null;
  /** Null unless the whole request is held. */
  held: { code: HeldCode; reason: string } | null;
  heldFiles: HeldFile[];
  /** The files the readings included. */
  fileIds: string[];
  lens: Lens | null;
  readInPart: boolean;
  /** Empty unless the check is finished and current. */
  attributes: AssuredAttribute[];
  /** Why the check is out of date, in the server's sentences. */
  outOfDate: string[];
  /** Why a failed check failed, in one plain sentence; "" otherwise. */
  note: string;
  finishedAt: string | null;
};

/** The server's counts. Each is null where it sent none this page can read. */
export type AssuranceSummary = {
  /** Requests. */
  checking: number | null;
  held: number | null;
  failed: number | null;
  outOfDate: number | null;
  /** Attribute verdicts; issues counts only the open ones. */
  supported: number | null;
  issues: number | null;
  unsettled: number | null;
};

export type EvidenceAssurance = {
  requests: AssuredRequest[];
  /** Null when the server sent no summary. */
  summary: AssuranceSummary | null;
};

const strings = (value: unknown, limit: number): string[] =>
  (Array.isArray(value) ? value : [])
    .map(str)
    .filter((item) => item !== "")
    .slice(0, limit);

const heldCode = (value: unknown): HeldCode =>
  HELD_CODES.find((item) => item === value) ?? "OTHER";

const positive = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;

/**
 * Where a passage sits. The server sends `{label, page, sheet, row, column, cell}`
 * (evidence_assurance._where): `label` is already plain words ("Page 3", "Image 2",
 * "Sheet Users, row 4, column B") and is shown as it is; without it the parts are
 * composed. A bare string is taken as the label.
 */
function parseLocation(value: unknown): {
  location: string;
  page: number | null;
} {
  if (typeof value === "string") {
    return { location: value.trim().slice(0, 120), page: null };
  }
  if (!isRecord(value)) {
    return { location: "", page: null };
  }
  const page = positive(value.page);
  const label = str(value.label).slice(0, 120);
  if (label !== "") {
    return { location: label, page };
  }
  const sheet = str(value.sheet);
  const row = positive(value.row);
  const column = str(value.column);
  const cell = str(value.cell);
  return {
    location: [
      page !== null ? `Page ${page}` : "",
      sheet !== "" ? `Sheet ${sheet}` : "",
      row !== null ? `row ${row}` : "",
      column !== "" ? `column ${column}` : "",
      row === null && column === "" && cell !== "" ? `cell ${cell}` : "",
    ]
      .filter((part) => part !== "")
      .join(", "),
    page,
  };
}

function parsePassage(value: unknown, only: string | null): Passage | null {
  if (!isRecord(value) || str(value.quote) === "") {
    return null;
  }
  return {
    quote: str(value.quote).slice(0, 600),
    // Every passage names its file. Where one does not, it is in the request's one
    // file if the readings read one; otherwise its file is not known.
    fileId: uuidOrNull(value.file_id) ?? only,
    ...parseLocation(value.location),
  };
}

function parseView(value: unknown): View | null {
  if (
    !isRecord(value) ||
    (value.role !== "ASSESSOR" && value.role !== "REVIEWER")
  ) {
    return null;
  }
  return {
    role: value.role,
    result: RESULTS.find((item) => item === value.result) ?? null,
    reason: str(value.reason),
  };
}

function parseElement(
  value: unknown,
  only: string | null,
): AssuredElement | null {
  if (!isRecord(value)) {
    return null;
  }
  const key = str(value.key).slice(0, 80);
  const text = str(value.text).slice(0, 400);
  if (key === "" || text === "") {
    return null;
  }
  return {
    key,
    text,
    result:
      RESULTS.find(
        (item): item is ElementResult =>
          item === value.result && item !== "SHOWN_IN_PART",
      ) ?? null,
    passages: (Array.isArray(value.passages) ? value.passages : [])
      .map((item) => parsePassage(item, only))
      .filter((item): item is Passage => item !== null)
      .slice(0, 6),
    absent:
      typeof value.absent === "string"
        ? strings([value.absent], 1)
        : strings(value.absent, 6),
  };
}

const ISSUE_RESULTS: readonly Result[] = [
  "PARTLY_MET",
  "NOT_MET",
  "CONTRADICTED",
  "NOT_ADDRESSED",
];

function parseAttribute(
  value: unknown,
  only: string | null,
): AssuredAttribute | null {
  if (!isRecord(value)) {
    return null;
  }
  const attributeId = uuidOrNull(value.attribute_id) ?? "";
  const code = str(value.code).slice(0, 8);
  if (attributeId === "" && code === "") {
    return null;
  }
  const said = VERDICTS.find((item) => item === value.verdict) ?? null;
  const result = RESULTS.find((item) => item === value.result) ?? null;
  const passages = (Array.isArray(value.passages) ? value.passages : [])
    .map((item) => parsePassage(item, only))
    .filter((item): item is Passage => item !== null)
    .slice(0, 12);
  const elements = (Array.isArray(value.elements) ? value.elements : [])
    .map((item) => parseElement(item, only))
    .filter((item): item is AssuredElement => item !== null)
    .filter(
      (item, at, all) => all.findIndex((each) => each.key === item.key) === at,
    )
    .slice(0, 12);
  const each = (results: readonly (ElementResult | null)[]) =>
    elements.every((item) => results.includes(item.result));
  const some = (wanted: ElementResult) =>
    elements.some((item) => item.result === wanted);
  // What stands as sent. Support needs the agreed result, a passage it rests on, and
  // (where the elements are sent) every element shown (rules 2 and 6 and the comparison
  // of section 3). Support in part needs some element shown and the rest not borne on.
  // An issue or "not addressed" that carries the result "met" contradicts itself.
  // Anything else is left for the person.
  const stands =
    said === "SUPPORTED"
      ? result === "MET" && passages.length > 0 && each(["MET"])
      : said === "PARTLY_SUPPORTED"
        ? (result === null || result === "SHOWN_IN_PART") &&
          passages.length > 0 &&
          (elements.length === 0 ||
            (each(["MET", "NOT_ADDRESSED"]) &&
              some("MET") &&
              some("NOT_ADDRESSED")))
        : said === "ISSUE"
          ? result === null || ISSUE_RESULTS.includes(result)
          : said === "NOT_ADDRESSED"
            ? result === null || result === "NOT_ADDRESSED"
            : said === "UNSETTLED";
  const verdict: Verdict = said !== null && stands ? said : "UNSETTLED";
  const findingId = verdict === "ISSUE" ? uuidOrNull(value.finding_id) : null;
  return {
    attributeId,
    code,
    expected: value.expected === true,
    verdict,
    understood: said !== null && stands,
    result: verdict === "UNSETTLED" ? null : result,
    shows:
      (verdict === "SUPPORTED" || verdict === "PARTLY_SUPPORTED") &&
      (value.shows === "DESIGN" || value.shows === "IMPLEMENTATION")
        ? value.shows
        : null,
    elements,
    summary: str(value.summary),
    passages,
    absent: strings(value.absent, 12),
    // Both readings: where they do not agree, and where the request does not ask for
    // the attribute (available on open, never a judgment).
    views:
      verdict === "UNSETTLED" || verdict === "NOT_ADDRESSED"
        ? (Array.isArray(value.views) ? value.views : [])
            .map(parseView)
            .filter((item): item is View => item !== null)
            .slice(0, 2)
        : [],
    findingId,
    findingStatus:
      findingId === null
        ? null
        : (FINDING_STATUSES.find((item) => item === value.finding_status) ??
          null),
  };
}

function parseHeldFile(value: unknown): HeldFile | null {
  if (!isRecord(value)) {
    return null;
  }
  const fileId = uuidOrNull(value.file_id);
  return fileId === null
    ? null
    : { fileId, code: heldCode(value.code), reason: str(value.reason) };
}

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

function parseRequest(value: unknown): AssuredRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  const requirementId = uuidOrNull(value.requirement_id);
  if (requirementId === null) {
    return null;
  }
  const outOfDate = strings(value.out_of_date, 6);
  const said = STATUSES.find((item) => item === value.status) ?? null;
  // A status this page does not know reads as still being checked: nothing of the run
  // is shown. A finished run the server also marks out of date is out of date.
  const status: CheckStatus =
    said === null
      ? "CHECKING"
      : said === "REVIEWED" && outOfDate.length > 0
        ? "OUT_OF_DATE"
        : said;
  const held = isRecord(value.held) ? value.held : null;
  const fileIds = distinct(
    (Array.isArray(value.file_ids) ? value.file_ids : [])
      .map(uuidOrNull)
      .filter((id): id is string => id !== null),
    (id) => id,
  );
  const only = fileIds.length === 1 ? (fileIds[0] ?? null) : null;
  return {
    requirementId,
    runId: uuidOrNull(value.run_id),
    status,
    stage: STAGES.find((item) => item === value.stage) ?? null,
    held:
      status !== "HELD"
        ? null
        : { code: heldCode(held?.code), reason: str(held?.reason) },
    heldFiles: distinct(
      (Array.isArray(value.held_files) ? value.held_files : [])
        .map(parseHeldFile)
        .filter((item): item is HeldFile => item !== null),
      (item) => item.fileId,
    ),
    fileIds,
    lens:
      value.lens === "DESIGN_DOCUMENT" || value.lens === "INSTANCE_RECORD"
        ? value.lens
        : null,
    readInPart: value.read_in_part === true,
    // Nothing of a run is shown before it finishes, or once it is out of date. One
    // state per attribute: an attribute listed twice keeps its first answer.
    attributes:
      status === "REVIEWED"
        ? distinct(
            (Array.isArray(value.attributes) ? value.attributes : [])
              .map((item) => parseAttribute(item, only))
              .filter((item): item is AssuredAttribute => item !== null),
            (item) => item.attributeId || `code:${item.code}`,
          )
        : [],
    outOfDate,
    note: status === "FAILED" ? str(value.note).slice(0, 300) : "",
    finishedAt: str(value.finished_at) || null,
  };
}

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;

function parseSummary(value: unknown): AssuranceSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    checking: count(value.checking),
    held: count(value.held),
    failed: count(value.failed),
    outOfDate: count(value.out_of_date),
    supported: count(value.supported),
    issues: count(value.issues),
    unsettled: count(value.unsettled),
  };
}

/** The API's answer for a control (GET .../evidence-assurance); null when the body is
 * not one. One entry per request: one listed twice keeps its first entry. */
export function parseAssurance(value: unknown): EvidenceAssurance | null {
  if (!isRecord(value) || !Array.isArray(value.requests)) {
    return null;
  }
  return {
    requests: distinct(
      value.requests
        .map(parseRequest)
        .filter((item): item is AssuredRequest => item !== null),
      (item) => item.requirementId,
    ),
    summary: parseSummary(value.summary),
  };
}

/** An issue a person has disposed of: its finding is dismissed, resolved, its
 * clarification accepted, or marked not applicable. It is no longer open. */
export function issueDecided(item: AssuredAttribute): boolean {
  return (
    item.verdict === "ISSUE" &&
    item.findingStatus !== null &&
    CLOSED_STATUSES.includes(item.findingStatus)
  );
}

// The step's line

export type AssuranceCounts = {
  /** Requests the chain has an entry for. */
  requests: number;
  /** Requests with files and no check yet. */
  notChecked: number;
  /** Requests whose check is queued or at work. */
  checking: number;
  /** Requests whose check is on hold. */
  held: number;
  /** Requests whose check failed or is out of date: to run again. */
  again: number;
  /** Open results both readings agree are an issue. */
  issues: number;
  /** Results that need the person's judgment. */
  unsettled: number;
};

/**
 * What the step's line counts, from the server's `summary` (its issues are the open
 * ones), never below what the requests on the page themselves show (a result this page
 * read cautiously as needing judgment is counted, though the server's summary could not
 * know it). An issue a person has decided is not counted. Support is not counted here:
 * the step's line never states it.
 */
export function assuranceCounts(
  assurance: EvidenceAssurance | null,
): AssuranceCounts {
  const requests = assurance?.requests ?? [];
  const attributes = requests.flatMap((item) => item.attributes);
  const summary = assurance?.summary ?? null;
  const has = (...statuses: CheckStatus[]) =>
    requests.filter((item) => statuses.includes(item.status)).length;
  const said = (value: number | null | undefined) => value ?? 0;
  return {
    requests: requests.length,
    notChecked: has("NOT_CHECKED"),
    checking: Math.max(said(summary?.checking), has("QUEUED", "CHECKING")),
    held: Math.max(said(summary?.held), has("HELD")),
    again: Math.max(
      said(summary?.failed) + said(summary?.outOfDate),
      has("FAILED", "OUT_OF_DATE"),
    ),
    issues: Math.max(
      said(summary?.issues),
      attributes.filter(
        (item) => item.verdict === "ISSUE" && !issueDecided(item),
      ).length,
    ),
    unsettled: Math.max(
      said(summary?.unsettled),
      attributes.filter((item) => item.verdict === "UNSETTLED").length,
    ),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What follows "N files to review" on the step's pill: what needs the person first,
 * then what is on hold, then what is to run again or not run yet, then what is still
 * being checked. "" when nothing does. */
export function assurancePill(counts: AssuranceCounts): string {
  const parts =
    counts.issues + counts.unsettled > 0
      ? [
          counts.issues > 0 ? plural(counts.issues, "issue") : "",
          counts.unsettled > 0 ? `${counts.unsettled} for your judgment` : "",
        ]
      : counts.held > 0
        ? [`${counts.held} on hold`]
        : counts.again > 0
          ? [`${counts.again} to check again`]
          : counts.notChecked > 0
            ? [`${counts.notChecked} not checked yet`]
            : counts.checking > 0
              ? [`${counts.checking} being checked`]
              : [];
  return parts.filter((part) => part !== "").join(" · ");
}

/** The step's decision line on the checks, in one or two sentences; "" when the chain
 * has no entry for the control's requests. */
export function assuranceSentence(counts: AssuranceCounts): string {
  if (counts.requests === 0) {
    return "";
  }
  const found = [
    counts.issues > 0 ? plural(counts.issues, "open issue") : "",
    counts.unsettled > 0
      ? `${plural(counts.unsettled, "result")} for your judgment`
      : "",
  ].filter((part) => part !== "");
  const waiting = [
    counts.held > 0
      ? `${plural(counts.held, "request")} on hold until you act on ${counts.held === 1 ? "its" : "their"} row`
      : "",
    counts.again > 0 ? `${plural(counts.again, "check")} to run again` : "",
    counts.notChecked > 0
      ? `${plural(counts.notChecked, "request")} not checked yet`
      : "",
    counts.checking > 0
      ? `${plural(counts.checking, "request")} still being checked`
      : "",
  ].filter((part) => part !== "");
  const reviewed =
    counts.requests -
      counts.checking -
      counts.held -
      counts.again -
      counts.notChecked >
    0;
  const lead =
    found.length > 0
      ? `Two independent readings checked the evidence against the attributes: ${found.join(", ")}. See each row.`
      : reviewed
        ? "Two independent readings checked the evidence against the attributes: no open issue, and nothing left for your judgment. What each row supports is on the row."
        : "";
  const rest =
    waiting.length === 0
      ? ""
      : `${waiting.join(", ").replace(/^./, (first) => first.toUpperCase())}.`;
  return [lead, rest].filter((part) => part !== "").join(" ");
}

// One attribute, as a row shows it

export type AttributeState =
  | "SUPPORTED"
  | "PARTLY"
  | "ISSUE"
  | "DECIDED"
  | "JUDGMENT"
  | "NOT_ADDRESSED";

export type Tone = "success" | "danger" | "warning" | "neutral";

/** Each state in words with its mark: the colour repeats them and never replaces them. */
export const STATE_WORDS: Record<
  AttributeState,
  { label: string; icon: IconName; tone: Tone }
> = {
  SUPPORTED: { label: "Supported", icon: "check", tone: "success" },
  PARTLY: {
    label: "Shown in part by this request",
    icon: "layers",
    tone: "neutral",
  },
  ISSUE: { label: "Issue", icon: "risk", tone: "danger" },
  DECIDED: { label: "Issue decided", icon: "check", tone: "neutral" },
  JUDGMENT: { label: "Your judgment needed", icon: "help", tone: "warning" },
  NOT_ADDRESSED: { label: "Not addressed", icon: "minus", tone: "neutral" },
};

/** What supported evidence shows, in words. */
const SHOWS_WORDS: Record<Shows, string> = {
  DESIGN: "design",
  IMPLEMENTATION: "implementation",
};

/** How a person decided an issue's finding, in words: "Issue: decided by dismissal". */
const DECIDED_WORDS: Partial<Record<FindingStatus, string>> = {
  DISMISSED: "dismissal",
  RESOLVED: "resolution",
  CLARIFICATION_ACCEPTED: "an accepted clarification",
  NOT_APPLICABLE: "marking it not applicable",
};

/** What a reading found, in an auditor's words. A reading with no result this page
 * knows could not tell. */
const RESULT_WORDS: Record<Result, string> = {
  MET: "Shown",
  PARTLY_MET: "Shown in part",
  NOT_MET: "Not shown",
  CONTRADICTED: "Contradicted in the evidence",
  CANNOT_TELL: "Could not tell",
  NOT_ADDRESSED: "Not addressed by the evidence",
  SHOWN_IN_PART: "Shown in part",
};

/** An issue's result in its label. NOT_MET is "not met", never "not shown": it also
 * means an exception a record shows (a self-approval), which the summary names. */
const ISSUE_WORDS: Partial<Record<Result, string>> = {
  NOT_MET: "not met",
  PARTLY_MET: "met in part",
  CONTRADICTED: "contradicted in the evidence",
  NOT_ADDRESSED: "not addressed by the evidence",
};

/** An element's result, in words; null where the two readings differ on it. */
const ELEMENT_WORDS: Record<ElementResult, string> = {
  MET: "Shown",
  PARTLY_MET: "Shown in part",
  NOT_MET: "Not shown",
  CONTRADICTED: "Contradicted in the evidence",
  CANNOT_TELL: "Could not tell",
  NOT_ADDRESSED: "Not in these files",
};

export function elementWords(result: ElementResult | null): string {
  return result === null ? "Your judgment needed" : ELEMENT_WORDS[result];
}

const ELEMENT_TONES: Record<ElementResult, Tone> = {
  MET: "success",
  PARTLY_MET: "warning",
  NOT_MET: "danger",
  CONTRADICTED: "danger",
  CANNOT_TELL: "warning",
  NOT_ADDRESSED: "neutral",
};

export function resultWords(result: Result | null): string {
  return result === null ? "Could not tell" : RESULT_WORDS[result];
}

const ROLE_WORDS: Record<View["role"], string> = {
  ASSESSOR: "First reading",
  REVIEWER: "Second, independent reading",
};

/** Under an attribute the two readings do not agree on (section 3, stage 5). */
export const READINGS_DISAGREE =
  "The two readings do not agree. Your judgment is needed.";
/** Under a result this page could not take as it stands: it does not claim two readings
 * disagree, only that the person judges. */
export const RESULT_UNREAD =
  "This result could not be read as it was sent, so it is not shown as supported. Your judgment is needed.";

function stateOf(item: AssuredAttribute): AttributeState {
  if (item.verdict === "UNSETTLED") {
    return "JUDGMENT";
  }
  if (item.verdict === "PARTLY_SUPPORTED") {
    return "PARTLY";
  }
  return issueDecided(item) ? "DECIDED" : item.verdict;
}

/** A file of the request's row: its id and its name. */
export type RowFile = { id: string; name: string };

/** A passage as the row shows it: which file it is in where the request has more than
 * one, and whether the viewer can open it there. */
export type ShownPassage = Passage & {
  /** The file's name, where the request has more than one file; "" otherwise. */
  fileLabel: string;
  /** The passage's file is one of the row's, so the viewer opens it there. */
  opens: boolean;
};

/** An element as an opened attribute lists it: its text and its result in words. */
export type ElementLine = {
  key: string;
  text: string;
  /** "Shown", "Not shown", "Not in these files", "Your judgment needed". */
  result: string;
  tone: Tone;
  absent: string[];
};

export type AttributeLine = {
  /** The attribute's id, or its code where the server sent no id. */
  key: string;
  attributeId: string;
  letter: string;
  /** The attribute's wording; "" where it is no longer on the control. */
  text: string;
  /** The request asks for it. */
  expected: boolean;
  state: AttributeState;
  /** What supported evidence shows; null otherwise. */
  shows: Shows | null;
  /** The attribute's elements, each with its result in words. */
  elements: ElementLine[];
  /** For an attribute shown in part: what this request shows, and what it leaves to
   * other requests; null otherwise. */
  inPart: { shows: string[]; leaves: string[] } | null;
  /** "Supported (implementation)", "Issue: not shown", "Issue: decided by dismissal",
   * "Your judgment needed", "Not addressed". */
  label: string;
  icon: IconName;
  tone: Tone;
  summary: string;
  passages: ShownPassage[];
  absent: string[];
  /** The sentence over the two readings; null unless the person's judgment is needed. */
  judgment: string | null;
  /** Both readings: side by side where they do not agree, or on open where the request
   * does not ask for the attribute. */
  readings: Array<{ who: string; result: string; reason: string }>;
  /** The evidence finding that records the issue; null where there is none. */
  findingId: string | null;
  /** It opens by itself: an open issue, or a judgment the person owes. */
  open: boolean;
};

export type Lettered = { id: string; letter: string; text: string };

function labelOf(item: AssuredAttribute, state: AttributeState): string {
  const words = STATE_WORDS[state];
  if (state === "SUPPORTED" || state === "PARTLY") {
    return item.shows === null
      ? words.label
      : `${words.label} (${SHOWS_WORDS[item.shows]})`;
  }
  if (state === "DECIDED") {
    const how =
      item.findingStatus === null
        ? undefined
        : DECIDED_WORDS[item.findingStatus];
    return how === undefined ? "Issue: decided" : `Issue: decided by ${how}`;
  }
  if (state === "ISSUE" && item.result !== null) {
    const said = ISSUE_WORDS[item.result];
    return said === undefined ? words.label : `${words.label}: ${said}`;
  }
  return words.label;
}

function attributeLine(
  item: AssuredAttribute,
  attributes: readonly Lettered[],
  files: readonly RowFile[],
  many: boolean,
): AttributeLine {
  const known = attributes.find((each) => each.id === item.attributeId);
  const state = stateOf(item);
  const words = STATE_WORDS[state];
  return {
    key: item.attributeId !== "" ? item.attributeId : item.code,
    attributeId: item.attributeId,
    letter: known?.letter ?? item.code,
    text: known?.text ?? "",
    expected: item.expected,
    state,
    shows: state === "SUPPORTED" || state === "PARTLY" ? item.shows : null,
    elements: item.elements.map((element) => ({
      key: element.key,
      text: element.text,
      result: elementWords(element.result),
      tone: element.result === null ? "warning" : ELEMENT_TONES[element.result],
      absent: element.absent,
    })),
    inPart:
      state !== "PARTLY"
        ? null
        : {
            shows: item.elements
              .filter((element) => element.result === "MET")
              .map((element) => element.text),
            leaves: item.elements
              .filter((element) => element.result !== "MET")
              .map((element) => element.text),
          },
    label: labelOf(item, state),
    icon: words.icon,
    tone: words.tone,
    summary: item.summary,
    passages: item.passages.map((passage) => {
      const file = files.find((each) => each.id === passage.fileId);
      return {
        ...passage,
        fileLabel: !many
          ? ""
          : (file?.name ??
            (passage.fileId === null
              ? "The file is not named"
              : "A file no longer on this request")),
        opens: file !== undefined,
      };
    }),
    absent: item.absent,
    judgment:
      state !== "JUDGMENT"
        ? null
        : item.understood
          ? READINGS_DISAGREE
          : RESULT_UNREAD,
    readings: item.views.map((view) => ({
      who: ROLE_WORDS[view.role],
      result: resultWords(view.result),
      reason: view.reason,
    })),
    findingId: item.findingId,
    open: state === "ISSUE" || state === "JUDGMENT",
  };
}

// A request's check, as its row shows it

export type CheckStanding =
  | "NOT_CHECKED"
  | "CHECKING"
  | "HELD"
  | "FAILED"
  | "OUT_OF_DATE"
  | "REVIEWED";

export type CheckActionKind =
  | "CONFIRM_TYPE"
  | "REPLACE"
  | "REREAD"
  | "PICK_INSTANCE"
  | "RERUN";

/** The one action that clears a hold, or runs the check. A file's action names its
 * file; running the check is the request's. */
export type CheckAction = {
  kind: CheckActionKind;
  label: string;
  fileId: string | null;
};

const FILE_ACTIONS: Partial<
  Record<HeldCode, { kind: CheckActionKind; label: string }>
> = {
  // Cleared in the evidence dialog, where the file's type is confirmed.
  KIND_UNSURE: { kind: "CONFIRM_TYPE", label: "Confirm the file's type" },
  UNREADABLE: { kind: "REPLACE", label: "Replace the file" },
  CUSTODY: { kind: "REPLACE", label: "Replace the file" },
  // The reading itself failed: the file is read again (the reader's own re-read).
  READ_FAILED: { kind: "REREAD", label: "Read the file again" },
  // Picked in the evidence dialog, on the population's own rows.
  POPULATION: { kind: "PICK_INSTANCE", label: "Pick the walkthrough instance" },
};

/** Why the whole request is held, where the gate sent no sentence of its own. */
const HELD_REASONS: Record<HeldCode, string> = {
  KIND_UNSURE:
    "The file's type is not confirmed, so the evidence has not been checked against the attributes.",
  UNREADABLE:
    "Nothing readable could be taken from the evidence, so it has not been checked against the attributes.",
  CUSTODY:
    "The evidence did not pass its custody check, so it has not been checked against the attributes.",
  READ_FAILED:
    "Reading the file did not finish, so the evidence has not been checked against the attributes.",
  POPULATION:
    "The file is a population. The walkthrough instance is picked first, then its records are checked.",
  NO_ATTRIBUTES:
    "The control has no approved attribute, so there is nothing to check the evidence against.",
  TOO_LARGE:
    "The request's files are too large together to be read in one check, so they have not been checked against the attributes.",
  OTHER: "The check is on hold.",
};

/** Why one file was left out, where the gate sent no sentence of its own. */
const FILE_REASONS: Record<HeldCode, string> = {
  KIND_UNSURE: "Its type is not confirmed.",
  UNREADABLE: "Nothing readable could be taken from it.",
  CUSTODY: "It did not pass its custody check.",
  READ_FAILED: "Reading it did not finish.",
  POPULATION: "It is a population: the walkthrough instance is picked first.",
  NO_ATTRIBUTES: "It was not checked.",
  TOO_LARGE: "It is too large to be read with the other files.",
  OTHER: "It was not checked.",
};

/** Said of a file of the row the server lists neither as read nor as left out. */
export const NOT_LISTED = "It is not part of this check.";

const STAGE_WORDS: Partial<Record<Stage, string>> = {
  ASSESS: "first reading",
  VERIFY: "second, independent reading",
  COMPARE: "comparing the two readings",
};

/** A file left out of the readings, with why and the action that clears it. */
export type LeftOutLine = {
  fileId: string;
  /** "Checked without SAP_ticket.pdf: Its type is not confirmed." */
  line: string;
  action: CheckAction | null;
};

export type RequestCheck = {
  standing: CheckStanding;
  /** The one line: what the check is doing, why it is held, or what it was checked
   * against. */
  line: string;
  /** Where a check at work has got to ("second, independent reading"); "" otherwise. */
  stage: string;
  /** The single action that clears a hold, or runs the check; null when a person can do
   * nothing about it here. Offered only to a person who may act (offeredAction). */
  action: CheckAction | null;
  /** "The evidence was read in part.", where it was; null otherwise. */
  readInPart: string | null;
  /** Files of the request the readings did not include, each with why. */
  leftOut: LeftOutLine[];
  /** Open issues and judgments first, then what is supported, then decided issues, in
   * the attributes' order. */
  attributes: AttributeLine[];
  /** Attributes the request asks for that the evidence does not bear on, folded. */
  notAddressed: AttributeLine[];
  /** Attributes the request does not ask for and the evidence does not bear on: one
   * folded line, both readings on open. */
  notAsked: AttributeLine[];
};

/** A sentence as the server sent it, closed with a full stop. */
const sentence = (text: string) =>
  text === "" || /[.!?…]$/.test(text) ? text : `${text}.`;

/** Letters as a person says them ("A to C", "A and C"), in the list's own way. */
export type Span = (letters: readonly string[]) => string;

/** "against attributes A to C", "against attribute A", "against the attributes". */
function against(letters: readonly string[], span: Span): string {
  return letters.length === 0
    ? "against the attributes"
    : `against attribute${letters.length === 1 ? "" : "s"} ${span(letters)}`;
}

export const READ_IN_PART = "The evidence was read in part.";
export const NOT_CHECKED_LINE = "Not checked against the attributes yet";

/** One request's check as its row shows it. `attributes` are the control's approved
 * attributes with the list's letters: every one of them is checked. `files` are the
 * row's in-force files. */
export function requestCheck(
  request: AssuredRequest,
  attributes: readonly Lettered[],
  files: readonly RowFile[],
  span: Span,
): RequestCheck {
  const all = attributes.map((item) => item.letter);
  const nameOf = (fileId: string) =>
    files.find((each) => each.id === fileId)?.name ?? "a file";
  const fileAction = (code: HeldCode, fileId: string): CheckAction | null => {
    const action = FILE_ACTIONS[code];
    return action === undefined ? null : { ...action, fileId };
  };
  const reviewed = request.status === "REVIEWED";
  const working = request.status === "QUEUED" || request.status === "CHECKING";
  const lead = (name: string) =>
    reviewed
      ? `Checked without ${name}: `
      : working
        ? `Being checked without ${name}: `
        : `Left out of the check, ${name}: `;
  const leftOut: LeftOutLine[] = [
    ...request.heldFiles.map((held) => ({
      fileId: held.fileId,
      line: `${lead(nameOf(held.fileId))}${sentence(held.reason) || FILE_REASONS[held.code]}`,
      action: fileAction(held.code, held.fileId),
    })),
    // A file of the row the finished check lists neither as read nor as left out: said,
    // never passed over (the third error of section 1).
    ...(reviewed
      ? files
          .filter(
            (file) =>
              !request.fileIds.includes(file.id) &&
              !request.heldFiles.some((held) => held.fileId === file.id),
          )
          .map((file) => ({
            fileId: file.id,
            line: `${lead(file.name)}${NOT_LISTED}`,
            action: null,
          }))
      : []),
  ];
  const rerun = (label: string): CheckAction => ({
    kind: "RERUN",
    label,
    fileId: null,
  });
  const base = {
    stage: "",
    action: null,
    readInPart: null,
    leftOut,
    attributes: [],
    notAddressed: [],
    notAsked: [],
  };
  if (request.status === "NOT_CHECKED") {
    return {
      ...base,
      leftOut: [],
      standing: "NOT_CHECKED",
      line: NOT_CHECKED_LINE,
      action: rerun("Check now"),
    };
  }
  if (working) {
    return {
      ...base,
      standing: "CHECKING",
      line: `${request.status === "QUEUED" ? "Waiting to check" : "Checking"} ${against(all, span)}`,
      stage:
        request.status === "CHECKING" && request.stage !== null
          ? (STAGE_WORDS[request.stage] ?? "")
          : "",
    };
  }
  if (request.status === "HELD") {
    const code = request.held?.code ?? "OTHER";
    // The request is held for a file's reason: the file's action, where it is plain
    // which file it is (the row's only file; a file left out carries its own).
    const candidates =
      request.heldFiles.length > 0
        ? []
        : files.length === 1
          ? files.map((file) => file.id)
          : [];
    const [only] = candidates;
    return {
      ...base,
      standing: "HELD",
      // The gate's own sentence where it sent one; this page's otherwise.
      line: sentence(request.held?.reason ?? "") || HELD_REASONS[code],
      action: only === undefined ? null : fileAction(code, only),
    };
  }
  if (request.status === "FAILED") {
    return {
      ...base,
      standing: "FAILED",
      line: [
        "The check did not finish, so nothing of it is shown.",
        sentence(request.note),
      ]
        .filter((part) => part !== "")
        .join(" "),
      action: rerun("Check again"),
    };
  }
  if (request.status === "OUT_OF_DATE") {
    return {
      ...base,
      standing: "OUT_OF_DATE",
      line: [
        "The check is out of date, so its results are not shown.",
        ...request.outOfDate.map(sentence),
      ].join(" "),
      action: rerun("Check again"),
    };
  }
  const rank: Record<AttributeState, number> = {
    ISSUE: 0,
    JUDGMENT: 1,
    SUPPORTED: 2,
    PARTLY: 3,
    DECIDED: 4,
    NOT_ADDRESSED: 5,
  };
  const place = (line: AttributeLine) => {
    const at = attributes.findIndex((each) => each.id === line.attributeId);
    return at < 0 ? attributes.length : at;
  };
  const inOrder = (a: AttributeLine, b: AttributeLine) =>
    place(a) - place(b) || a.letter.localeCompare(b.letter);
  const many =
    new Set([...files.map((file) => file.id), ...request.fileIds]).size > 1;
  const lines = request.attributes
    .map((item) => attributeLine(item, attributes, files, many))
    .sort((a, b) => rank[a.state] - rank[b.state] || inOrder(a, b));
  const read = request.fileIds.length;
  return {
    ...base,
    standing: "REVIEWED",
    line:
      lines.length === 0
        ? "The check finished without a result for any attribute."
        : `Checked ${against(
            [...lines].sort(inOrder).map((line) => line.letter),
            span,
          )} by two independent readings${read > 1 ? `, reading ${read} files together` : ""}.`,
    readInPart: request.readInPart ? READ_IN_PART : null,
    attributes: lines.filter((line) => line.state !== "NOT_ADDRESSED"),
    notAddressed: lines.filter(
      (line) => line.state === "NOT_ADDRESSED" && line.expected,
    ),
    notAsked: lines.filter(
      (line) => line.state === "NOT_ADDRESSED" && !line.expected,
    ),
  };
}

/** The action as the person is offered it: only to a person who may act; a replacement
 * only where its file can be replaced now; a re-read only where its reading is known. */
export function offeredAction(
  action: CheckAction | null,
  facts: {
    canAct: boolean;
    replaceable: (fileId: string) => boolean;
    rereadable: (fileId: string) => boolean;
  },
): CheckAction | null {
  if (action === null || !facts.canAct) {
    return null;
  }
  if (action.kind === "REPLACE" || action.kind === "REREAD") {
    const able =
      action.kind === "REPLACE" ? facts.replaceable : facts.rereadable;
    return action.fileId !== null && able(action.fileId) ? action : null;
  }
  return action;
}

// One request row

/** How the row's own line groups its letters: each letter under one group. */
export type StateGroupKey =
  | "IMPLEMENTED"
  | "DESIGN"
  | "SUPPORTED"
  | "PARTLY"
  | "ISSUE"
  | "JUDGMENT"
  | "DECIDED";

export type StateGroup = {
  key: StateGroupKey;
  letters: string[];
  /** "A supported (implementation)", "B issue", "D your judgment needed". */
  label: string;
  icon: IconName;
  tone: Tone;
};

const GROUP_WORDS: Record<
  StateGroupKey,
  { words: string; state: AttributeState }
> = {
  IMPLEMENTED: { words: "supported (implementation)", state: "SUPPORTED" },
  DESIGN: { words: "supported (design)", state: "SUPPORTED" },
  SUPPORTED: { words: "supported", state: "SUPPORTED" },
  PARTLY: { words: "shown in part", state: "PARTLY" },
  ISSUE: { words: "issue", state: "ISSUE" },
  JUDGMENT: { words: "your judgment needed", state: "JUDGMENT" },
  DECIDED: { words: "issue decided", state: "DECIDED" },
};

const groupOf = (line: AttributeLine): StateGroupKey | null =>
  line.state === "SUPPORTED"
    ? line.shows === "IMPLEMENTATION"
      ? "IMPLEMENTED"
      : line.shows === "DESIGN"
        ? "DESIGN"
        : "SUPPORTED"
    : line.state === "NOT_ADDRESSED"
      ? null
      : line.state;

/** What one request's check shows of one attribute's elements: every element it read,
 * and the ones it shows, by what they show. An attribute sent without its elements is
 * one element, the whole attribute (key ""). */
export type AttributeElements = {
  attributeId: string;
  all: Array<{ key: string; text: string }>;
  implementation: string[];
  design: string[];
};

export type AssuranceRow = {
  standing: CheckStanding;
  /** The row's quiet line: "Checking against attributes A to C…", "Check on hold". */
  fact: string;
  check: RequestCheck;
  /** Beside the row's letters once the check is finished: each letter under its one
   * state. */
  states: StateGroup[];
  /** The same for a screen reader and the step's notes. */
  spoken: string;
  /** The attributes the check supports with records of an instance: accepting the row
   * marks these as evidenced, and no other. */
  implementedIds: string[];
  /** The attributes the check supports with the documented design only: accepting
   * marks them "design documented, implementation not yet shown". */
  designIds: string[];
  /** Each attribute's elements as this request's check shows them: the coverage
   * combines them across the control's requests (attributeCoverage). */
  elementFacts: AttributeElements[];
  /** Beside Accept: what accepting marks as evidenced, and what it does not settle. */
  acceptNote: string;
  /** The check is queued or at work: the list is read again until it ends. */
  working: boolean;
};

/** An element is shown where both readings agree it is met and a verified passage of
 * the files rests under it, on an attribute whose support stands. */
function elementFacts(request: AssuredRequest): AttributeElements[] {
  return request.attributes
    .filter((item) => item.attributeId !== "")
    .map((item) => {
      const supports =
        item.verdict === "SUPPORTED" || item.verdict === "PARTLY_SUPPORTED";
      const shown = !supports
        ? []
        : item.elements.length > 0
          ? item.elements
              .filter(
                (element) =>
                  element.result === "MET" && element.passages.length > 0,
              )
              .map((element) => element.key)
          : // Without its elements, only whole support shows the whole attribute.
            item.verdict === "SUPPORTED"
            ? [""]
            : [];
      return {
        attributeId: item.attributeId,
        all:
          item.elements.length > 0
            ? item.elements.map((element) => ({
                key: element.key,
                text: element.text,
              }))
            : [{ key: "", text: "" }],
        implementation: item.shows === "IMPLEMENTATION" ? shown : [],
        design: item.shows === "DESIGN" ? shown : [],
      };
    });
}

/** A request with files the server sent no entry for: it has not been checked against
 * the attributes (the server always sends at least NOT_CHECKED; where it does not, the
 * row says so and offers Check now, and nothing of it evidences). */
export function notChecked(requirementId: string): AssuredRequest {
  return {
    requirementId,
    runId: null,
    status: "NOT_CHECKED",
    stage: null,
    held: null,
    heldFiles: [],
    fileIds: [],
    lens: null,
    readInPart: false,
    attributes: [],
    outOfDate: [],
    note: "",
    finishedAt: null,
  };
}

/** The read, with a not-checked entry for each request with files it does not list. */
export function withNotChecked(
  assurance: EvidenceAssurance,
  requirementIds: readonly string[],
): EvidenceAssurance {
  const listed = new Set(assurance.requests.map((item) => item.requirementId));
  return {
    ...assurance,
    requests: [
      ...assurance.requests,
      ...requirementIds
        .filter((id) => !listed.has(id))
        .map((id) => notChecked(id)),
    ],
  };
}

/** The attributes some request of the control sends with their elements. */
export function keyedOf(assurance: EvidenceAssurance | null): Set<string> {
  return new Set(
    (assurance?.requests ?? []).flatMap((request) =>
      request.attributes
        .filter((item) => item.attributeId !== "" && item.elements.length > 0)
        .map((item) => item.attributeId),
    ),
  );
}

/** Beside Accept, where accepting the request evidences an attribute only together
 * with other requests. */
export const SAME_INSTANCE =
  "Check that these requests show the same instance.";

export type AttributeCoverage = {
  /** EVIDENCED: every element shown by the records of an instance in an accepted
   * request. DESIGN_ONLY: every element the instances do not show is documented in an
   * accepted request's design. PARTLY: accepted requests show some elements, not all.
   * NONE: no accepted request's check shows any. UNKNOWN: no check read the attribute. */
  state: "EVIDENCED" | "DESIGN_ONLY" | "PARTLY" | "NONE" | "UNKNOWN";
  /** The elements no accepted request shows from the records of an instance, by their
   * text. Empty where the elements were not sent. */
  missing: string[];
  /** For an evidenced attribute, how many accepted requests its elements are shown
   * across: 1 where one request shows them all; 2 or more where they are combined (the
   * person checks that those requests show the same instance). 0 otherwise. */
  across: number;
};

/**
 * Whether an attribute is evidenced at D&I, combining its elements across the control's
 * requests by key: only when every element is shown with `shows: IMPLEMENTATION` by
 * some accepted request (docs/evidence-assurance.md, section 3). A request's check whose
 * attribute came without its elements counts as one element, the whole attribute; it
 * covers the attribute only where no request sends the attribute's elements. Where one
 * does, a check without them covers nothing (no wildcard): which elements it showed is
 * not known.
 */
export function attributeCoverage(
  attributeId: string,
  entries: ReadonlyArray<{ accepted: boolean; facts: AttributeElements[] }>,
): AttributeCoverage {
  const facts = entries.flatMap((entry) =>
    entry.facts
      .filter((fact) => fact.attributeId === attributeId)
      .map((fact) => ({ accepted: entry.accepted, fact })),
  );
  if (facts.length === 0) {
    return { state: "UNKNOWN", missing: [], across: 0 };
  }
  const texts = new Map<string, string>();
  for (const { fact } of facts) {
    for (const element of fact.all) {
      if (!texts.has(element.key)) {
        texts.set(element.key, element.text);
      }
    }
  }
  const keyed = [...texts.keys()].some((key) => key !== "");
  const universe = [...texts.keys()].filter((key) => !keyed || key !== "");
  const accepted = facts
    .filter((item) => item.accepted)
    .map((item) => item.fact);
  // The elements of the universe one fact shows: none from a check without its
  // elements where others sent them.
  const shownBy = (
    fact: AttributeElements,
    pick: (each: AttributeElements) => string[],
  ) => universe.filter((key) => pick(fact).includes(key));
  const by = (pick: (fact: AttributeElements) => string[]) => {
    const keys = new Set(accepted.flatMap((fact) => shownBy(fact, pick)));
    return (key: string) => keys.has(key);
  };
  const implementation = (fact: AttributeElements) => fact.implementation;
  const implemented = by(implementation);
  const designed = by((fact) => fact.design);
  const missing = universe.filter((key) => !implemented(key));
  const words = missing
    .map((key) => texts.get(key) ?? "")
    .filter((text) => text !== "");
  if (missing.length === 0) {
    const alone = accepted.some(
      (fact) => shownBy(fact, implementation).length === universe.length,
    );
    return {
      state: "EVIDENCED",
      missing: [],
      across: alone
        ? 1
        : accepted.filter((fact) => shownBy(fact, implementation).length > 0)
            .length,
    };
  }
  const anyShown = universe.some((key) => implemented(key) || designed(key));
  return {
    state: !anyShown
      ? "NONE"
      : missing.every((key) => designed(key))
        ? "DESIGN_ONLY"
        : "PARTLY",
    missing: words,
    across: 0,
  };
}

const STANDING_FACTS: Record<Exclude<CheckStanding, "CHECKING">, string> = {
  NOT_CHECKED: "Not checked yet",
  HELD: "Check on hold",
  FAILED: "Check did not finish",
  OUT_OF_DATE: "Check out of date",
  REVIEWED: "Checked by two readings",
};

/** Said of an attribute whose support is the documented design alone. */
export const DESIGN_ONLY = "design documented, implementation not yet shown";

/**
 * What a request row shows of its check; null when the chain has no entry for the
 * request (the row then reads as it did before the chain).
 */
export function assuranceRow(input: {
  /** The request the row is. */
  requirementId: string;
  /** The row's in-force files. */
  files: readonly RowFile[];
  assurance: EvidenceAssurance | null;
  /** The control's approved attributes, with the list's letters, in order. */
  attributes: readonly Lettered[];
  span: Span;
  /** Attributes some request of the control sends with their elements (keyedOf): a
   * check of one without them does not show it whole. */
  keyed?: ReadonlySet<string>;
}): AssuranceRow | null {
  const request =
    input.assurance?.requests.find(
      (item) => item.requirementId === input.requirementId,
    ) ?? null;
  if (request === null) {
    return null;
  }
  const check = requestCheck(
    request,
    input.attributes,
    input.files,
    input.span,
  );
  const order = input.attributes.map((item) => item.letter);
  const at = (letter: string) =>
    order.indexOf(letter) < 0 ? order.length : order.indexOf(letter);
  // In the attributes' order, as the row's letters are.
  const lettersOf = (key: StateGroupKey) =>
    check.attributes
      .filter((line) => groupOf(line) === key)
      .map((line) => line.letter)
      .sort((a, b) => at(a) - at(b) || a.localeCompare(b));
  const keys: StateGroupKey[] = [
    "IMPLEMENTED",
    "DESIGN",
    "SUPPORTED",
    "PARTLY",
    "ISSUE",
    "JUDGMENT",
    "DECIDED",
  ];
  const states: StateGroup[] = keys
    .map((key) => ({ key, letters: lettersOf(key) }))
    .filter((group) => group.letters.length > 0)
    .map(({ key, letters }) => ({
      key,
      letters,
      label: `${input.span(letters)} ${GROUP_WORDS[key].words}`,
      icon: STATE_WORDS[GROUP_WORDS[key].state].icon,
      tone: STATE_WORDS[GROUP_WORDS[key].state].tone,
    }));
  const idsOf = (key: StateGroupKey) =>
    check.attributes
      .filter((line) => groupOf(line) === key && line.attributeId !== "")
      .map((line) => line.attributeId);
  const left = check.leftOut.length;
  const facts = elementFacts(request);
  // Supported from an instance's records, with every element shown under a verified
  // passage: accepting marks it evidenced. Support whose elements are not all shown so
  // reads as shown in part.
  const whole = (letter: string) => {
    const line = check.attributes.find((each) => each.letter === letter);
    const fact = facts.find((each) => each.attributeId === line?.attributeId);
    if (fact === undefined) {
      return false;
    }
    const shown = new Set(fact.implementation);
    const unkeyed = fact.all.every((element) => element.key === "");
    if (unkeyed && input.keyed?.has(fact.attributeId) === true) {
      return false;
    }
    return fact.all.every((element) => shown.has(element.key));
  };
  const implemented = lettersOf("IMPLEMENTED");
  return {
    standing: check.standing,
    fact:
      check.standing === "CHECKING"
        ? `Checking ${against(order, input.span)}…`
        : check.standing === "REVIEWED" && left > 0
          ? `${STANDING_FACTS.REVIEWED}, ${plural(left, "file")} left out`
          : STANDING_FACTS[check.standing],
    check,
    states,
    spoken: states.map((group) => group.label).join(", "),
    implementedIds: idsOf("IMPLEMENTED"),
    designIds: idsOf("DESIGN"),
    elementFacts: facts,
    acceptNote: acceptNote({
      standing: check.standing,
      implemented: implemented.filter(whole),
      design: lettersOf("DESIGN"),
      unstated: lettersOf("SUPPORTED"),
      partly: [
        ...lettersOf("PARTLY"),
        ...implemented.filter((letter) => !whole(letter)),
      ].sort((a, b) => at(a) - at(b) || a.localeCompare(b)),
      issues: lettersOf("ISSUE"),
      judged: lettersOf("JUDGMENT"),
      decided: lettersOf("DECIDED"),
      leftOut: left,
      span: input.span,
    }),
    working: check.standing === "CHECKING",
  };
}

/**
 * Beside Accept: what accepting the row's evidence marks as evidenced (the attributes
 * the records of an instance show, and no other), and what it leaves open. It informs
 * and never blocks: Accept stays the person's.
 */
export function acceptNote(facts: {
  standing: CheckStanding;
  /** Supported by the records of an instance. */
  implemented: readonly string[];
  /** Supported by the documented design alone. */
  design: readonly string[];
  /** Supported, without the server saying by which. */
  unstated: readonly string[];
  /** Shown in part by this request, the rest left to other requests. */
  partly?: readonly string[];
  /** Open issues. */
  issues: readonly string[];
  judged: readonly string[];
  /** Issues a person has decided. */
  decided: readonly string[];
  /** Files of the request the readings did not include. */
  leftOut: number;
  span: Span;
}): string {
  const { span } = facts;
  if (facts.standing === "CHECKING") {
    return "The check is still running, so what accepting marks as evidenced is not known yet.";
  }
  if (facts.standing !== "REVIEWED") {
    return "This evidence has not been checked against the attributes, so accepting marks no attribute as evidenced.";
  }
  const open = facts.issues.length + facts.judged.length > 0;
  const many = (letters: readonly string[]) => letters.length !== 1;
  return [
    facts.implemented.length > 0
      ? `Accepting marks attribute${many(facts.implemented) ? "s" : ""} ${span(facts.implemented)} as evidenced.`
      : "Accepting marks no attribute as evidenced: the two readings find no record of an instance that shows one.",
    facts.design.length > 0 ? `${span(facts.design)}: ${DESIGN_ONLY}.` : "",
    facts.unstated.length > 0
      ? `${span(facts.unstated)} ${many(facts.unstated) ? "are" : "is"} supported, but the check does not say whether by the design or its implementation, so ${many(facts.unstated) ? "they are" : "it is"} not marked as evidenced.`
      : "",
    (facts.partly ?? []).length > 0
      ? `${span(facts.partly ?? [])} ${many(facts.partly ?? []) ? "are" : "is"} shown in part by this request; the rest is left to other requests, so ${many(facts.partly ?? []) ? "they are" : "it is"} evidenced only once they show it.`
      : "",
    facts.issues.length > 0
      ? `Both readings found an issue on ${span(facts.issues)}.`
      : "",
    facts.judged.length > 0
      ? `The readings do not agree on ${span(facts.judged)}: your judgment is needed.`
      : "",
    open ? "You can still accept; accepting does not settle these." : "",
    facts.decided.length > 0
      ? `The issue on ${span(facts.decided)} is decided, and ${many(facts.decided) ? "they are" : "it is"} not marked as evidenced.`
      : "",
    facts.leftOut > 0
      ? `${plural(facts.leftOut, "file")} ${facts.leftOut === 1 ? "was" : "were"} not part of the check.`
      : "",
  ]
    .filter((part) => part !== "")
    .join(" ");
}

// Polling while a check works

/** How long until the list is read again while a check works, by how long it has been
 * reading: every 5 seconds for the first minute, then every 15, and no more after 20
 * minutes (null), when the row says so instead. */
export function checkPollDelay(elapsedMs: number): number | null {
  if (elapsedMs < 60_000) {
    return 5_000;
  }
  return elapsedMs < 20 * 60_000 ? 15_000 : null;
}

export const STILL_CHECKING = "Still checking. Refresh to see the result.";

// Running a check, and reading a file again

type Fields = Record<string, unknown>;
type AssuranceWrite = { path: string } | { error: "invalid" };

/** The API call behind "Check again" and "Check now" (the /workspace/evidence-assurance
 * route): POST .../evidence-assurance/{requirement_id}/rerun, with no body. */
export function assuranceWrite(fields: Fields): AssuranceWrite {
  const [organizationId, projectId, controlId, requirementId] = [
    "organization_id",
    "project_id",
    "control_id",
    "requirement_id",
  ].map((key) => str(fields[key]));
  if (
    str(fields.intent) !== "rerun" ||
    ![organizationId, projectId, controlId, requirementId].every((id) =>
      UUID.test(id ?? ""),
    )
  ) {
    return { error: "invalid" };
  }
  return {
    path: `/organizations/${organizationId}/projects/${projectId}/controls/${controlId}/evidence-assurance/${requirementId}/rerun`,
  };
}

/** What a person reads when running the check did not go through; null when the
 * server confirmed it. */
export function assuranceProblem(status: number, detail = ""): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 409) {
    // The server says why in one plain sentence: shown as it is.
    return detail.trim() !== ""
      ? sentence(detail.trim())
      : "The check cannot be run now. The row is refreshed.";
  }
  if (status === 403) {
    return "Your role cannot run the check.";
  }
  if (status === 404) {
    return "This request is no longer here to check. Refresh the page.";
  }
  if (status === 422) {
    return "The check could not be started for this request. Refresh the page and try again.";
  }
  return "The check could not be started. Try again in a moment.";
}

/** What a person reads when reading a file again did not go through; null when the
 * server confirmed it. */
export function rereadProblem(status: number): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 409) {
    return "The file's reading changed meanwhile. The row is refreshed: check it and try again.";
  }
  if (status === 403 || status === 404) {
    return "Your role cannot read this file again.";
  }
  if (status === 422) {
    return "The file could not be read again. Refresh the page and try again.";
  }
  return "Reading the file again could not be started. Try again in a moment.";
}
