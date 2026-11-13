/**
 * The evidence assurance chain on the D&I Evidence list (docs/evidence-assurance.md,
 * sections 6 and 7). The in-force files of each D&I request are read together, as one
 * walkthrough, against the control's approved attributes by two independent readings,
 * and code on the server decides what stands: one run per request. This module reads
 * what the server sent and words it for the request's row: a check at work, a check on
 * hold with the one action that clears it, a check to run again, a file left out of the
 * readings with why, and a finished check with each attribute's state.
 *
 * Pure. Nothing here decides a verdict: the server does. A value this module does not
 * know falls back to the cautious reading, never to "supported": an unknown status reads
 * as still being checked (nothing of it is shown), an unknown verdict as needing the
 * person's judgment, and support that came without what support needs (the agreed
 * result, a passage) is not shown as support. Nothing reads as an issue unless the
 * server's verdict says both readings agree on it, and no file of the request is left
 * out of what the row says without saying so.
 */

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
] as const;
export type Result = (typeof RESULTS)[number];

const HELD_CODES = [
  "CUSTODY",
  "UNREADABLE",
  "KIND_UNSURE",
  "POPULATION",
  "NO_ATTRIBUTES",
  "TOO_LARGE",
] as const;
/** Why the gate stopped a check, or left a file out. OTHER is a code this page does
 * not know. */
export type HeldCode = (typeof HELD_CODES)[number] | "OTHER";

export type Lens = "DESIGN_DOCUMENT" | "INSTANCE_RECORD";

/** A file's own words a result rests on, and where they sit. */
export type Passage = {
  quote: string;
  /** The file the words are in; null where the server named none this page can read
   * and the request read more than one file. */
  fileId: string | null;
  /** "Page 3", "Sheet Users, row 4"; "" where the server located nothing. */
  location: string;
  page: number | null;
};

/** One reading's answer for an attribute the two readings do not agree on. */
export type View = {
  role: "ASSESSOR" | "REVIEWER";
  result: Result | null;
  reason: string;
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
  summary: string;
  passages: Passage[];
  absent: string[];
  views: View[];
  findingId: string | null;
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
  finishedAt: string | null;
};

/** The server's counts. Each is null where it sent none this page can read. */
export type AssuranceSummary = {
  /** Requests. */
  checking: number | null;
  held: number | null;
  failed: number | null;
  outOfDate: number | null;
  /** Attribute verdicts. */
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

function parseLocation(value: unknown): {
  location: string;
  page: number | null;
} {
  if (typeof value === "string") {
    return { location: value.trim(), page: null };
  }
  if (!isRecord(value)) {
    return { location: "", page: null };
  }
  const page =
    typeof value.page === "number" &&
    Number.isInteger(value.page) &&
    value.page > 0
      ? value.page
      : null;
  const said = str(value.location);
  if (said !== "") {
    return { location: said, page };
  }
  const sheet = str(value.sheet);
  const cell = str(value.cell);
  const row =
    typeof value.row === "number" &&
    Number.isInteger(value.row) &&
    value.row > 0
      ? value.row
      : null;
  return {
    location: [
      page !== null ? `Page ${page}` : "",
      sheet !== "" ? `Sheet ${sheet}` : "",
      cell !== "" ? `cell ${cell}` : row !== null ? `row ${row}` : "",
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
  // What stands as sent. Support needs the agreed result and a passage it rests on
  // (rules 2 and the comparison of section 3); an issue or "not addressed" that carries
  // the result "met" contradicts itself. Anything else is left for the person.
  const stands =
    said === "SUPPORTED"
      ? result === "MET" && passages.length > 0
      : said === "ISSUE"
        ? result === null || ISSUE_RESULTS.includes(result)
        : said === "NOT_ADDRESSED"
          ? result === null || result === "NOT_ADDRESSED"
          : said === "UNSETTLED";
  const verdict: Verdict = said !== null && stands ? said : "UNSETTLED";
  return {
    attributeId,
    code,
    expected: value.expected === true,
    verdict,
    understood: said !== null && stands,
    result: verdict === "UNSETTLED" ? null : result,
    summary: str(value.summary),
    passages,
    absent: strings(value.absent, 12),
    views:
      verdict === "UNSETTLED"
        ? (Array.isArray(value.views) ? value.views : [])
            .map(parseView)
            .filter((item): item is View => item !== null)
            .slice(0, 2)
        : [],
    findingId: verdict === "ISSUE" ? uuidOrNull(value.finding_id) : null,
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

// The step's line

export type AssuranceCounts = {
  /** Requests the chain has an entry for. */
  requests: number;
  /** Requests whose check is queued or at work. */
  checking: number;
  /** Requests whose check is on hold. */
  held: number;
  /** Requests whose check failed or is out of date: to run again. */
  again: number;
  /** Results both readings agree are an issue. */
  issues: number;
  /** Results that need the person's judgment. */
  unsettled: number;
};

/**
 * What the step's line counts, from the server's `summary`, never below what the
 * requests on the page themselves show (a result this page read cautiously as needing
 * judgment is counted, though the server's summary could not know it). Support is not
 * counted here: the step's line never states it.
 */
export function assuranceCounts(
  assurance: EvidenceAssurance | null,
): AssuranceCounts {
  const requests = assurance?.requests ?? [];
  const verdicts = requests.flatMap((item) =>
    item.attributes.map((each) => each.verdict),
  );
  const summary = assurance?.summary ?? null;
  const has = (...statuses: CheckStatus[]) =>
    requests.filter((item) => statuses.includes(item.status)).length;
  const said = (value: number | null | undefined) => value ?? 0;
  return {
    requests: requests.length,
    checking: Math.max(said(summary?.checking), has("QUEUED", "CHECKING")),
    held: Math.max(said(summary?.held), has("HELD")),
    again: Math.max(
      said(summary?.failed) + said(summary?.outOfDate),
      has("FAILED", "OUT_OF_DATE"),
    ),
    issues: Math.max(
      said(summary?.issues),
      verdicts.filter((verdict) => verdict === "ISSUE").length,
    ),
    unsettled: Math.max(
      said(summary?.unsettled),
      verdicts.filter((verdict) => verdict === "UNSETTLED").length,
    ),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What follows "N files to review" on the step's pill: what needs the person first,
 * then what is on hold, then what is to run again, then what is still being checked.
 * "" when nothing does. */
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
    counts.issues > 0 ? plural(counts.issues, "issue") : "",
    counts.unsettled > 0
      ? `${plural(counts.unsettled, "result")} for your judgment`
      : "",
  ].filter((part) => part !== "");
  const waiting = [
    counts.held > 0
      ? `${plural(counts.held, "request")} on hold until you act on ${counts.held === 1 ? "its" : "their"} row`
      : "",
    counts.again > 0 ? `${plural(counts.again, "check")} to run again` : "",
    counts.checking > 0
      ? `${plural(counts.checking, "request")} still being checked`
      : "",
  ].filter((part) => part !== "");
  const reviewed =
    counts.requests - counts.checking - counts.held - counts.again > 0;
  const lead =
    found.length > 0
      ? `Two independent readings checked the evidence against the attributes: ${found.join(", ")}. See each row.`
      : reviewed
        ? "Two independent readings checked the evidence against the attributes: no issue, and nothing left for your judgment. What each row supports is on the row."
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
  | "ISSUE"
  | "JUDGMENT"
  | "NOT_ADDRESSED";

export type Tone = "success" | "danger" | "warning" | "neutral";

/** Each state in words with its mark: the colour repeats them and never replaces them. */
export const STATE_WORDS: Record<
  AttributeState,
  { label: string; icon: IconName; tone: Tone }
> = {
  SUPPORTED: { label: "Supported", icon: "check", tone: "success" },
  ISSUE: { label: "Issue", icon: "risk", tone: "danger" },
  JUDGMENT: { label: "Your judgment needed", icon: "help", tone: "warning" },
  NOT_ADDRESSED: { label: "Not addressed", icon: "minus", tone: "neutral" },
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

const stateOf = (verdict: Verdict): AttributeState =>
  verdict === "UNSETTLED" ? "JUDGMENT" : verdict;

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
  /** "Supported", "Issue: not shown", "Your judgment needed", "Not addressed". */
  label: string;
  icon: IconName;
  tone: Tone;
  summary: string;
  passages: ShownPassage[];
  absent: string[];
  /** The sentence over the two readings; null unless the person's judgment is needed. */
  judgment: string | null;
  /** Both readings, side by side, for an attribute they do not agree on. */
  readings: Array<{ who: string; result: string; reason: string }>;
  /** The evidence finding that records the issue; null where there is none. */
  findingId: string | null;
  /** It opens by itself: an issue, or a judgment the person owes. */
  open: boolean;
};

export type Lettered = { id: string; letter: string; text: string };

function attributeLine(
  item: AssuredAttribute,
  attributes: readonly Lettered[],
  files: readonly RowFile[],
  many: boolean,
): AttributeLine {
  const known = attributes.find((each) => each.id === item.attributeId);
  const state = stateOf(item.verdict);
  const words = STATE_WORDS[state];
  return {
    key: item.attributeId !== "" ? item.attributeId : item.code,
    attributeId: item.attributeId,
    letter: known?.letter ?? item.code,
    text: known?.text ?? "",
    expected: item.expected,
    state,
    label:
      state === "ISSUE" && item.result !== null
        ? `${words.label}: ${RESULT_WORDS[item.result].toLowerCase()}`
        : words.label,
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
  | "CHECKING"
  | "HELD"
  | "FAILED"
  | "OUT_OF_DATE"
  | "REVIEWED";

export type CheckActionKind =
  | "CONFIRM_TYPE"
  | "REPLACE"
  | "PICK_INSTANCE"
  | "RERUN";

/** The one action that clears a hold, or runs the check again. A file's action names
 * its file; running again is the request's. */
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
  /** The single action that clears a hold, or runs the check again; null when a person
   * can do nothing about it here. Offered only to a person who may act (offeredAction). */
  action: CheckAction | null;
  /** "The evidence was read in part.", where it was; null otherwise. */
  readInPart: string | null;
  /** Files of the request the readings did not include, each with why. */
  leftOut: LeftOutLine[];
  /** Issues and judgments first, then what is supported, in the attributes' order. */
  attributes: AttributeLine[];
  /** Attributes the evidence does not bear on, folded to one quiet line. */
  notAddressed: AttributeLine[];
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
  const base = {
    stage: "",
    action: null,
    readInPart: null,
    leftOut,
    attributes: [],
    notAddressed: [],
  };
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
      line: "The check did not finish, so nothing of it is shown.",
      action: { kind: "RERUN", label: "Check again", fileId: null },
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
      action: { kind: "RERUN", label: "Check again", fileId: null },
    };
  }
  const rank: Record<AttributeState, number> = {
    ISSUE: 0,
    JUDGMENT: 1,
    SUPPORTED: 2,
    NOT_ADDRESSED: 3,
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
    notAddressed: lines.filter((line) => line.state === "NOT_ADDRESSED"),
  };
}

/** The action as the person is offered it: only to a person who may act, and a
 * replacement only where its file can be replaced now. */
export function offeredAction(
  action: CheckAction | null,
  facts: { canAct: boolean; replaceable: (fileId: string) => boolean },
): CheckAction | null {
  if (action === null || !facts.canAct) {
    return null;
  }
  return action.kind === "REPLACE" &&
    (action.fileId === null || !facts.replaceable(action.fileId))
    ? null
    : action;
}

// One request row

export type StateGroup = {
  state: AttributeState;
  letters: string[];
  /** "A and C supported", "B issue", "D your judgment needed". */
  label: string;
  icon: IconName;
  tone: Tone;
};

export type AssuranceRow = {
  standing: CheckStanding;
  /** The row's quiet line: "Checking against attributes A to C…", "Check on hold". */
  fact: string;
  check: RequestCheck;
  /** Beside the row's letters once the check is finished: each letter under its one
   * state. */
  states: StateGroup[];
  /** The same for a screen reader and the step's notes: "A and C supported, B issue". */
  spoken: string;
  /** The attributes accepting the row's evidence marks as evidenced. */
  supportedIds: string[];
  /** Beside Accept: what accepting marks as evidenced, and what it does not settle. */
  acceptNote: string;
  /** The check is queued or at work: the list is read again until it ends. */
  working: boolean;
};

const STANDING_FACTS: Record<Exclude<CheckStanding, "CHECKING">, string> = {
  HELD: "Check on hold",
  FAILED: "Check did not finish",
  OUT_OF_DATE: "Check out of date",
  REVIEWED: "Checked by two readings",
};

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
  const lettersIn = (state: AttributeState) =>
    check.attributes
      .filter((line) => line.state === state)
      .map((line) => line.letter);
  const states: StateGroup[] = (["SUPPORTED", "ISSUE", "JUDGMENT"] as const)
    .map((state) => ({ state, letters: lettersIn(state) }))
    .filter((group) => group.letters.length > 0)
    .map(({ state, letters }) => ({
      state,
      letters,
      label: `${input.span(letters)} ${STATE_WORDS[state].label.toLowerCase()}`,
      icon: STATE_WORDS[state].icon,
      tone: STATE_WORDS[state].tone,
    }));
  const left = check.leftOut.length;
  // In the attributes' order, as the row's letters are.
  const ordered = (state: AttributeState) =>
    input.attributes
      .map((item) => item.letter)
      .filter((letter) => lettersIn(state).includes(letter))
      .concat(
        lettersIn(state).filter(
          (letter) => !input.attributes.some((item) => item.letter === letter),
        ),
      );
  return {
    standing: check.standing,
    fact:
      check.standing === "CHECKING"
        ? `Checking ${against(
            input.attributes.map((item) => item.letter),
            input.span,
          )}…`
        : check.standing === "REVIEWED" && left > 0
          ? `${STANDING_FACTS.REVIEWED}, ${plural(left, "file")} left out`
          : STANDING_FACTS[check.standing],
    check,
    states,
    spoken: states.map((group) => group.label).join(", "),
    supportedIds: check.attributes
      .filter((line) => line.state === "SUPPORTED" && line.attributeId !== "")
      .map((line) => line.attributeId),
    acceptNote: acceptNote({
      standing: check.standing,
      supported: ordered("SUPPORTED"),
      issues: ordered("ISSUE"),
      judged: ordered("JUDGMENT"),
      leftOut: left,
      span: input.span,
    }),
    working: check.standing === "CHECKING",
  };
}

/**
 * Beside Accept: what accepting the row's evidence marks as evidenced (the attributes
 * both readings support, and no other), and what it leaves open. It informs and never
 * blocks: Accept stays the person's.
 */
export function acceptNote(facts: {
  standing: CheckStanding;
  supported: readonly string[];
  issues: readonly string[];
  judged: readonly string[];
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
  return [
    facts.supported.length > 0
      ? `Accepting marks attribute${facts.supported.length === 1 ? "" : "s"} ${span(facts.supported)} as evidenced.`
      : "Accepting marks no attribute as evidenced: the two readings support none.",
    facts.issues.length > 0
      ? `Both readings found an issue on ${span(facts.issues)}.`
      : "",
    facts.judged.length > 0
      ? `The readings do not agree on ${span(facts.judged)}: your judgment is needed.`
      : "",
    open ? "You can still accept; accepting does not settle these." : "",
    facts.leftOut > 0
      ? `${plural(facts.leftOut, "file")} ${facts.leftOut === 1 ? "was" : "were"} not part of the check.`
      : "",
  ]
    .filter((part) => part !== "")
    .join(" ");
}

// Running a check again

type Fields = Record<string, unknown>;
type AssuranceWrite = { path: string } | { error: "invalid" };

/** The API call behind "Check again" (the /workspace/evidence-assurance route): POST
 * .../evidence-assurance/{requirement_id}/rerun, with no body. */
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

/** What a person reads when "Check again" did not go through; null when the server
 * confirmed it. */
export function assuranceProblem(status: number, detail = ""): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 409) {
    // The server says why in one plain sentence: shown as it is.
    return detail.trim() !== ""
      ? sentence(detail.trim())
      : "The check cannot be run again now. The row is refreshed.";
  }
  if (status === 403) {
    return "Your role cannot run the check again.";
  }
  if (status === 404) {
    return "This request is no longer here to check. Refresh the page.";
  }
  if (status === 422) {
    return "The check could not be started for this request. Refresh the page and try again.";
  }
  return "The check could not be started. Try again in a moment.";
}
