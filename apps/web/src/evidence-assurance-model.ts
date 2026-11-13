/**
 * The evidence assurance chain on the D&I Evidence list (docs/evidence-assurance.md,
 * sections 6 and 7). Each file filed on a D&I request is checked against the control's
 * approved attributes by two independent readings, and code on the server decides what
 * stands. This module reads what the server sent and words it for the row: a check at
 * work, a check on hold with the one action that clears it, a check to run again, and a
 * finished check with each attribute's state.
 *
 * Pure. Nothing here decides a verdict: the server does. A value this module does not
 * know falls back to the cautious reading, never to "supported": an unknown status reads
 * as still being checked (nothing of it is shown), an unknown verdict as needing the
 * person's judgment, and support that came without what support needs (the agreed
 * result, a passage) is not shown as support. Nothing reads as an issue unless the
 * server's verdict says both readings agree on it.
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

export const FILE_STATUSES = [
  "QUEUED",
  "CHECKING",
  "HELD",
  "REVIEWED",
  "FAILED",
  "OUT_OF_DATE",
] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

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
] as const;
/** Why the gate stopped a check. OTHER is a code this page does not know. */
export type HeldCode = (typeof HELD_CODES)[number] | "OTHER";

export type Lens = "DESIGN_DOCUMENT" | "INSTANCE_RECORD";

/** The file's own words a result rests on, and where they sit. */
export type Passage = {
  quote: string;
  fileId: string;
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

export type AssuredFile = {
  fileId: string;
  requirementId: string | null;
  runId: string | null;
  status: FileStatus;
  stage: Stage | null;
  /** Null unless the check is held. */
  held: { code: HeldCode; reason: string } | null;
  lens: Lens | null;
  readInPart: boolean;
  /** Empty unless the check is finished and current. */
  attributes: AssuredAttribute[];
  /** Why the check is out of date, in the server's sentences. */
  outOfDate: string[];
  finishedAt: string | null;
};

export type AssuranceSummary = {
  checking: number;
  held: number;
  supported: number;
  issues: number;
  unsettled: number;
};

export type EvidenceAssurance = {
  files: AssuredFile[];
  /** The server's own counts; null when it sent none this page can read. */
  summary: AssuranceSummary | null;
};

const strings = (value: unknown, limit: number): string[] =>
  (Array.isArray(value) ? value : [])
    .map(str)
    .filter((item) => item !== "")
    .slice(0, limit);

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

function parsePassage(value: unknown, fileId: string): Passage | null {
  if (!isRecord(value) || str(value.quote) === "") {
    return null;
  }
  return {
    quote: str(value.quote).slice(0, 600),
    // One check reads one file: a passage that names none sits in that file.
    fileId: uuidOrNull(value.file_id) ?? fileId,
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
  fileId: string,
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
    .map((item) => parsePassage(item, fileId))
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

function parseFile(value: unknown): AssuredFile | null {
  if (!isRecord(value)) {
    return null;
  }
  const fileId = uuidOrNull(value.file_id);
  if (fileId === null) {
    return null;
  }
  const outOfDate = strings(value.out_of_date, 6);
  const said = FILE_STATUSES.find((item) => item === value.status) ?? null;
  // A status this page does not know reads as still being checked: nothing of the run
  // is shown. A finished run the server also marks out of date is out of date.
  const status: FileStatus =
    said === null
      ? "CHECKING"
      : said === "REVIEWED" && outOfDate.length > 0
        ? "OUT_OF_DATE"
        : said;
  const held = isRecord(value.held) ? value.held : null;
  return {
    fileId,
    requirementId: uuidOrNull(value.requirement_id),
    runId: uuidOrNull(value.run_id),
    status,
    stage: STAGES.find((item) => item === value.stage) ?? null,
    held:
      status !== "HELD"
        ? null
        : {
            code: HELD_CODES.find((item) => item === held?.code) ?? "OTHER",
            reason: str(held?.reason),
          },
    lens:
      value.lens === "DESIGN_DOCUMENT" || value.lens === "INSTANCE_RECORD"
        ? value.lens
        : null,
    readInPart: value.read_in_part === true,
    // Nothing of a run is shown before it finishes, or once it is out of date.
    attributes:
      status === "REVIEWED"
        ? (Array.isArray(value.attributes) ? value.attributes : [])
            .map((item) => parseAttribute(item, fileId))
            .filter((item): item is AssuredAttribute => item !== null)
        : [],
    outOfDate,
    finishedAt: str(value.finished_at) || null,
  };
}

function parseSummary(value: unknown): AssuranceSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  const keys = [
    "checking",
    "held",
    "supported",
    "issues",
    "unsettled",
  ] as const;
  const read = keys.map((key) => value[key]);
  if (
    !read.every(
      (count): count is number =>
        typeof count === "number" && Number.isInteger(count) && count >= 0,
    )
  ) {
    return null;
  }
  const [checking = 0, held = 0, supported = 0, issues = 0, unsettled = 0] =
    read;
  return { checking, held, supported, issues, unsettled };
}

/** The API's answer for a control (GET .../evidence-assurance); null when the body is
 * not one. One entry per file on a request (a file linked to two requests is checked
 * for each): one listed twice for the same request keeps its first entry. */
export function parseAssurance(value: unknown): EvidenceAssurance | null {
  if (!isRecord(value) || !Array.isArray(value.files)) {
    return null;
  }
  const seen = new Set<string>();
  const files = value.files
    .map(parseFile)
    .filter((file): file is AssuredFile => file !== null)
    .filter((file) => {
      const key = `${file.fileId}:${file.requirementId ?? ""}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  return { files, summary: parseSummary(value.summary) };
}

// The step's line

export type AssuranceCounts = {
  /** Files the chain has an entry for. */
  files: number;
  /** Files whose check is queued or at work. */
  checking: number;
  /** Files whose check is on hold. */
  held: number;
  /** Results both readings agree are an issue. */
  issues: number;
  /** Results that need the person's judgment. */
  unsettled: number;
  /** Files whose check failed or is out of date: to run again. */
  again: number;
};

/**
 * What the step's line counts: checking, held, issues and unsettled from the server's
 * `summary`, never below what the files on the page themselves show (a result this page
 * read cautiously as needing judgment is counted, though the server's summary could not
 * know it). Failed and out-of-date checks are not in the summary: they are counted from
 * the files. Support is not counted here: the step's line never states it.
 */
export function assuranceCounts(
  assurance: EvidenceAssurance | null,
): AssuranceCounts {
  const files = assurance?.files ?? [];
  const verdicts = files.flatMap((file) =>
    file.attributes.map((item) => item.verdict),
  );
  const summary = assurance?.summary ?? null;
  const shown = {
    checking: files.filter(
      (file) => file.status === "QUEUED" || file.status === "CHECKING",
    ).length,
    held: files.filter((file) => file.status === "HELD").length,
    issues: verdicts.filter((verdict) => verdict === "ISSUE").length,
    unsettled: verdicts.filter((verdict) => verdict === "UNSETTLED").length,
  };
  return {
    files: files.length,
    checking: Math.max(summary?.checking ?? 0, shown.checking),
    held: Math.max(summary?.held ?? 0, shown.held),
    issues: Math.max(summary?.issues ?? 0, shown.issues),
    unsettled: Math.max(summary?.unsettled ?? 0, shown.unsettled),
    again: files.filter(
      (file) => file.status === "FAILED" || file.status === "OUT_OF_DATE",
    ).length,
  };
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** What follows "N files to review" on the step's pill: what needs the person first,
 * then what is on hold, then what is still being checked. "" when nothing does. */
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
 * has no entry for the control's files. */
export function assuranceSentence(counts: AssuranceCounts): string {
  if (counts.files === 0) {
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
      ? `${plural(counts.held, "file")} on hold until you act on ${counts.held === 1 ? "its" : "their"} row`
      : "",
    counts.again > 0 ? `${plural(counts.again, "check")} to run again` : "",
    counts.checking > 0
      ? `${plural(counts.checking, "file")} still being checked`
      : "",
  ].filter((part) => part !== "");
  const reviewed =
    counts.files - counts.checking - counts.held - counts.again > 0;
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

/** Each state in words with its mark: the colour repeats them and never replaces them. */
export const STATE_WORDS: Record<
  AttributeState,
  {
    label: string;
    icon: IconName;
    tone: "success" | "danger" | "warning" | "neutral";
  }
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
  CONTRADICTED: "Contradicted in the file",
  CANNOT_TELL: "Could not tell",
  NOT_ADDRESSED: "Not addressed by the file",
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
export const READ_IN_PART = "The file was read in part.";

const stateOf = (verdict: Verdict): AttributeState =>
  verdict === "UNSETTLED" ? "JUDGMENT" : verdict;

export type AttributeLine = {
  /** The attribute's id, or its code where the server sent no id. */
  key: string;
  attributeId: string;
  letter: string;
  /** The attribute's wording; "" where it is no longer on the control. */
  text: string;
  /** The request asks for it: the file was expected to show it. */
  expected: boolean;
  state: AttributeState;
  /** "Supported", "Issue: not shown", "Your judgment needed", "Not addressed". */
  label: string;
  icon: IconName;
  tone: "success" | "danger" | "warning" | "neutral";
  summary: string;
  passages: Passage[];
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
    passages: item.passages,
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

// One file's check, as a row shows it

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

export type CheckAction = { kind: CheckActionKind; label: string };

const HELD_WORDS: Record<
  HeldCode,
  { reason: string; action: CheckAction | null }
> = {
  // Cleared in the evidence dialog, where the file's type is confirmed.
  KIND_UNSURE: {
    reason:
      "The file's type is not confirmed, so it has not been checked against the attributes.",
    action: { kind: "CONFIRM_TYPE", label: "Confirm the file's type" },
  },
  UNREADABLE: {
    reason:
      "Nothing readable could be taken from the file, so it has not been checked against the attributes.",
    action: { kind: "REPLACE", label: "Replace the file" },
  },
  CUSTODY: {
    reason:
      "The file did not pass its custody check, so it has not been checked against the attributes.",
    action: { kind: "REPLACE", label: "Replace the file" },
  },
  // Picked in the evidence dialog, on the population's own rows.
  POPULATION: {
    reason:
      "The file is a population. The walkthrough instance is picked first, then its records are checked.",
    action: { kind: "PICK_INSTANCE", label: "Pick the walkthrough instance" },
  },
  NO_ATTRIBUTES: {
    reason:
      "The control has no approved attribute, so there is nothing to check the file against.",
    action: null,
  },
  OTHER: {
    reason: "The check is on hold.",
    action: null,
  },
};

const STAGE_WORDS: Partial<Record<Stage, string>> = {
  ASSESS: "first reading",
  VERIFY: "second, independent reading",
  COMPARE: "comparing the two readings",
};

export type FileCheck = {
  fileId: string;
  standing: CheckStanding;
  /** The one line: what the check is doing, why it is held, or what it was checked
   * against. */
  line: string;
  /** Where a check at work has got to ("second, independent reading"); "" otherwise. */
  stage: string;
  /** The single action that clears a hold, or runs a check again; null when a person
   * can do nothing about it here. Offered only to a person who may act (offeredAction). */
  action: CheckAction | null;
  /** "The file was read in part.", where it was; null otherwise. */
  readInPart: string | null;
  /** Issues and judgments first, then what is supported, in the attributes' order. */
  attributes: AttributeLine[];
  /** Attributes the file does not bear on, folded to one quiet line. */
  notAddressed: AttributeLine[];
};

/** A sentence as the server sent it, closed with a full stop. */
const sentence = (text: string) =>
  text === "" || /[.!?…]$/.test(text) ? text : `${text}.`;

/** "against attributes A to C", "against attribute A", "against the attributes". */
function against(letters: readonly string[], span: Span): string {
  return letters.length === 0
    ? "against the attributes"
    : `against attribute${letters.length === 1 ? "" : "s"} ${span(letters)}`;
}

/** Letters as a person says them ("A to C", "A and C"), in the list's own way. */
export type Span = (letters: readonly string[]) => string;

/** One file's check as its row shows it. `attributes` are the control's approved
 * attributes with the list's letters: every one of them is checked. */
export function fileCheck(
  file: AssuredFile,
  attributes: readonly Lettered[],
  span: Span,
): FileCheck {
  const all = attributes.map((item) => item.letter);
  const base = {
    fileId: file.fileId,
    stage: "",
    action: null,
    readInPart: null,
    attributes: [],
    notAddressed: [],
  };
  if (file.status === "QUEUED" || file.status === "CHECKING") {
    return {
      ...base,
      standing: "CHECKING",
      line: `${file.status === "QUEUED" ? "Waiting to check" : "Checking"} ${against(all, span)}`,
      stage:
        file.status === "CHECKING" && file.stage !== null
          ? (STAGE_WORDS[file.stage] ?? "")
          : "",
    };
  }
  if (file.status === "HELD") {
    const words = HELD_WORDS[file.held?.code ?? "OTHER"];
    return {
      ...base,
      standing: "HELD",
      // The gate's own sentence where it sent one; this page's otherwise.
      line: sentence(file.held?.reason ?? "") || words.reason,
      action: words.action,
    };
  }
  if (file.status === "FAILED") {
    return {
      ...base,
      standing: "FAILED",
      line: "The check did not finish, so nothing of it is shown.",
      action: { kind: "RERUN", label: "Check again" },
    };
  }
  if (file.status === "OUT_OF_DATE") {
    return {
      ...base,
      standing: "OUT_OF_DATE",
      line: [
        "The check is out of date, so its results are not shown.",
        ...file.outOfDate.map(sentence),
      ].join(" "),
      action: { kind: "RERUN", label: "Check again" },
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
  const lines = file.attributes
    .map((item) => attributeLine(item, attributes))
    .sort((a, b) => rank[a.state] - rank[b.state] || inOrder(a, b));
  return {
    ...base,
    standing: "REVIEWED",
    line:
      lines.length === 0
        ? "The check finished without a result for any attribute."
        : `Checked ${against(
            [...lines].sort(inOrder).map((line) => line.letter),
            span,
          )} by two independent readings.`,
    readInPart: file.readInPart ? READ_IN_PART : null,
    attributes: lines.filter((line) => line.state !== "NOT_ADDRESSED"),
    notAddressed: lines.filter((line) => line.state === "NOT_ADDRESSED"),
  };
}

/** The action as the person is offered it: only to a person who may act, and a
 * replacement only where the file can be replaced now. */
export function offeredAction(
  action: CheckAction | null,
  facts: { canAct: boolean; replaceable: boolean },
): CheckAction | null {
  if (action === null || !facts.canAct) {
    return null;
  }
  return action.kind === "REPLACE" && !facts.replaceable ? null : action;
}

// One request row

export type StateGroup = {
  state: AttributeState;
  letters: string[];
  /** "A and C supported", "B issue", "D your judgment needed". */
  label: string;
  icon: IconName;
  tone: "success" | "danger" | "warning" | "neutral";
};

export type AssuranceRow = {
  /** Where the row's checks stand: a check at work first, then one on hold, one to run
   * again, and only then the finished ones. */
  standing: CheckStanding;
  /** The row's quiet line: "Checking against attributes A to C…", "Check on hold". */
  fact: string;
  /** Each file's check, by file. A file the chain has no entry for has none. */
  files: FileCheck[];
  /** Every in-force file of the row has an entry: the chain's results stand in for the
   * single reading's own proposal. */
  covered: boolean;
  /** Beside the row's letters once a check is finished: each letter under its state.
   * With several files a letter stands under every state a file gives it (supported by
   * one file, an issue on another): nothing a file shows is left off the row. */
  states: StateGroup[];
  /** The same for a screen reader and the step's notes: "A and C supported, B issue". */
  spoken: string;
  /** The attributes accepting the row's evidence marks as evidenced. */
  supportedIds: string[];
  /** Beside Accept: what accepting marks as evidenced, and what it does not settle. */
  acceptNote: string;
  /** A check is queued or at work: the list is read again until it ends. */
  working: boolean;
};

const STANDING_FACTS: Record<Exclude<CheckStanding, "CHECKING">, string> = {
  HELD: "Check on hold",
  FAILED: "Check did not finish",
  OUT_OF_DATE: "Check out of date",
  REVIEWED: "Checked by two readings",
};

/**
 * What a request row shows of its files' checks; null when the chain has no entry for
 * any of them (the row then reads as it did before the chain).
 */
export function assuranceRow(input: {
  /** The request the row is. */
  requirementId: string;
  /** The row's in-force files. */
  fileIds: readonly string[];
  assurance: EvidenceAssurance | null;
  /** The control's approved attributes, with the list's letters, in order. */
  attributes: readonly Lettered[];
  span: Span;
}): AssuranceRow | null {
  // A file's check on this request; an entry that names no request is the file's own.
  const entries = (input.assurance?.files ?? []).filter(
    (file) =>
      input.fileIds.includes(file.fileId) &&
      (file.requirementId === null ||
        file.requirementId === input.requirementId),
  );
  if (entries.length === 0) {
    return null;
  }
  const files = entries.map((file) =>
    fileCheck(file, input.attributes, input.span),
  );
  const has = (standing: CheckStanding) =>
    files.filter((file) => file.standing === standing).length;
  const standing: CheckStanding =
    (["CHECKING", "HELD", "FAILED", "OUT_OF_DATE"] as const).find(
      (each) => has(each) > 0,
    ) ?? "REVIEWED";
  const lines = files.flatMap((file) => file.attributes);
  const lettersIn = (state: AttributeState) => [
    ...new Set(
      lines.filter((line) => line.state === state).map((line) => line.letter),
    ),
  ];
  const supported = lettersIn("SUPPORTED");
  const issues = lettersIn("ISSUE");
  const judged = lettersIn("JUDGMENT");
  const order = input.attributes.map((item) => item.letter);
  const sorted = (letters: readonly string[]) =>
    [...letters].sort(
      (a, b) =>
        (order.indexOf(a) < 0 ? order.length : order.indexOf(a)) -
          (order.indexOf(b) < 0 ? order.length : order.indexOf(b)) ||
        a.localeCompare(b),
    );
  const grouped: Array<[AttributeState, string[]]> = [
    ["SUPPORTED", sorted(supported)],
    ["ISSUE", sorted(issues)],
    ["JUDGMENT", sorted(judged)],
  ];
  const states: StateGroup[] = grouped
    .filter(([, letters]) => letters.length > 0)
    .map(([state, letters]) => ({
      state,
      letters,
      label: `${input.span(letters)} ${STATE_WORDS[state].label.toLowerCase()}`,
      icon: STATE_WORDS[state].icon,
      tone: STATE_WORDS[state].tone,
    }));
  const all = input.attributes.map((item) => item.letter);
  return {
    standing,
    fact:
      standing === "CHECKING"
        ? `Checking ${against(all, input.span)}…`
        : STANDING_FACTS[standing],
    files,
    covered: input.fileIds.every((id) =>
      entries.some((file) => file.fileId === id),
    ),
    states,
    spoken: states.map((group) => group.label).join(", "),
    supportedIds: [
      ...new Set(
        lines
          .filter((line) => line.state === "SUPPORTED")
          .map((line) => line.attributeId)
          .filter((id) => id !== ""),
      ),
    ],
    acceptNote: acceptNote({
      reviewed: has("REVIEWED"),
      checking: has("CHECKING"),
      unchecked: has("HELD") + has("FAILED") + has("OUT_OF_DATE"),
      supported: sorted(supported),
      issues: sorted(issues),
      judged: sorted(judged),
      span: input.span,
    }),
    working: has("CHECKING") > 0,
  };
}

/**
 * Beside Accept: what accepting the row's evidence marks as evidenced (the attributes a
 * file of the row supports, and no other), and what it leaves open. It informs and
 * never blocks: Accept stays the person's.
 */
export function acceptNote(facts: {
  /** Files whose check is finished and current. */
  reviewed: number;
  checking: number;
  /** Files whose check is on hold, failed or out of date. */
  unchecked: number;
  supported: readonly string[];
  issues: readonly string[];
  judged: readonly string[];
  span: Span;
}): string {
  const { span } = facts;
  const still =
    facts.checking > 0
      ? `${plural(facts.checking, "file")} ${facts.checking === 1 ? "is" : "are"} still being checked.`
      : "";
  const unchecked =
    facts.unchecked > 0
      ? `${plural(facts.unchecked, "file")} ${facts.unchecked === 1 ? "has" : "have"} not been checked.`
      : "";
  if (facts.reviewed === 0) {
    return facts.checking > 0
      ? "The check is still running, so what accepting marks as evidenced is not known yet."
      : "This evidence has not been checked against the attributes, so accepting marks no attribute as evidenced.";
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
    still,
    unchecked,
  ]
    .filter((part) => part !== "")
    .join(" ");
}

// Running a check again

type Fields = Record<string, unknown>;
type AssuranceWrite = { path: string } | { error: "invalid" };

/** The API call behind "Check again" (the /workspace/evidence-assurance route): POST
 * .../evidence-assurance/{file_id}/rerun, with no body. */
export function assuranceWrite(fields: Fields): AssuranceWrite {
  const [organizationId, projectId, controlId, fileId] = [
    "organization_id",
    "project_id",
    "control_id",
    "file_id",
  ].map((key) => str(fields[key]));
  if (
    str(fields.intent) !== "rerun" ||
    ![organizationId, projectId, controlId, fileId].every((id) =>
      UUID.test(id ?? ""),
    )
  ) {
    return { error: "invalid" };
  }
  return {
    path: `/organizations/${organizationId}/projects/${projectId}/controls/${controlId}/evidence-assurance/${fileId}/rerun`,
  };
}

/** What a person reads when "Check again" did not go through; null when the server
 * confirmed it. */
export function assuranceProblem(status: number, detail = ""): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 409) {
    // A refusal the server words for people is shown as it is.
    return /^[A-Z0-9].*\.$/.test(detail)
      ? detail
      : "The check cannot be run again now: one is already at work on this file, or its result is current. The row is refreshed.";
  }
  if (status === 403) {
    return "Your role cannot run the check again.";
  }
  if (status === 404) {
    return "This file is no longer here to check. Refresh the page.";
  }
  if (status === 422) {
    return "The check could not be started for this file. Refresh the page and try again.";
  }
  return "The check could not be started. Try again in a moment.";
}
