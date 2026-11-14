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
 *
 * Engine 2 (section 10) adds, for a finished check, the review a person reads first:
 * whether the evidence is sufficient for what the request tests, what is still open,
 * and what to ask for. It is proposed and never a conclusion: nothing of it accepts
 * evidence or decides a finding. A check of the first engine carries none, and reads
 * exactly as it did.
 */

import {
  CLOSED_STATUSES,
  FINDING_STATUSES,
  type FindingStatus,
} from "./evidence-findings-model.ts";
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

/** Where an attribute the request asks for stands (section 10.6). */
export const ASSESSMENTS = [
  "SATISFIED",
  "PARTIALLY_SUPPORTED",
  "CONTRADICTED",
  "NOT_DEMONSTRATED",
  "INDETERMINATE",
] as const;
export type Assessment = (typeof ASSESSMENTS)[number];

export const CODE_CHECK_STATUSES = [
  "PASSED",
  "FAILED",
  // It fails on one reading's values only.
  "FAILED_ONE",
  "NOT_RUN",
] as const;
export type CodeCheckStatus = (typeof CODE_CHECK_STATUSES)[number];

/** A comparison of the records' own values (a date before another, two names that
 * differ), made in code on the server, with its one sentence. */
export type CodeCheck = {
  element: string;
  test: string;
  status: CodeCheckStatus;
  sentence: string;
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
  /** Unsettled only because a file was not read (or was read in part): both readings stand
   * the same, and it waits on the file, not on a choice between readings. */
  pending: "" | "FILE_NOT_READ" | "READ_IN_PART";
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
  /** Where the attribute stands for the request (engine 2); null for an attribute the
   * request does not ask for, and for every attribute of an engine 1 check. */
  assessment: Assessment | null;
  /** The comparisons made in code for the attribute's elements (engine 2); empty
   * otherwise. */
  checks: CodeCheck[];
};

/** A file the gate left out of the readings; the run went ahead on the rest. */
export type HeldFile = { fileId: string; code: HeldCode; reason: string };

// The review of a request's evidence (section 10.7)

export const OUTCOMES = [
  "SUFFICIENT",
  "ADDITIONAL_EVIDENCE",
  "CLARIFICATION",
  "POTENTIAL_EXCEPTION",
  "UNABLE_TO_CONCLUDE",
] as const;
/** The check's proposed outcome for a request. Never a conclusion. */
export type Outcome = (typeof OUTCOMES)[number];

export const COMPLETENESS_STATES = [
  "COMPLETE",
  "INCOMPLETE",
  "PARTLY_UNREADABLE",
  "RELIABILITY_UNRESOLVED",
] as const;
export type CompletenessState = (typeof COMPLETENESS_STATES)[number];

const RELEVANCES = [
  "RELEVANT",
  "PARTLY_RELEVANT",
  "NOT_RELEVANT",
  "CANNOT_TELL",
] as const;
export type FileRelevance = (typeof RELEVANCES)[number];

const SOURCES = [
  "SYSTEM_RECORD",
  "MANAGEMENT_PREPARED",
  "DOCUMENT",
  "UNKNOWN",
] as const;
export type FileSource = (typeof SOURCES)[number];

const LEGIBILITIES = ["CLEAR", "PARTLY_UNREADABLE", "UNREADABLE"] as const;
export type FileLegibility = (typeof LEGIBILITIES)[number];

const REPORT_BASES = [
  "SHOWN",
  "PARTLY_SHOWN",
  "NOT_SHOWN",
  "NOT_A_REPORT",
] as const;
export type ReportBasis = (typeof REPORT_BASES)[number];

/** What the two readings say of one file the check read. */
export type ReviewFile = {
  fileId: string;
  relevance: FileRelevance;
  source: FileSource;
  legibility: FileLegibility;
  reportBasis: ReportBasis;
  notes: string[];
};

const PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type FollowUpPriority = (typeof PRIORITIES)[number];

/** Something to ask for, for an element the files do not show. Text for the person,
 * who sends it through the request's own follow-up step: the check sends nothing. */
export type FollowUp = {
  /** "" where the server sent none. */
  key: string;
  attributeIds: string[];
  codes: string[];
  elements: string[];
  missing: string;
  why: string;
  request: string;
  alternatives: string;
  kind: "EVIDENCE" | "CLARIFICATION";
  priority: FollowUpPriority;
  raisedBy: View["role"][];
  status: "OPEN" | "RESOLVED";
};

export type Review = {
  overall: Outcome;
  explanation: string;
  completeness: { state: CompletenessState; reasons: string[] };
  /** No fact of the control's understanding is confirmed. */
  contextThin: boolean;
  files: ReviewFile[];
  /** Files read as the type they appear to be: a person still confirms the type. */
  confirmations: HeldFile[];
  /** What code found on the facts both readings state alike (another system named,
   * different subjects, a date outside the period), each in one sentence. */
  concerns: Array<{ code: string; sentence: string; fileIds: string[] }>;
  followUps: FollowUp[];
  /** Open follow-ups the server (or this page's bound) did not list. */
  followUpsMore: number;
  /** Asks a reading made for an element that is shown: counted, never listed. */
  followUpsDropped: number;
  /** Follow-ups of the earlier check whose element the new evidence now supports. */
  resolved: Array<{ key: string; request: string; codes: string[] }>;
  /** What a careful auditor would raise that no attribute asks about. An observation:
   * never a finding, an attribute, or a change to the test plan. */
  considerations: Array<{
    text: string;
    passages: Passage[];
    raisedBy: View["role"][];
  }>;
};

/** The bounds on what is read of a review: a longer list is cut, never trusted. */
export const REVIEW_BOUNDS = {
  followUps: 12,
  considerations: 10,
  files: 60,
  checks: 12,
} as const;

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
  /** The server's failure sentence for a failed check, where it sent one
   * (run-failure.ts); absent otherwise. */
  failureNote?: string;
  finishedAt: string | null;
  /** Which engine made the run: 1 unless the server says 2 (section 10.1). */
  engineVersion: 1 | 2;
  /** The review of a finished engine 2 check; null for engine 1, for a check that is
   * not finished and current, and where what the server sent is not a review. */
  review: Review | null;
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

/** Sentences as sent: at most `limit` of them, each cut at `max` characters. */
const texts = (value: unknown, limit: number, max: number): string[] =>
  strings(value, limit).map((item) => item.slice(0, max));

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

/** The verdicts each assessment can come from (the table of section 10.6). */
const ASSESSMENT_VERDICTS: Record<Assessment, readonly Verdict[]> = {
  SATISFIED: ["SUPPORTED"],
  PARTIALLY_SUPPORTED: ["PARTLY_SUPPORTED", "ISSUE"],
  CONTRADICTED: ["ISSUE", "UNSETTLED"],
  NOT_DEMONSTRATED: ["ISSUE", "NOT_ADDRESSED"],
  INDETERMINATE: VERDICTS,
};

/**
 * Where an attribute stands, as sent, or the cautious reading: one this page does not
 * know, one its own verdict cannot come from (satisfied without support), one on a
 * result this page could not take as it stands, and one missing on an attribute the
 * request asks for all read as not determined. Never as satisfied.
 */
function assessmentOf(
  value: unknown,
  facts: { verdict: Verdict; understood: boolean; expected: boolean },
): Assessment | null {
  if (value === null || value === undefined) {
    return facts.expected ? "INDETERMINATE" : null;
  }
  const said = ASSESSMENTS.find((item) => item === value) ?? null;
  return said !== null &&
    facts.understood &&
    ASSESSMENT_VERDICTS[said].includes(facts.verdict)
    ? said
    : "INDETERMINATE";
}

/** A comparison made in code. A status this page does not know reads as not run: a
 * comparison supports nothing by itself, and is never shown as passed unless said. */
function parseCodeCheck(value: unknown): CodeCheck | null {
  if (!isRecord(value)) {
    return null;
  }
  const sentence = str(value.sentence).slice(0, 400);
  const test = str(value.test).slice(0, 40);
  if (sentence === "" && test === "") {
    return null;
  }
  return {
    element: str(value.element).slice(0, 80),
    test,
    status:
      CODE_CHECK_STATUSES.find((item) => item === value.status) ?? "NOT_RUN",
    sentence,
  };
}

function parseAttribute(
  value: unknown,
  only: string | null,
  engine: 1 | 2 = 1,
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
  const understood = said !== null && stands;
  const expected = value.expected === true;
  const findingId = verdict === "ISSUE" ? uuidOrNull(value.finding_id) : null;
  const views = (Array.isArray(value.views) ? value.views : [])
    .map(parseView)
    .filter((item): item is View => item !== null)
    .slice(0, 2);
  return {
    attributeId,
    code,
    expected,
    verdict,
    understood,
    pending:
      verdict === "UNSETTLED" &&
      (value.pending === "FILE_NOT_READ" || value.pending === "READ_IN_PART")
        ? value.pending
        : "",
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
    // the attribute (available on open, never a judgment). An issue shows them too where
    // the server sends one from each reading: a split shortfall, one reading finding it
    // not met and the other met in part (docs/evidence-assurance.md, rule 4).
    views:
      verdict === "UNSETTLED" || verdict === "NOT_ADDRESSED"
        ? views
        : verdict === "ISSUE" &&
            views.length === 2 &&
            new Set(views.map((view) => view.role)).size === 2
          ? views
          : [],
    findingId,
    findingStatus:
      findingId === null
        ? null
        : (FINDING_STATUSES.find((item) => item === value.finding_status) ??
          null),
    // Engine 2 only: an engine 1 result is shown exactly as before.
    assessment:
      engine === 2
        ? assessmentOf(value.assessment, { verdict, understood, expected })
        : null,
    checks:
      engine === 2
        ? (Array.isArray(value.checks) ? value.checks : [])
            .map(parseCodeCheck)
            .filter((item): item is CodeCheck => item !== null)
            .slice(0, REVIEW_BOUNDS.checks)
        : [],
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

const roles = (value: unknown): View["role"][] =>
  distinct(
    (Array.isArray(value) ? value : []).filter(
      (item): item is View["role"] =>
        item === "ASSESSOR" || item === "REVIEWER",
    ),
    (item) => item,
  );

const uuids = (value: unknown, limit: number): string[] =>
  distinct(
    (Array.isArray(value) ? value : [])
      .map(uuidOrNull)
      .filter((id): id is string => id !== null),
    (id) => id,
  ).slice(0, limit);

const codesOf = (value: unknown): string[] =>
  distinct(texts(value, 12, 8), (item) => item);

function parseReviewFile(value: unknown): ReviewFile | null {
  if (!isRecord(value)) {
    return null;
  }
  const fileId = uuidOrNull(value.file_id);
  if (fileId === null) {
    return null;
  }
  return {
    fileId,
    // Not said, or not known to this page: its relevance and its source read as not
    // known, never as relevant or as a system's own record. Its legibility and a
    // report's basis then say nothing of the file (the check's completeness, decided
    // on the server, is what says a file could not be read).
    relevance:
      RELEVANCES.find((item) => item === value.relevance) ?? "CANNOT_TELL",
    source: SOURCES.find((item) => item === value.source) ?? "UNKNOWN",
    legibility:
      LEGIBILITIES.find((item) => item === value.legibility) ?? "CLEAR",
    reportBasis:
      REPORT_BASES.find((item) => item === value.report_basis) ??
      "NOT_A_REPORT",
    notes: texts(value.notes, 4, 300),
  };
}

function parseFollowUp(value: unknown): FollowUp | null {
  if (!isRecord(value)) {
    return null;
  }
  const request = str(value.request).slice(0, 600);
  const missing = str(value.missing).slice(0, 400);
  // Nothing to ask for and nothing named as missing: not a follow-up.
  if (request === "" && missing === "") {
    return null;
  }
  return {
    key: str(value.key).slice(0, 160),
    attributeIds: uuids(value.attribute_ids, 12),
    codes: codesOf(value.codes),
    elements: texts(value.elements, 12, 80),
    missing,
    why: str(value.why).slice(0, 400),
    request,
    alternatives: str(value.alternatives).slice(0, 400),
    // A kind this page does not know is an ask for evidence, the stronger of the two.
    kind: value.kind === "CLARIFICATION" ? "CLARIFICATION" : "EVIDENCE",
    priority: PRIORITIES.find((item) => item === value.priority) ?? "MEDIUM",
    raisedBy: roles(value.raised_by),
    // Open unless the server says the new evidence resolved it.
    status: value.status === "RESOLVED" ? "RESOLVED" : "OPEN",
  };
}

/** One entry per key: a key listed twice keeps its first entry; entries without a key
 * are all kept. */
const byKey = <T extends { key: string }>(items: readonly T[]): T[] =>
  items.filter(
    (item, at) =>
      item.key === "" ||
      items.findIndex((each) => each.key === item.key) === at,
  );

/**
 * The review as section 10.7 sends it; null where what came is not an object. Every
 * part is read on its own: a part that is missing or not as documented falls back to
 * the cautious reading (an outcome this page does not know is "unable to conclude", a
 * completeness it does not know is not complete), and every list is bounded.
 */
function parseReview(value: unknown, only: string | null): Review | null {
  if (!isRecord(value)) {
    return null;
  }
  const list = (items: unknown): unknown[] =>
    Array.isArray(items) ? items : [];
  const completeness = isRecord(value.completeness) ? value.completeness : null;
  const followUps = byKey(
    list(value.follow_ups)
      .map(parseFollowUp)
      .filter((item): item is FollowUp => item !== null),
  );
  const listed = followUps.slice(0, REVIEW_BOUNDS.followUps);
  const open = (items: readonly FollowUp[]) =>
    items.filter((item) => item.status === "OPEN").length;
  return {
    overall:
      OUTCOMES.find((item) => item === value.overall) ?? "UNABLE_TO_CONCLUDE",
    explanation: str(value.explanation).slice(0, 600),
    completeness: {
      state:
        COMPLETENESS_STATES.find((item) => item === completeness?.state) ??
        "INCOMPLETE",
      reasons: texts(completeness?.reasons, 6, 300),
    },
    contextThin: value.context_thin === true,
    files: distinct(
      list(value.files)
        .map(parseReviewFile)
        .filter((item): item is ReviewFile => item !== null),
      (item) => item.fileId,
    ).slice(0, REVIEW_BOUNDS.files),
    confirmations: distinct(
      list(value.confirmations)
        .map(parseHeldFile)
        .filter((item): item is HeldFile => item !== null),
      (item) => item.fileId,
    ).slice(0, REVIEW_BOUNDS.files),
    concerns: list(value.concerns)
      .filter(isRecord)
      .map((item) => ({
        code: str(item.code).slice(0, 40),
        sentence: str(item.sentence).slice(0, 400),
        fileIds: uuids(item.file_ids, 12),
      }))
      .filter((item) => item.sentence !== "")
      .slice(0, 12),
    followUps: listed,
    // What this page's bound cut is counted with what the server did not list.
    followUpsMore:
      (count(value.follow_ups_more) ?? 0) + (open(followUps) - open(listed)),
    followUpsDropped: count(value.follow_ups_dropped) ?? 0,
    resolved: byKey(
      list(value.resolved)
        .filter(isRecord)
        .map((item) => ({
          key: str(item.key).slice(0, 160),
          request: str(item.request).slice(0, 600),
          codes: codesOf(item.codes),
        }))
        .filter((item) => item.request !== ""),
    ).slice(0, REVIEW_BOUNDS.followUps),
    considerations: list(value.considerations)
      .filter(isRecord)
      .map((item) => ({
        text: str(item.text).slice(0, 500),
        passages: list(item.passages)
          .map((each) => parsePassage(each, only))
          .filter((each): each is Passage => each !== null)
          .slice(0, 4),
        raisedBy: roles(item.raised_by),
      }))
      .filter((item) => item.text !== "")
      .slice(0, REVIEW_BOUNDS.considerations),
  };
}

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
  // Forward only (section 10.1): a run is the first engine's unless the server says 2.
  const engineVersion = value.engine_version === 2 ? 2 : 1;
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
              .map((item) => parseAttribute(item, only, engineVersion))
              .filter((item): item is AssuredAttribute => item !== null),
            (item) => item.attributeId || `code:${item.code}`,
          )
        : [],
    outOfDate,
    note: status === "FAILED" ? str(value.note).slice(0, 300) : "",
    ...(status === "FAILED" && failureNoteOf(value) !== ""
      ? { failureNote: failureNoteOf(value) }
      : {}),
    finishedAt: str(value.finished_at) || null,
    engineVersion,
    // Like the attributes: nothing of a run is shown before it finishes, or once it is
    // out of date. An engine 1 run has no review, whatever came with it.
    review:
      status === "REVIEWED" && engineVersion === 2
        ? parseReview(value.review, only)
        : null,
  };
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

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
  | "WAITING"
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
  // Not concluded only because a file of the request has not been read (14 November 2026):
  // the readings agree, so nothing is asked of the person's judgment; the file is.
  WAITING: { label: "Waiting on a file", icon: "clock", tone: "warning" },
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
    return item.pending === "FILE_NOT_READ" ? "WAITING" : "JUDGMENT";
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

/** A comparison made in code, as an opened attribute lists it: its sentence, and
 * whether it passed, in words with a mark. */
export type CheckLine = {
  key: string;
  sentence: string;
  /** "Passed", "Failed", "Failed on one reading's values", "Not run". */
  result: string;
  icon: IconName;
  tone: Tone;
};

/** Over an attribute's comparisons. */
export const CHECKED_IN_CODE = "Checked in code:";

/** A comparison's status in words with its mark. A comparison that passes supports
 * nothing by itself, and one that fails is a fact of the records, not a conclusion. */
export const CODE_CHECK_WORDS: Record<
  CodeCheckStatus,
  { label: string; icon: IconName; tone: Tone }
> = {
  PASSED: { label: "Passed", icon: "check", tone: "success" },
  FAILED: { label: "Failed", icon: "x", tone: "danger" },
  FAILED_ONE: {
    label: "Failed on one reading's values",
    icon: "help",
    tone: "warning",
  },
  NOT_RUN: { label: "Not run", icon: "minus", tone: "neutral" },
};

/** Said of a comparison the server sent without its sentence. */
const CHECK_UNSAID = "A comparison of the values the records state.";

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
  /** The comparisons made in code for the attribute (engine 2); empty otherwise. */
  checks: CheckLine[];
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

/** A passage as the row shows it: named by its file where the request has more than
 * one, and opening in it where the file is one of the row's. */
function shownPassage(
  passage: Passage,
  files: readonly RowFile[],
  many: boolean,
): ShownPassage {
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
    passages: item.passages.map((passage) =>
      shownPassage(passage, files, many),
    ),
    absent: item.absent,
    // The server's own sentence heads the row (it says whether the readings disagree,
    // neither could tell, or a reading did not finish), so it is not said again here: only
    // where there is none, or the result could not be read as sent.
    judgment:
      state !== "JUDGMENT"
        ? null
        : !item.understood
          ? RESULT_UNREAD
          : item.summary === ""
            ? READINGS_DISAGREE
            : null,
    readings: item.views.map((view) => ({
      who: ROLE_WORDS[view.role],
      result: resultWords(view.result),
      reason: view.reason,
    })),
    findingId: item.findingId,
    // A row that waits on a file says so on its line; it opens on request.
    open: state === "ISSUE" || state === "JUDGMENT",
    checks: item.checks.map((check, at) => ({
      key: `${check.element}:${check.test}:${at}`,
      sentence: sentence(check.sentence) || CHECK_UNSAID,
      result: CODE_CHECK_WORDS[check.status].label,
      icon: CODE_CHECK_WORDS[check.status].icon,
      tone: CODE_CHECK_WORDS[check.status].tone,
    })),
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
  /** The review of a finished engine 2 check, read first; null for engine 1 and for a
   * check that is not finished. */
  review: ReviewView | null;
  /** Files the check read as the type they appear to be (engine 2): each named, with
   * the row's own action that confirms the type. Empty otherwise. */
  confirm: LeftOutLine[];
};

/** A sentence as the server sent it, closed with a full stop. */
function sentence(text: string): string {
  return text === "" || /[.!?…]$/.test(text) ? text : `${text}.`;
}

/** The check's one sentence for a run that ended without a usable answer (it failed), or
 * null: nothing of the run is shown, and the server's reason (its failure sentence, else
 * the run's note). The next action is the check's own "Check again", beside it
 * (requestCheck's action). */
export function runFailureLine(
  request: Pick<AssuredRequest, "status" | "note" | "failureNote">,
  failureNote: string = request.failureNote ?? "",
): string | null {
  if (request.status !== "FAILED") {
    return null;
  }
  return [
    "The check did not finish, so nothing of it is shown.",
    plainNote(failureNote) || plainNote(request.note),
  ]
    .filter((part) => part !== "")
    .join(" ");
}

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
    review: null,
    confirm: [],
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
      line: runFailureLine(request) ?? "",
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
    WAITING: 2,
    SUPPORTED: 3,
    PARTLY: 4,
    DECIDED: 5,
    NOT_ADDRESSED: 6,
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
    review: reviewView(request, attributes, files, span),
    // A file read with its type not confirmed: the row's own "Confirm the file's
    // type", once per file (a file left out for the same reason already carries it).
    confirm: (request.review?.confirmations ?? [])
      .filter(
        (item) =>
          files.some((file) => file.id === item.fileId) &&
          !request.heldFiles.some((held) => held.fileId === item.fileId) &&
          (item.code === "KIND_UNSURE" || item.reason !== ""),
      )
      .map((item) => ({
        fileId: item.fileId,
        line: `${nameOf(item.fileId)}: ${sentence(item.reason) || TYPE_NOT_CONFIRMED}`,
        action:
          item.code === "KIND_UNSURE"
            ? fileAction(item.code, item.fileId)
            : null,
      })),
  };
}

// The review of a request's evidence, as its row shows it (section 10)

/** Over the review: it is the check's proposal. A person decides. */
export const REVIEW_TITLE = "Proposed assessment";
export const REVIEW_FOR = "for your review";
export const FOLLOW_UP_TITLE = "Recommended follow-up";
export const RESOLVED_TITLE = "Resolved by the new evidence";
export const CONSIDERATIONS_TITLE = "Additional considerations";
export const FILES_TITLE = "About the files";

/** The outcome in words with its mark: the colour repeats them and never replaces
 * them. Each is a proposal: none says the control works, or that it does not. */
export const OUTCOME_WORDS: Record<
  Outcome,
  { label: string; icon: IconName; tone: Tone }
> = {
  SUFFICIENT: {
    label: "Sufficient evidence",
    icon: "checkCircle",
    tone: "success",
  },
  ADDITIONAL_EVIDENCE: {
    label: "Additional evidence needed",
    icon: "plus",
    tone: "warning",
  },
  CLARIFICATION: {
    label: "Clarification needed",
    icon: "message",
    tone: "warning",
  },
  POTENTIAL_EXCEPTION: {
    label: "Potential exception to investigate",
    icon: "risk",
    tone: "danger",
  },
  UNABLE_TO_CONCLUDE: {
    label: "Unable to conclude yet",
    icon: "help",
    tone: "neutral",
  },
};

/** Why, where the server sent no explanation of its own. */
const OUTCOME_REASONS: Record<Outcome, string> = {
  SUFFICIENT: "The evidence supports every attribute this request asks for.",
  ADDITIONAL_EVIDENCE:
    "The evidence does not yet support every attribute this request asks for.",
  CLARIFICATION:
    "A clarification is needed before every attribute this request asks for is supported.",
  POTENTIAL_EXCEPTION:
    "The records may show an exception. It is yours to investigate.",
  UNABLE_TO_CONCLUDE: "The evidence does not yet allow a view either way.",
};

/** Under an outcome this page could not take as it stands: "sufficient" beside an
 * attribute that is not satisfied, an open follow-up, or support that still needs
 * corroboration. It is then not shown as sufficient. */
export const REVIEW_UNREAD =
  "This assessment could not be read as it was sent, so the evidence is not shown as sufficient. Your judgment is needed.";

/** How complete the evidence is, where it is not complete. Passing custody is never
 * called reliability. */
export const COMPLETENESS_WORDS: Record<
  Exclude<CompletenessState, "COMPLETE">,
  string
> = {
  INCOMPLETE: "Evidence incomplete",
  PARTLY_UNREADABLE: "Partly unreadable",
  RELIABILITY_UNRESOLVED: "Reliability to resolve",
};

/** Why, where the server sent no sentence of its own. */
const COMPLETENESS_REASONS: Record<
  Exclude<CompletenessState, "COMPLETE">,
  string
> = {
  INCOMPLETE: "The check does not say that every file was read in full.",
  PARTLY_UNREADABLE: "Part of the evidence could not be read.",
  RELIABILITY_UNRESOLVED:
    "The support rests on a file whose source or basis is not shown.",
};

export type ReviewGroupKey = "SATISFIED" | "OPEN" | "EXCEPTION";

/** The three groups the attributes a request asks for fall into. */
export const REVIEW_GROUP_WORDS: Record<
  ReviewGroupKey,
  { label: string; icon: IconName; tone: Tone }
> = {
  SATISFIED: { label: "Satisfied", icon: "check", tone: "success" },
  OPEN: { label: "Open", icon: "minusCircle", tone: "warning" },
  EXCEPTION: { label: "Potential exception", icon: "risk", tone: "danger" },
};

const GROUP_OF: Record<Assessment, ReviewGroupKey> = {
  SATISFIED: "SATISFIED",
  PARTIALLY_SUPPORTED: "OPEN",
  NOT_DEMONSTRATED: "OPEN",
  INDETERMINATE: "OPEN",
  CONTRADICTED: "EXCEPTION",
};

const FOLLOW_UP_KINDS: Record<FollowUp["kind"], string> = {
  EVIDENCE: "Evidence",
  CLARIFICATION: "Clarification",
};

const PRIORITY_WORDS: Record<FollowUpPriority, string> = {
  HIGH: "High priority",
  MEDIUM: "Medium priority",
  LOW: "Low priority",
};

/** Said once where no fact of the control's understanding is confirmed. */
export const CONTEXT_THIN =
  "No fact of this control's understanding is confirmed yet, so the evidence was checked against the attributes' wording alone.";

/** Said of a file the check read with its type not confirmed. */
const TYPE_NOT_CONFIRMED =
  "Its type is not confirmed, so it was read as the type it appears to be.";
export const TYPE_TO_CONFIRM = "Its type is still to be confirmed.";

const RELEVANCE_NOTES: Partial<Record<FileRelevance, string>> = {
  NOT_RELEVANT: "It does not appear relevant to this request.",
  CANNOT_TELL: "Whether it is relevant to this request could not be told.",
};
const LEGIBILITY_NOTES: Partial<Record<FileLegibility, string>> = {
  PARTLY_UNREADABLE: "Part of it could not be read.",
  UNREADABLE: "It could not be read.",
};
const SOURCE_NOTES: Partial<Record<FileSource, string>> = {
  MANAGEMENT_PREPARED:
    "It was prepared by a person, not taken from a system's own record.",
  UNKNOWN: "Its source is not known.",
};
const BASIS_NOTES: Partial<Record<ReportBasis, string>> = {
  NOT_SHOWN:
    "It is a report that does not show its source, run date or parameters.",
  PARTLY_SHOWN:
    "It is a report that shows only part of its source, run date and parameters.",
};

/** One thing to ask for, as the review lists it. Whether one reading or both raised it
 * is not shown: it is one ask. */
export type FollowUpLine = {
  key: string;
  /** The main line, and what Copy copies. */
  request: string;
  /** "Evidence" or "Clarification". */
  kind: string;
  /** "High priority", "Medium priority", "Low priority". */
  priority: string;
  /** The attributes it serves, by the list's letters. */
  letters: string[];
  /** "For attribute C"; "" where it names none. */
  serves: string;
  /** On request: what is missing, why it matters, and what else would do. */
  missing: string;
  why: string;
  alternatives: string;
};

/** The review of a finished engine 2 check, in the row's words. */
export type ReviewView = {
  /** The outcome as this page reads it. */
  state: Outcome;
  label: string;
  icon: IconName;
  tone: Tone;
  /** Why the evidence is or is not sufficient, in at most three sentences. */
  explanation: string;
  /** The attributes the request asks for, each letter under one group. */
  groups: Array<{
    key: ReviewGroupKey;
    label: string;
    icon: IconName;
    tone: Tone;
    letters: string[];
  }>;
  /** "Satisfied A, B · Open C · Potential exception D"; "" where the request asks for
   * none. */
  countsLine: string;
  /** Null where the evidence is complete. */
  completeness: { label: string; reasons: string[] } | null;
  /** Empty where the evidence is sufficient. */
  followUps: FollowUpLine[];
  /** "2 more follow-ups are not listed here."; "" where every one is listed. */
  more: string;
  /** Follow-ups of the earlier check that the new evidence resolved. */
  resolved: Array<{ key: string; request: string; letters: string[] }>;
  considerations: Array<{
    key: string;
    text: string;
    passages: ShownPassage[];
  }>;
  /** What the check found on the facts the files state, each in one sentence, with
   * the files it names. */
  concerns: Array<{ key: string; text: string; files: string }>;
  /** Only the files with something to say. */
  files: Array<{ fileId: string; name: string; notes: string[] }>;
  /** One quiet sentence where the control's understanding is thin; null otherwise. */
  contextThin: string | null;
};

/**
 * The review of a request's evidence as its row shows it; null where the check has
 * none (engine 1, or not finished). It words what the server decided and decides
 * nothing: the one thing it will not do is repeat "sufficient" where what came with it
 * says otherwise.
 */
export function reviewView(
  request: AssuredRequest,
  attributes: readonly Lettered[],
  files: readonly RowFile[],
  span: Span,
): ReviewView | null {
  const review = request.review;
  if (review === null || request.status !== "REVIEWED") {
    return null;
  }
  const order = attributes.map((item) => item.letter);
  const at = (letter: string) =>
    order.indexOf(letter) < 0 ? order.length : order.indexOf(letter);
  // In the attributes' order, as the row's letters are; a letter once.
  const inOrder = (letters: readonly string[]) =>
    distinct(
      letters.filter((letter) => letter !== ""),
      (letter) => letter,
    ).sort((a, b) => at(a) - at(b) || a.localeCompare(b));
  // An attribute's letter is the list's, by its id; its code where the list has none.
  const letterOfId = (id: string): string =>
    attributes.find((each) => each.id === id)?.letter ??
    request.attributes.find((each) => each.attributeId === id)?.code ??
    "";
  const letterOfCode = (code: string): string => {
    const item = request.attributes.find((each) => each.code === code);
    return (
      attributes.find(
        (each) => item !== undefined && each.id === item.attributeId,
      )?.letter ?? code
    );
  };
  const lettersOf = (item: { attributeIds?: string[]; codes: string[] }) => {
    const byId = inOrder((item.attributeIds ?? []).map(letterOfId));
    return byId.length > 0 ? byId : inOrder(item.codes.map(letterOfCode));
  };
  const nameOf = (fileId: string) =>
    files.find((each) => each.id === fileId)?.name ??
    "A file no longer on this request";
  const many =
    new Set([...files.map((file) => file.id), ...request.fileIds]).size > 1;

  const asked = request.attributes.filter((item) => item.assessment !== null);
  const groupKeys: ReviewGroupKey[] = ["SATISFIED", "OPEN", "EXCEPTION"];
  const groups = groupKeys
    .map((key) => ({
      key,
      ...REVIEW_GROUP_WORDS[key],
      letters: inOrder(
        asked
          .filter(
            (item) =>
              item.assessment !== null && GROUP_OF[item.assessment] === key,
          )
          .map((item) => letterOfId(item.attributeId) || item.code),
      ),
    }))
    .filter((group) => group.letters.length > 0);

  const open = review.followUps.filter((item) => item.status === "OPEN");
  // "Sufficient" stands only as section 10.6 defines it: every attribute the request
  // asks for satisfied, nothing left to ask, and no support still to corroborate.
  const stands =
    review.overall !== "SUFFICIENT" ||
    (asked.length > 0 &&
      asked.every((item) => item.assessment === "SATISFIED") &&
      open.length === 0 &&
      review.followUpsMore === 0 &&
      review.completeness.state !== "RELIABILITY_UNRESOLVED");
  const state: Outcome = stands ? review.overall : "UNABLE_TO_CONCLUDE";

  const completeness =
    review.completeness.state === "COMPLETE"
      ? null
      : {
          label: COMPLETENESS_WORDS[review.completeness.state],
          reasons:
            review.completeness.reasons.length > 0
              ? review.completeness.reasons.map(sentence)
              : [COMPLETENESS_REASONS[review.completeness.state]],
        };

  const confirming = new Set(
    review.confirmations
      .filter((item) => item.code === "KIND_UNSURE")
      .map((item) => item.fileId),
  );
  const notesOf = (file: ReviewFile | null, fileId: string): string[] => {
    const flags = [
      file === null ? undefined : RELEVANCE_NOTES[file.relevance],
      file === null ? undefined : LEGIBILITY_NOTES[file.legibility],
      file === null ? undefined : SOURCE_NOTES[file.source],
      file === null ? undefined : BASIS_NOTES[file.reportBasis],
      confirming.has(fileId) ? TYPE_TO_CONFIRM : undefined,
    ].filter((note): note is string => note !== undefined);
    // A file with nothing to say is not listed, whatever notes came with it.
    return flags.length === 0
      ? []
      : distinct([...flags, ...(file?.notes ?? []).map(sentence)], (note) =>
          note.toLowerCase(),
        );
  };

  return {
    state,
    ...OUTCOME_WORDS[state],
    explanation: !stands
      ? REVIEW_UNREAD
      : review.explanation !== ""
        ? review.explanation
        : OUTCOME_REASONS[state],
    groups,
    countsLine: groups
      .map((group) => `${group.label} ${group.letters.join(", ")}`)
      .join(" · "),
    completeness,
    followUps: open.map((item, index) => {
      const letters = lettersOf(item);
      return {
        key: item.key !== "" ? item.key : `ask-${index}`,
        // The ask is the main line; where the server named only what is missing, that.
        request: item.request !== "" ? item.request : item.missing,
        kind: FOLLOW_UP_KINDS[item.kind],
        priority: PRIORITY_WORDS[item.priority],
        letters,
        serves:
          letters.length === 0
            ? ""
            : `For attribute${letters.length === 1 ? "" : "s"} ${span(letters)}`,
        missing: item.request !== "" ? item.missing : "",
        why: item.why,
        alternatives: item.alternatives,
      };
    }),
    more:
      review.followUpsMore > 0
        ? `${review.followUpsMore} more follow-up${review.followUpsMore === 1 ? " is" : "s are"} not listed here.`
        : "",
    resolved: [
      ...review.resolved.map((item) => ({ ...item, attributeIds: [] })),
      ...review.followUps
        .filter((item) => item.status === "RESOLVED" && item.request !== "")
        .map((item) => ({
          key: item.key,
          request: item.request,
          codes: item.codes,
          attributeIds: item.attributeIds,
        })),
    ].map((item, index) => ({
      key: item.key !== "" ? `done-${item.key}` : `done-${index}`,
      request: item.request,
      letters: lettersOf(item),
    })),
    considerations: review.considerations.map((item, index) => ({
      key: `note-${index}`,
      text: sentence(item.text),
      passages: item.passages.map((passage) =>
        shownPassage(passage, files, many),
      ),
    })),
    concerns: review.concerns.map((item, index) => ({
      key: `concern-${index}`,
      text: sentence(item.sentence),
      files: item.fileIds
        .filter((id) => files.some((file) => file.id === id))
        .map(nameOf)
        .join(", "),
    })),
    files: [
      ...review.files.map((file) => ({
        fileId: file.fileId,
        notes: notesOf(file, file.fileId),
      })),
      ...[...confirming]
        .filter((id) => !review.files.some((file) => file.fileId === id))
        .map((id) => ({ fileId: id, notes: notesOf(null, id) })),
    ]
      .filter((file) => file.notes.length > 0)
      .map((file) => ({ ...file, name: nameOf(file.fileId) })),
    contextThin: review.contextThin ? CONTEXT_THIN : null,
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
  | "WAITING"
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
  WAITING: { words: "waiting on a file", state: "WAITING" },
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
    engineVersion: 1,
    review: null,
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
    "WAITING",
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
      waiting: lettersOf("WAITING"),
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
  /** Not concluded only because a file of the request has not been read. */
  waiting?: readonly string[];
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
  const waiting = facts.waiting ?? [];
  const open = facts.issues.length + facts.judged.length + waiting.length > 0;
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
      ? `Your judgment is needed on ${span(facts.judged)}.`
      : "",
    waiting.length > 0
      ? `${span(waiting)} ${many(waiting) ? "are" : "is"} not concluded: a file of this request has not been read yet.`
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
