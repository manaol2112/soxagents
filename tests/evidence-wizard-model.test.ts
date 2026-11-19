import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  parseEvidenceView,
  uploadTarget,
} from "../apps/web/src/evidence-model.ts";
import {
  ASKED_AGAIN,
  addressesLine,
  analyzedLine,
  analyzeLabel,
  announcement,
  apartTitle,
  askedAgain,
  attributeRows,
  attributesTitle,
  type BatchState,
  batchReadPath,
  batchToShow,
  choicesFor,
  elapsedSeconds,
  estimateText,
  extensionOf,
  type FileLine,
  fileLines,
  fileMark,
  fileMeta,
  filesApart,
  filesCount,
  filesNotAdded,
  finishedAt,
  finishedNote,
  finishOf,
  firstRead,
  formatDuration,
  formatElapsed,
  goneFromBatch,
  hintKey,
  idleGaps,
  isEarlierSession,
  itemCards,
  itemResults,
  itemsPane,
  leftWithout,
  NEEDS_YOU_STEP,
  NOT_ADDED_CHIP,
  NOT_READ_STEP,
  needsFix,
  noneAdded,
  notAddedTitle,
  OUT,
  OUT_LABEL,
  PLACE_FILES,
  parseBatch,
  parseBatchFile,
  parseBatchList,
  placementProblem,
  placementWrite,
  pollDelay,
  progressLine,
  progressOf,
  type Queued,
  queueHead,
  RESTORED_WAITING,
  readHint,
  readingProblem,
  refusalBlocks,
  resultsNote,
  resultsSummary,
  retryDelay,
  STALLED_AFTER_MS,
  seenFiles,
  serverClock,
  steadySeconds,
  tookLine,
  UNREACHABLE,
  UNREACHABLE_AFTER,
  type Upload,
  uploadAnswer,
  WITHDRAWN_LINK,
  type WizardItem,
  windowHeading,
  withdrawnCount,
  withdrawnFilesHref,
  withdrawnQuery,
  withoutRepeats,
  wizardItems,
  writeHint,
} from "../apps/web/src/evidence-wizard-model.ts";

// The D&I evidence wizard (docs/evidence-wizard.md; the product owner's prototype,
// approved 13 November 2026). The server decides every state the window shows; these
// tests hold the page to reading it, cautiously where it does not know a value, and to
// wording it without an internal code. The fixtures are the prototype's own control:
// ITGC-AC-03, Periodic User Access Review, with its two D&I items and seven files.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ORG, PROJECT, CONTROL, BATCH] = [uuid(1), uuid(2), uuid(3), uuid(4)];
const [POLICY, REVIEW] = [uuid(10), uuid(11)];
const [F1, F2, F3, F4, F5, F6, F7] = [21, 22, 23, 24, 25, 26, 27].map(uuid) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const [A, B, C, D, E, F] = [31, 32, 33, 34, 35, 36].map(uuid) as [
  string,
  string,
  string,
  string,
  string,
  string,
];
const CREATED = Date.parse("2026-11-13T14:00:00Z");
const at = (seconds: number) =>
  new Date(CREATED + seconds * 1000).toISOString();

const ATTRIBUTES = [
  "The user listing the reviewer used was complete and accurate",
  "The review was signed off by the designated application owner",
  "The reviewer recorded a decision for every user on the listing",
  "Every removal or change the reviewer requested was made in the system",
  "The review was completed, and its changes made, by 30 days after quarter end",
  "Access found inappropriate was investigated for unauthorized activity",
].map((text, index) => ({
  id: [A, B, C, D, E, F][index] ?? "",
  letter: "ABCDEF".charAt(index),
  text,
}));

const ITEMS: WizardItem[] = wizardItems(
  [
    {
      id: POLICY,
      title: "Access review policy and designated owners list",
      kind: "Policy or procedure",
      icon: "file",
      categories: ["PROCESS_DOCUMENTATION"],
      letters: ["B", "C", "D", "E", "F"],
      files: 0,
      aside: false,
      planState: "SENT",
      canAccept: true,
    },
    {
      id: REVIEW,
      title: "One completed quarterly review, start to finish",
      kind: "Walkthrough instance",
      icon: "list",
      categories: ["CONTROL_EXECUTION"],
      letters: ["A", "B", "C", "D", "E", "F"],
      files: 0,
      aside: false,
      planState: "SENT",
      canAccept: true,
    },
  ],
  [
    {
      id: POLICY,
      status: "REQUESTED",
      version: 3,
      pendingChange: null,
      sufficiencyBy: null,
      files: [],
    },
    {
      id: REVIEW,
      status: "REQUESTED",
      version: 5,
      pendingChange: null,
      sufficiencyBy: null,
      files: [],
    },
  ],
);

const where = (label: string, page: number | null = null) => ({
  label,
  page,
  sheet: null,
  row: null,
  column: null,
  cell: null,
});

/** One file of the batch as the server sends it: by default read and placed. */
/** The server's stage for a file (evidence_wizard._file_body), from its reading and its
 * placement, unless the test names one. */
function stageOf(entry: Record<string, unknown>): string {
  const read = (entry.read ?? {}) as { status?: unknown };
  const placement = (entry.placement ?? {}) as { status?: unknown };
  if (read.status === "FAILED") return "FAILED";
  if (read.status === "WORKING") return "READING";
  if (read.status !== "READY") return "STORED";
  return placement.status === "PLACED"
    ? "SORTED"
    : placement.status === "NEEDS_PERSON" || placement.status === "NOT_DESIGN"
      ? String(placement.status)
      : "READ";
}

function file(over: Record<string, unknown> = {}) {
  const entry = fileEntry(over);
  return "stage" in over ? entry : { ...entry, stage: stageOf(entry) };
}

function fileEntry(over: Record<string, unknown>) {
  return {
    file_id: F1,
    name: "Access Review Policy v3.2.pdf",
    size_bytes: 1_258_291,
    extension: "pdf",
    stage: "SORTED",
    read: {
      status: "READY",
      method: "TEXT",
      pages: 14,
      started_at: at(2),
      finished_at: at(9),
      note: "",
    },
    classification: {
      kind: "policy",
      label: "Policy or procedure",
      confidence: "high",
      summary: "The access review policy.",
    },
    placement: {
      status: "PLACED",
      method: "AGENT",
      requirement_ids: [POLICY],
      reason: "The reader found it covers the policy.",
      suggestions: [],
      version: 1,
    },
    addresses: [],
    ...over,
  };
}

const supported = (
  id: string,
  code: string,
  fileId: string,
  quote: string,
  label: string,
  shows = "IMPLEMENTATION",
) => ({
  attribute_id: id,
  code,
  expected: true,
  verdict: "SUPPORTED",
  result: "MET",
  shows,
  summary: `Attribute ${code} is shown.`,
  passages: [{ quote, file_id: fileId, location: where(label) }],
  absent: [],
  views: [],
  elements: [],
  finding_id: null,
  finding_status: null,
});

/** The policy's check: B to E supported by its design, F not satisfied. */
const POLICY_CHECK = {
  requirement_id: POLICY,
  run_id: uuid(41),
  status: "REVIEWED",
  stage: "DONE",
  held: null,
  held_files: [],
  file_ids: [F1],
  lens: "DESIGN_DOCUMENT",
  read_in_part: false,
  attributes: [
    supported(
      B,
      "B",
      F1,
      "Each quarter the application owner signs off the review.",
      "Page 3",
      "DESIGN",
    ),
    supported(
      C,
      "C",
      F1,
      "For every user on the listing, the reviewer records one decision.",
      "Page 4",
      "DESIGN",
    ),
    supported(
      D,
      "D",
      F1,
      "IT Security makes each removal or change the reviewer requests.",
      "Page 5",
      "DESIGN",
    ),
    supported(
      E,
      "E",
      F1,
      "The review is completed within 30 days after the end of the quarter.",
      "Page 5",
      "DESIGN",
    ),
    {
      attribute_id: F,
      code: "F",
      expected: true,
      verdict: "ISSUE",
      result: "NOT_MET",
      shows: null,
      summary:
        "The policy does not require access found inappropriate to be investigated",
      passages: [],
      absent: [
        "A step to find out whether access found inappropriate was used for unauthorized activity.",
      ],
      views: [],
      elements: [],
      finding_id: uuid(51),
      finding_status: "PROPOSED",
    },
  ],
  out_of_date: [],
  finished_at: at(33),
  note: "",
};

/** The quarterly review's check: A to D supported by its records, E not satisfied, F
 * left to the person (the readings disagree). */
const REVIEW_CHECK = {
  ...POLICY_CHECK,
  requirement_id: REVIEW,
  run_id: uuid(42),
  file_ids: [F2, F3, F4, F5],
  lens: "INSTANCE_RECORD",
  attributes: [
    supported(A, "A", F2, "Users: 1,248", "Row 2"),
    supported(
      B,
      "B",
      F3,
      "Reviewed and approved: Jamie Lynn Morales",
      "Page 1",
    ),
    supported(C, "C", F2, "Decisions recorded: 1,248 of 1,248", "Row 1,251"),
    supported(
      D,
      "D",
      F4,
      "RITM0048213 · Closed complete, 21 Jul 2026",
      "Page 2",
    ),
    {
      attribute_id: E,
      code: "E",
      expected: true,
      verdict: "ISSUE",
      result: "NOT_MET",
      shows: null,
      summary:
        "The last change was made on 10 Aug 2026, 41 days after quarter end (due within 30)",
      passages: [
        {
          quote: "2026-08-10 16:42:07, JMORALES, Lock user, RITM0048391",
          file_id: F5,
          location: where("Line 418"),
        },
      ],
      absent: [],
      views: [],
      elements: [],
      finding_id: uuid(52),
      finding_status: "PROPOSED",
    },
    {
      attribute_id: F,
      code: "F",
      expected: true,
      verdict: "UNSETTLED",
      result: null,
      shows: null,
      summary: "",
      passages: [],
      absent: [],
      views: [
        {
          role: "ASSESSOR",
          result: "MET",
          reason:
            "No inappropriate access was found, so nothing needed investigating.",
        },
        {
          role: "REVIEWER",
          result: "NOT_MET",
          reason:
            "The listing marks 2 users for removal as inappropriate; no investigation is recorded.",
        },
      ],
      elements: [],
      finding_id: null,
      finding_status: null,
    },
  ],
};

/** The prototype's run, finished: five files sorted into two items, a scan that needs a
 * person, and a photo that is not D&I evidence. */
function finishedBatch(over: Record<string, unknown> = {}) {
  return {
    batch_id: BATCH,
    control_id: CONTROL,
    chosen_requirement_id: null,
    created_at: at(0),
    server_now: at(40),
    stages: {
      stored: 7,
      read: 7,
      sorted: 7,
      checked_items: 2,
      items: 2,
      files: 7,
    },
    files: [
      file({
        addresses: ["B", "C", "D", "E"].map((code) => ({
          code,
          verdict: "SUPPORTED",
        })),
      }),
      file({
        file_id: F2,
        name: "Q2-2026 SAP user listing.xlsx",
        size_bytes: 389_120,
        extension: "xlsx",
        read: {
          status: "READY",
          method: "TEXT",
          pages: null,
          started_at: at(2),
          finished_at: at(8),
          note: "",
        },
        classification: {
          kind: "population",
          label: "Population or listing",
          confidence: "high",
          summary: "",
        },
        placement: {
          status: "PLACED",
          method: "AGENT",
          requirement_ids: [REVIEW],
          reason: "",
          suggestions: [],
          version: 1,
        },
        addresses: [
          { code: "A", verdict: "SUPPORTED" },
          { code: "C", verdict: "SUPPORTED" },
        ],
      }),
      file({
        file_id: F3,
        name: "Q2 review sign-off - J Morales.pdf",
        size_bytes: 215_040,
        read: {
          status: "READY",
          method: "TEXT",
          pages: 2,
          started_at: at(3),
          finished_at: at(6),
          note: "",
        },
        classification: {
          kind: "walkthrough",
          label: "Walkthrough evidence",
          confidence: "high",
          summary: "",
        },
        placement: {
          status: "PLACED",
          method: "AGENT",
          requirement_ids: [REVIEW],
          reason: "",
          suggestions: [],
          version: 1,
        },
        addresses: [{ code: "B", verdict: "SUPPORTED" }],
      }),
      file({
        file_id: F4,
        name: "SNOW change tickets Q2.pdf",
        size_bytes: 655_360,
        read: {
          status: "READY",
          method: "TEXT",
          pages: 9,
          started_at: at(4),
          finished_at: at(10),
          note: "",
        },
        classification: {
          kind: "change_history",
          label: "Change history or audit log",
          confidence: "high",
          summary: "",
        },
        placement: {
          status: "PLACED",
          method: "AGENT",
          requirement_ids: [REVIEW],
          reason: "",
          suggestions: [],
          version: 1,
        },
        addresses: [{ code: "D", verdict: "SUPPORTED" }],
      }),
      file({
        file_id: F5,
        name: "SAP SUIM change log Jul-2026.csv",
        size_bytes: 97_280,
        extension: "csv",
        read: {
          status: "READY",
          method: "TEXT",
          pages: null,
          started_at: at(5),
          finished_at: at(9),
          note: "",
        },
        classification: {
          kind: "change_history",
          label: "Change history or audit log",
          confidence: "medium",
          summary: "",
        },
        placement: {
          status: "PLACED",
          method: "AGENT",
          requirement_ids: [REVIEW],
          reason: "",
          suggestions: [],
          version: 1,
        },
        addresses: [{ code: "E", verdict: "ISSUE" }],
      }),
      file({
        file_id: F6,
        name: "Scan_0042.pdf",
        size_bytes: 2_516_582,
        stage: "NEEDS_PERSON",
        read: {
          status: "READY",
          method: "OCR",
          pages: 3,
          started_at: at(6),
          finished_at: at(14),
          note: "",
        },
        classification: {
          kind: "other",
          label: "Other",
          confidence: "low",
          summary: "",
        },
        placement: {
          status: "NEEDS_PERSON",
          method: "AGENT",
          requirement_ids: [],
          reason:
            "The reader is not sure enough of this file to place it. Choose where it goes.",
          suggestions: [
            {
              requirement_id: REVIEW,
              title: "One completed quarterly review, start to finish",
              reason: "The reader found it covers this item in part.",
            },
            {
              requirement_id: POLICY,
              title: "Access review policy and designated owners list",
              reason: "The reader found it covers this item in part.",
            },
          ],
          version: 1,
        },
      }),
      file({
        file_id: F7,
        name: "Team offsite photo.jpg",
        size_bytes: 3_250_585,
        extension: "jpg",
        stage: "NOT_DESIGN",
        read: {
          status: "READY",
          method: "OCR",
          pages: null,
          started_at: at(7),
          finished_at: at(9),
          note: "",
        },
        classification: {
          kind: "other",
          label: "Other",
          confidence: "high",
          summary: "",
        },
        placement: {
          status: "NOT_DESIGN",
          method: "AGENT",
          requirement_ids: [],
          reason:
            "The reader found it is not evidence for any of the control's D&I items. It stays in the control's files.",
          suggestions: [],
          version: 1,
        },
      }),
    ],
    items: [
      {
        requirement_id: POLICY,
        title: "Access review policy and designated owners list",
        request_title: "Request PBC-1A2B3C4D",
        letters: ["B", "C", "D", "E", "F"],
        file_ids: [F1],
        assurance: POLICY_CHECK,
      },
      {
        requirement_id: REVIEW,
        title: "One completed quarterly review, start to finish",
        request_title: "Request PBC-1A2B3C4D",
        letters: ["A", "B", "C", "D", "E", "F"],
        file_ids: [F2, F3, F4, F5],
        assurance: REVIEW_CHECK,
      },
    ],
    ...over,
  };
}

function batchOf(value: unknown): BatchState {
  const batch = parseBatch(value);
  assert.ok(batch !== null);
  return batch;
}

const NOW = CREATED + 40_000;
const facts = (over: Partial<Parameters<typeof fileLines>[2]> = {}) => ({
  items: ITEMS,
  chosenRequirementId: null,
  mine: true,
  now: NOW,
  ...over,
});
const lineOf = (lines: readonly FileLine[], fileId: string) => {
  const found = lines.find((line) => line.fileId === fileId);
  assert.ok(found !== undefined, `no line for ${fileId}`);
  return found;
};
const upload = (over: Partial<Upload> = {}): Upload => ({
  key: "u1",
  name: "Access Review Policy v3.2.pdf",
  folder: "",
  size: 1_258_291,
  sent: 0,
  state: "queued",
  fileId: null,
  detail: "",
  ...over,
});

/** Every string a value holds, however deep: what reaches the screen. */
function texts(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(texts);
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      // Ids, keys and the server's raw records are not shown.
      [
        "key",
        "fileId",
        "requirementId",
        "upload",
        "file",
        "value",
        "on",
        "icon",
        "tone",
        "mark",
        "state",
      ].includes(key)
        ? []
        : texts(item),
    );
  }
  return [];
}
// The server's codes, as they would leak: upper-case words and snake_case kinds (an
// English word such as "population" in a sentence is not a code).
const CODES =
  /\b(PLACED|NEEDS_PERSON|NOT_DESIGN|PENDING|WORKING|READY|FAILED|REVIEWED|QUEUED|CHECKING|HELD|NOT_CHECKED|OUT_OF_DATE|GATE|ASSESS|VERIFY|COMPARE|SUPPORTED|PARTLY_SUPPORTED|UNSETTLED|NOT_ADDRESSED|ISSUE|AGENT|PERSON|OCR|KIND_UNSURE|INSTANCE_RECORD|DESIGN_DOCUMENT|[a-z]+_[a-z_]+)\b/;

describe("the batch as the server sends it (section 2.4)", () => {
  it("reads every field of a finished run", () => {
    const batch = batchOf(finishedBatch());
    assert.equal(batch.batchId, BATCH);
    assert.equal(batch.controlId, CONTROL);
    assert.equal(batch.chosenRequirementId, null);
    assert.equal(batch.createdAt, CREATED);
    assert.equal(batch.serverNow, CREATED + 40_000);
    assert.deepEqual(batch.stages, {
      stored: 7,
      read: 7,
      sorted: 7,
      checkedItems: 2,
      items: 2,
      files: 7,
    });
    const scan = batch.files.find((item) => item.fileId === F6);
    assert.equal(scan?.read.method, "OCR");
    assert.equal(scan?.read.pages, 3);
    assert.equal(scan?.classification?.confidence, "low");
    assert.equal(scan?.placement.status, "NEEDS_PERSON");
    assert.deepEqual(
      scan?.placement.suggestions.map((item) => item.requirementId),
      [REVIEW, POLICY],
    );
    assert.equal(batch.items[0]?.check?.status, "REVIEWED");
    assert.equal(batch.items[1]?.check?.attributes.length, 6);
    assert.equal(batch.files[0]?.duplicate, false);
  });

  it("is not a batch without its id, and keeps a file or an item listed twice once", () => {
    assert.equal(parseBatch(null), null);
    assert.equal(parseBatch({ batch_id: "nope" }), null);
    const twice = batchOf({
      ...finishedBatch(),
      files: [file(), file({ name: "Another name.pdf" })],
      items: [finishedBatch().items[0], finishedBatch().items[0]],
    });
    assert.equal(twice.files.length, 1);
    assert.equal(twice.files[0]?.name, "Access Review Policy v3.2.pdf");
    assert.equal(twice.items.length, 1);
  });

  it("reads a value it does not know cautiously: a reading not ended is under way, a placement not known is a person's, a confidence not known is low, a check not known is still running", () => {
    const batch = batchOf({
      batch_id: BATCH,
      files: [
        file({
          read: {
            status: "SHREDDED",
            method: "LASER",
            pages: -3,
            started_at: "soon",
            finished_at: at(5),
            note: "x",
          },
          classification: {
            kind: "policy",
            label: "Policy or procedure",
            confidence: "certain",
          },
          placement: {
            status: "TELEPORTED",
            method: "ROBOT",
            requirement_ids: ["nope"],
            version: -1,
          },
        }),
        file({
          file_id: F2,
          placement: { status: "TELEPORTED", requirement_ids: [REVIEW] },
          classification: { kind: "policy", confidence: "certain" },
        }),
        file({
          file_id: F3,
          placement: { status: "PLACED", requirement_ids: [] },
        }),
      ],
      items: [
        {
          requirement_id: POLICY,
          file_ids: [F1],
          assurance: { status: "MYSTERY", attributes: [] },
        },
      ],
    });
    const [first, second, third] = batch.files;
    // Not known to have ended: pending, with nothing of an ended reading kept.
    // 18 November 2026 (design review): a reading says whether it took text from the
    // file and what clears one whose text was not read; one not ended has read nothing
    // and offers nothing. Old: no textRead or action.
    assert.deepEqual(first?.read, {
      status: "PENDING",
      method: "NONE",
      pages: null,
      startedAt: null,
      finishedAt: null,
      note: "",
      textRead: false,
      action: null,
    });
    assert.equal(first?.classification, null);
    assert.equal(first?.placement.status, "PENDING");
    assert.equal(first?.placement.method, "AGENT");
    assert.equal(first?.placement.version, 0);
    // Read, and a placement it does not know: a person chooses; a confidence it does not
    // know is low.
    assert.equal(second?.placement.status, "NEEDS_PERSON");
    assert.deepEqual(second?.placement.requirementIds, []);
    assert.equal(second?.classification?.confidence, "low");
    // "Placed" with no item named is not taken as placed.
    assert.equal(third?.placement.status, "NEEDS_PERSON");
    // A check whose status is not known is still being checked (the list's own rule).
    assert.equal(batch.items[0]?.check?.status, "CHECKING");
    assert.equal(batch.items[0]?.title, "An item of the control");
    // Counts the server did not send are what its lists show.
    assert.equal(batch.stages.files, 3);
    assert.equal(batch.stages.read, 2);
  });

  it("shows a file's kind in words, never its code", () => {
    const named = (classification: unknown) =>
      batchOf({ batch_id: BATCH, files: [file({ classification })] }).files[0]
        ?.classification?.label;
    assert.equal(
      named({ kind: "change_history", label: "change_history" }),
      "Change history or audit log",
    );
    assert.equal(
      named({ kind: "brand_new", label: "brand_new" }),
      "Type not identified",
    );
    assert.equal(named({ kind: "policy", label: "" }), "Policy or procedure");
    assert.equal(named({ kind: "x", label: "Board minutes" }), "Board minutes");
  });

  it("reads the file entry a placement answers with", () => {
    const entry = parseBatchFile(
      file({
        placement: {
          status: "PLACED",
          method: "PERSON",
          requirement_ids: [REVIEW],
          version: 2,
        },
      }),
    );
    assert.equal(entry?.placement.method, "PERSON");
    assert.equal(entry?.placement.version, 2);
    assert.equal(parseBatchFile({ name: "no id" }), null);
  });

  it("reads a file already held in this session as such (the server's duplicate)", () => {
    const batch = batchOf({
      batch_id: BATCH,
      files: [file({ duplicate: true })],
    });
    assert.equal(batch.files[0]?.duplicate, true);
    const line = lineOf(fileLines([], batch, facts()), F1);
    assert.equal(line.duplicate, true);
    assert.equal(line.movable, false);
    assert.deepEqual(line.activity, {
      text: "Already added earlier: shown where it is",
      on: false,
      tone: "plain",
    });
    // Shown where it is, at once.
    assert.equal(line.dest?.kind, "placed");
  });
});

describe("the control's recent sessions (GET .../evidence-batches)", () => {
  const list = (batches: unknown[]) => parseBatchList({ batches });
  const entry = (over: Record<string, unknown> = {}) => ({
    batch_id: BATCH,
    created_at: at(0),
    created_by_name: "Ryan James",
    chosen_requirement_id: null,
    files: 7,
    in_progress: false,
    needs_person: 0,
    not_design: 1,
    finished: true,
    finished_at: at(33),
    ...over,
  });

  it("is no list from an older server, and one session once", () => {
    assert.equal(parseBatchList({ detail: "Not Found" }), null);
    assert.equal(parseBatchList(null), null);
    assert.equal(list([entry(), entry()])?.length, 1);
    assert.equal(list([{ batch_id: "x" }])?.length, 0);
  });

  it("reads a session not known to have finished as in progress", () => {
    const [read] = list([{ batch_id: BATCH }]) ?? [];
    assert.equal(read?.inProgress, true);
    assert.equal(read?.finished, false);
    assert.equal(read?.needsPerson, 0);
    const [said] =
      list([entry({ in_progress: false, finished: false, needs_person: 1 })]) ??
      [];
    assert.equal(said?.inProgress, false);
  });

  it("reopens the latest session under way or needing a person, else the latest finished one, unless put away with Done here", () => {
    const done = entry({ batch_id: uuid(90) });
    const needs = entry({ batch_id: uuid(91), needs_person: 1 });
    const running = entry({
      batch_id: uuid(92),
      in_progress: true,
      finished: false,
    });
    const read = list([done, needs, running]) ?? [];
    assert.equal(batchToShow(read, new Set())?.batchId, uuid(91));
    assert.equal(batchToShow(read, new Set([uuid(91)]))?.batchId, uuid(92));
    // Rewritten after the review (13 November 2026, decision 13). Old: a finished session
    // nothing needs a person for was not shown (null). New: it is reopened from the list
    // (after any under way or needing a person), so a session is never lost; Done in this
    // browser puts it away. Reason: the lead's decision 13 and the reviewer's
    // batch-list fixtures (latest first).
    assert.equal(batchToShow(list([done]) ?? [], new Set())?.batchId, uuid(90));
    assert.equal(batchToShow(list([done]) ?? [], new Set([uuid(90)])), null);
    // Latest first among those under way or needing a person.
    assert.equal(
      batchToShow(list([running, needs]) ?? [], new Set())?.batchId,
      uuid(92),
    );
    // One under way is shown even if put away before (a person moved a file since).
    assert.equal(
      batchToShow(list([running]) ?? [], new Set([uuid(92)]))?.batchId,
      uuid(92),
    );
  });
});

describe("the routes", () => {
  it("reads one batch, or the control's sessions, by ids only", () => {
    const params = (over: Record<string, string>) =>
      new URLSearchParams({
        organization: ORG,
        project: PROJECT,
        control: CONTROL,
        ...over,
      });
    assert.equal(
      batchReadPath(params({ batch: BATCH })),
      `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/evidence-batches/${BATCH}`,
    );
    assert.equal(
      batchReadPath(params({})),
      `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/evidence-batches`,
    );
    assert.equal(batchReadPath(params({ batch: "../x" })), null);
    assert.equal(batchReadPath(params({ control: "x" })), null);
  });

  it("sends a placement at the version seen: on items, or none for not D&I evidence", () => {
    const fields = {
      organization_id: ORG,
      project_id: PROJECT,
      control_id: CONTROL,
      batch_id: BATCH,
      file_id: F6,
      requirement_ids: [REVIEW],
      version: 1,
    };
    assert.deepEqual(placementWrite(fields), {
      path: `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/evidence-batches/${BATCH}/files/${F6}/placement`,
      body: { requirement_ids: [REVIEW], version: 1 },
    });
    assert.deepEqual(placementWrite({ ...fields, requirement_ids: [] }), {
      path: `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/evidence-batches/${BATCH}/files/${F6}/placement`,
      body: { requirement_ids: [], version: 1 },
    });
    for (const bad of [
      { requirement_ids: ["x"] },
      { requirement_ids: [REVIEW, REVIEW] },
      { requirement_ids: REVIEW },
      { version: -1 },
      { version: 1.5 },
      { file_id: "x" },
    ]) {
      assert.deepEqual(placementWrite({ ...fields, ...bad }), {
        error: "invalid",
      });
    }
  });

  it("says a refused move in the server's sentence, and how to recover otherwise", () => {
    assert.equal(placementProblem(200), null);
    assert.equal(
      placementProblem(409, "the placement changed"),
      "The placement changed.",
    );
    assert.equal(
      placementProblem(409, "the agent is still reading this file"),
      "The agent is still reading this file.",
    );
    assert.equal(
      placementProblem(409, ""),
      "The file could not be moved now. It is shown where it is.",
    );
    assert.equal(placementProblem(403), "Your role cannot move evidence.");
    assert.equal(
      placementProblem(404),
      "This file is no longer part of this upload.",
    );
    assert.equal(
      placementProblem(0),
      "The file could not be moved. Try again in a moment.",
    );
  });

  it("uploads into the wizard with its control, and a row's item without its request", () => {
    const target = (over: Record<string, string>) =>
      uploadTarget(
        new URLSearchParams({
          organization: ORG,
          project: PROJECT,
          batch: BATCH,
          name: "Scan_0042.pdf",
          path: "",
          ...over,
        }),
      );
    const whole = target({ control: CONTROL });
    assert.ok(!("error" in whole));
    assert.equal(
      new URLSearchParams(whole.query).get("design_control_id"),
      CONTROL,
    );
    const row = target({
      control: CONTROL,
      requirement: REVIEW,
      applications: "ALL",
    });
    assert.ok(!("error" in row));
    assert.equal(new URLSearchParams(row.query).get("requirement_id"), REVIEW);
    assert.equal(new URLSearchParams(row.query).get("request_id"), null);
    // A wizard upload never names a request; an item needs its request outside it.
    assert.deepEqual(target({ control: CONTROL, request: uuid(99) }), {
      error: "invalid",
    });
    assert.deepEqual(target({ requirement: REVIEW }), { error: "invalid" });
    assert.deepEqual(target({ control: "x" }), { error: "invalid" });
  });

  it("reads the upload's answer: stored, already held, refused in the server's words, or not reached", () => {
    // 17 November 2026 (owner decision "Restore and read"): every answer also says
    // `restored` and `withdrawn`, so a retried row never keeps an earlier try's word.
    // Old: { state, fileId, detail }; new: the same three, with both false here.
    assert.deepEqual(uploadAnswer(200, { file_id: F1, duplicate: false }), {
      state: "stored",
      fileId: F1,
      detail: "",
      restored: false,
      withdrawn: false,
      withdrawnFrom: null,
    });
    assert.equal(
      uploadAnswer(200, { file_id: F1, duplicate: true }).state,
      "duplicate",
    );
    assert.deepEqual(
      uploadAnswer(409, {
        detail:
          "this batch was opened for another item; start the wizard again",
      }),
      {
        state: "refused",
        fileId: null,
        detail:
          "This batch was opened for another item; start the wizard again.",
        restored: false,
        withdrawn: false,
        withdrawnFrom: null,
      },
    );
    assert.equal(
      uploadAnswer(413, {}).detail,
      "It is larger than 25 MB, so it was not added.",
    );
    assert.equal(uploadAnswer(503, {}).state, "failed");
    assert.equal(
      uploadAnswer(0, null).detail,
      "It did not reach the evidence store. Try again.",
    );
    // A 200 without a file id is not a stored file.
    assert.equal(uploadAnswer(200, {}).state, "failed");
  });

  it("has a route that reads and moves, and the list opens the wizard everywhere it took files", () => {
    const route = "apps/web/app/workspace/evidence-batches/route.ts";
    assert.ok(existsSync(route));
    const source = readFileSync(route, "utf8");
    assert.match(source, /export async function GET/);
    assert.match(source, /export async function POST/);
    assert.match(source, /batchReadPath\(/);
    assert.match(source, /placementWrite\(fields\)/);
    const list = readFileSync("apps/web/src/design-evidence.tsx", "utf8");
    assert.match(list, /Upload evidence/);
    assert.match(list, /onClick=\{wizard\.openFromList\}/);
    assert.match(
      list,
      /onUpload=\{\(picked\) => wizard\.startNew\(row\.id, picked\)\}/,
    );
    assert.match(list, /wizard\.startNew\(null, picked\)/);
    assert.match(list, /<EvidenceWizard wizard=\{wizard\} \/>/);
    assert.match(list, /<WizardProgress wizard=\{wizard\} \/>/);
    const view = readFileSync("apps/web/src/evidence-wizard.tsx", "utf8");
    // The Review and send window, opened with showModal().
    assert.match(view, /className="confirm-dialog cs-dialog wz-dialog"/);
    assert.match(view, /node\.showModal\(\)/);
    // Accept is the list's own judgement, at the item's version.
    assert.match(view, /sufficiency: "ACCEPTED"/);
    assert.match(view, /version: item\.version/);
    // sessionStorage is a hint, read and written in try/catch.
    assert.match(view, /sessionStorage/);
    assert.equal(/localStorage/.test(view), false);
    assert.equal(
      /location\.reload|window\.location\.href\s*=/.test(view),
      false,
    );
    const css = readFileSync("apps/web/app/evidence-wizard.css", "utf8");
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    const layout = readFileSync("apps/web/app/layout.tsx", "utf8");
    assert.match(layout, /import "\.\/evidence-wizard\.css";/);
  });
});

describe("step 1: the files queued", () => {
  const queued = (over: Partial<Queued> = {}): Queued => ({
    key: "q1",
    name: "Access Review Policy v3.2.pdf",
    folder: "",
    size: 1_258_291,
    skipped: "",
    ...over,
  });

  it("counts what will go, and says Analyze with the count", () => {
    const queue = [
      queued(),
      queued({
        key: "q2",
        name: "Q2-2026 SAP user listing.xlsx",
        size: 389_120,
      }),
      queued({
        key: "q3",
        name: "huge.zip",
        size: 0,
        skipped: "Larger than 25 MB",
      }),
    ];
    assert.deepEqual(queueHead(queue), {
      title: "2 files ready",
      size: "1.6 MB in all",
    });
    assert.deepEqual(analyzeLabel(queue), {
      label: "Analyze 2 files",
      ready: true,
    });
    assert.deepEqual(analyzeLabel([]), {
      label: "Add files to analyze",
      ready: false,
    });
    assert.deepEqual(analyzeLabel([queue[2] as Queued]), {
      label: "No file here can be added",
      ready: false,
    });
  });

  it("queues the same file once", () => {
    const next = withoutRepeats(
      [queued()],
      [queued({ key: "q2" }), queued({ key: "q3", folder: "Q2" })],
    );
    assert.deepEqual(
      next.map((item) => item.skipped),
      ["", "Already in the list", ""],
    );
  });

  it("marks each file by its type, in words too; a scanned PDF once the reading says so", () => {
    assert.deepEqual(fileMark("Access Review Policy v3.2.pdf"), {
      mark: "pdf",
      label: "PDF",
      type: "PDF",
    });
    assert.deepEqual(fileMark("Scan_0042.pdf", "pdf", "OCR"), {
      mark: "scan",
      label: "SCAN",
      type: "Scanned PDF",
    });
    assert.equal(
      fileMark("Q2-2026 SAP user listing.xlsx").type,
      "Excel workbook",
    );
    assert.equal(fileMark("photo.JPG").type, "JPEG image");
    assert.deepEqual(fileMark("notes.rtf"), {
      mark: "file",
      label: "RTF",
      type: "RTF file",
    });
    assert.deepEqual(fileMark("README"), {
      mark: "file",
      label: "FILE",
      type: "File",
    });
    assert.equal(extensionOf(".hidden"), "");
    assert.equal(
      fileMeta(fileMark("a.pdf"), 1_258_291, 14),
      "PDF · 1.2 MB · 14 pages",
    );
    assert.equal(fileMeta(fileMark("a.csv"), null), "CSV");
  });

  it("titles the side panel and the window from the control and its request", () => {
    assert.equal(attributesTitle(6), "The six attributes");
    assert.equal(attributesTitle(1), "The one attribute");
    assert.equal(attributesTitle(14), "The 14 attributes");
    assert.deepEqual(
      windowHeading({
        controlRef: "ITGC-AC-03",
        controlTitle: "Periodic User Access Review",
        system: "SAP S/4HANA",
        engagement: "SOX FY2027",
        requests: [
          {
            to: "Jamie Lynn Morales",
            role: "Application Owner",
            due: "Due Nov 23, 2026",
          },
        ],
      }),
      {
        title: "Add evidence for ITGC-AC-03 Periodic User Access Review",
        sub: "SAP S/4HANA · SOX FY2027 · One request to Jamie Lynn Morales, due Nov 23, 2026",
        requested: {
          to: "Jamie Lynn Morales",
          rest: "Application Owner, due Nov 23, 2026",
        },
      },
    );
    // Evidence in hand goes to nobody: no request line.
    assert.equal(
      windowHeading({
        controlRef: "",
        controlTitle: "",
        system: "",
        engagement: "",
        requests: [{ to: "", role: "", due: "" }],
      }).title,
      "Add D&I evidence",
    );
  });

  it("offers only the items that still expect evidence", () => {
    const items = wizardItems(
      [
        {
          id: POLICY,
          title: "P",
          kind: "Policy or procedure",
          icon: "file",
          categories: ["PROCESS_DOCUMENTATION"],
          letters: ["B"],
          files: 1,
          aside: false,
          planState: "ACCEPTED",
          canAccept: false,
        },
        {
          id: REVIEW,
          title: "R",
          kind: "Walkthrough instance",
          icon: "list",
          categories: ["CONTROL_EXECUTION"],
          letters: ["A"],
          files: 0,
          aside: false,
          planState: "SENT",
          canAccept: false,
        },
        {
          id: uuid(12),
          title: "W",
          kind: "Report",
          icon: "chart",
          categories: ["REPORT_RELIABILITY"],
          letters: [],
          files: 0,
          aside: true,
          planState: "NOT_APPLICABLE",
          canAccept: false,
        },
        {
          id: uuid(13),
          title: "N",
          kind: "Report",
          icon: "chart",
          categories: [],
          letters: [],
          files: 0,
          aside: false,
          planState: "SENT",
          canAccept: false,
        },
      ],
      [
        {
          id: POLICY,
          status: "REQUESTED",
          version: 1,
          pendingChange: null,
          sufficiencyBy: "Daniel Osei",
          files: [{ fileId: F1, name: "a.pdf" }],
        },
        {
          id: REVIEW,
          status: "REQUESTED",
          version: 2,
          pendingChange: null,
          sufficiencyBy: null,
          files: [],
        },
        {
          id: uuid(13),
          status: "REQUESTED",
          version: 1,
          pendingChange: { add: true },
          sufficiencyBy: null,
          files: [],
        },
      ],
    );
    assert.deepEqual(
      items.map((item) => [item.title, item.choosable, item.shows]),
      [
        ["P", false, "Design"],
        ["R", true, "Implementation"],
        ["W", false, ""],
        ["N", false, ""],
      ],
    );
    assert.equal(items[0]?.accepted, true);
    assert.equal(items[0]?.acceptedBy, "Daniel Osei");
    assert.deepEqual(items[0]?.held, [{ id: F1, name: "a.pdf" }]);
  });
});

describe("step 2: the pipeline, each file's row, the elapsed time", () => {
  it("draws the stages from the records while files are sent: bytes first, then the server's answer", () => {
    const uploads = [
      upload({ key: "u1", state: "stored", fileId: F1, sent: 1_258_291 }),
      upload({
        key: "u2",
        name: "Q2-2026 SAP user listing.xlsx",
        size: 400_000,
        sent: 100_000,
        state: "sending",
      }),
      upload({ key: "u3", name: "Scan_0042.pdf", state: "queued" }),
    ];
    const batch = batchOf({
      batch_id: BATCH,
      created_at: at(0),
      server_now: at(3),
      files: [
        file({
          read: {
            status: "WORKING",
            method: "NONE",
            pages: 14,
            started_at: at(2),
            finished_at: null,
            note: "",
          },
          classification: null,
          placement: {
            status: "PENDING",
            method: "AGENT",
            requirement_ids: [],
            reason: "",
            suggestions: [],
            version: 0,
          },
        }),
      ],
      items: [],
    });
    const progress = progressOf(uploads, batch, CREATED + 3000);
    assert.deepEqual(
      progress.stages.map((stage) => [stage.state, stage.count, stage.flag]),
      [
        ["active", "Secured 1 of 3", ""],
        ["active", "Read 0 of 3", ""],
        ["wait", "Waiting", ""],
        ["wait", "Waiting for sorted files", ""],
      ],
    );
    assert.equal(progress.uploading, true);
    assert.equal(progress.done, false);
    const lines = fileLines(uploads, batch, facts({ now: CREATED + 3000 }));
    assert.deepEqual(lines[0]?.track, ["done", "active", "wait", "wait"]);
    assert.deepEqual(lines[0]?.activity, {
      text: "Reading 14 pages",
      on: true,
      tone: "plain",
    });
    assert.deepEqual(lines[1]?.track, ["active", "wait", "wait", "wait"]);
    assert.equal(lines[1]?.sent, 0.25);
    // In the product's own sizes (format.ts: whole numbers from 10 up).
    assert.equal(
      lines[1]?.activity?.text,
      "Securing the file and its custody record · 98 KB of 391 KB",
    );
    assert.deepEqual(lines[2]?.activity, {
      text: "Waiting to be secured",
      on: false,
      tone: "plain",
    });
    // All bytes sent, the server not answered yet: storing, not stored.
    const storing = fileLines(
      [upload({ state: "sending", sent: 1_258_291 })],
      null,
      facts(),
    );
    assert.equal(
      storing[0]?.activity?.text,
      "Storing the file and its custody record",
    );
    assert.deepEqual(
      pollDelay({
        open: true,
        uploading: true,
        reading: true,
        checking: false,
      }),
      2000,
    );
  });

  it("words each file once read: its type and how sure, then where it went or what it needs", () => {
    const batch = batchOf(finishedBatch());
    const lines = fileLines([], batch, facts());
    const policy = lineOf(lines, F1);
    assert.deepEqual(policy.track, ["done", "done", "done", "done"]);
    assert.equal(policy.activity, null);
    assert.deepEqual(policy.kind, {
      label: "Policy or procedure",
      confidence: "High confidence",
      low: false,
    });
    assert.deepEqual(policy.dest, {
      kind: "placed",
      titles: ["Access review policy and designated owners list"],
      note: "",
    });
    assert.equal(policy.meta, "PDF · 1.2 MB · 14 pages");
    const scan = lineOf(lines, F6);
    assert.equal(scan.mark.type, "Scanned PDF");
    assert.deepEqual(scan.track, ["done", "done", "done", "needs"]);
    assert.deepEqual(scan.kind, {
      label: "Other",
      confidence: "Low confidence",
      low: true,
    });
    assert.equal(scan.dest?.kind, "needs");
    const photo = lineOf(lines, F7);
    assert.deepEqual(photo.dest, {
      kind: "out",
      note: "",
      reason:
        "The reader found it is not evidence for any of the control's D&I items. It stays in the control's files.",
    });
  });

  it("offers a person the agent's suggestions first, marked, then the other items, then not D&I evidence", () => {
    const batch = batchOf(finishedBatch());
    const scan = batch.files.find((item) => item.fileId === F6);
    assert.ok(scan !== undefined);
    assert.deepEqual(choicesFor(scan, ITEMS, batch), {
      choices: [
        {
          value: REVIEW,
          label: "One completed quarterly review, start to finish (suggested)",
        },
        {
          value: POLICY,
          label: "Access review policy and designated owners list",
        },
        { value: OUT, label: OUT_LABEL },
      ],
      preselect: REVIEW,
    });
    // Without a suggestion nothing is chosen for the person.
    const bare = { ...scan, placement: { ...scan.placement, suggestions: [] } };
    assert.equal(choicesFor(bare, ITEMS, batch).preselect, "");
    assert.equal(choicesFor(bare, ITEMS, batch).choices.length, 3);
    // An item that takes no more evidence is not offered, even when suggested.
    const closed = ITEMS.map((item) =>
      item.requirementId === REVIEW ? { ...item, choosable: false } : item,
    );
    assert.deepEqual(
      choicesFor(scan, closed, batch).choices.map((item) => item.value),
      [POLICY, OUT],
    );
  });

  it("says a stalled reading, and a failed one with its note and a person's choice", () => {
    const working = batchOf({
      batch_id: BATCH,
      files: [
        file({
          read: {
            status: "WORKING",
            method: "NONE",
            pages: null,
            started_at: at(0),
            finished_at: null,
            note: "",
          },
          classification: null,
          placement: { status: "PENDING", requirement_ids: [], version: 0 },
        }),
      ],
    });
    const quick = fileLines([], working, facts({ now: CREATED + 60_000 }))[0];
    assert.equal(quick?.activity?.text, "Reading the file");
    const stalled = fileLines(
      [],
      working,
      facts({ now: CREATED + STALLED_AFTER_MS + 1000 }),
    )[0];
    assert.deepEqual(stalled?.activity, {
      text: "Still reading: this file is taking longer than usual",
      on: true,
      tone: "warning",
    });
    const failed = batchOf({
      batch_id: BATCH,
      files: [
        file({
          read: {
            status: "FAILED",
            method: "NONE",
            pages: null,
            started_at: at(0),
            finished_at: at(30),
            note: "the file is password protected",
          },
          classification: null,
          placement: {
            status: "NEEDS_PERSON",
            method: "AGENT",
            requirement_ids: [],
            reason: "Reading it did not finish. Choose where it goes.",
            suggestions: [],
            version: 1,
          },
        }),
      ],
    });
    const line = fileLines([], failed, facts())[0];
    assert.deepEqual(line?.track, ["done", "failed", "failed", "needs"]);
    assert.deepEqual(line?.activity, {
      text: "Could not be read. The file is password protected.",
      on: false,
      tone: "danger",
    });
    assert.equal(line?.dest?.kind, "needs");
    assert.equal(line?.kind, null);
  });

  it("says a file the server refused in its words, and lets one that did not arrive be sent again", () => {
    const lines = fileLines(
      [
        upload({
          key: "u1",
          state: "refused",
          detail:
            "This batch was opened for another item; start the wizard again.",
        }),
        upload({
          key: "u2",
          state: "failed",
          detail: "It did not reach the evidence store. Try again.",
        }),
      ],
      null,
      facts(),
    );
    assert.deepEqual(
      lines.map((line) => [line.track[0], line.retry]),
      [
        ["failed", false],
        ["failed", true],
      ],
    );
    // Design review, 17 November 2026 (one screen, one story): the row's red "Not added" chip says what happened, in place of its
    // track; the activity is only the reason, in plain text. Old: the activity
    // "Not added. This batch was opened ..." in red; new: the reason alone (tone
    // "note") and `notAdded` true. The facts shown are unchanged.
    assert.equal(
      lines[0]?.activity?.text,
      "This batch was opened for another item; start the wizard again.",
    );
    assert.equal(lines[0]?.activity?.tone, "note");
    assert.deepEqual(
      lines.map((line) => line.notAdded),
      [true, true],
    );
    const progress = progressOf(
      [upload({ state: "refused" }), upload({ key: "u2", state: "failed" })],
      null,
      NOW,
    );
    assert.equal(progress.stages[0]?.flag, "2 not added");
    assert.equal(progress.done, true);
  });

  it("never shows a check that did not finish as checked, done or green (design review round 4, 18 November 2026)", () => {
    // A failed check (no model, provider down) ended without a verdict. Before, it counted as
    // checked: a done tick and "Checked 1 of 1 item" sat over an item card saying the check
    // did not finish, and once every file was placed the finish would have turned green.
    const raw = finishedBatch();
    const failedItem = {
      ...raw.items[0],
      assurance: { ...POLICY_CHECK, status: "FAILED" },
    };
    const batch = batchOf({ ...raw, items: [failedItem, raw.items[1]] });
    const progress = progressOf([], batch, NOW);
    assert.equal(progress.failedChecks, 1);
    assert.equal(progress.checked, 1);
    const check = progress.stages.find((stage) => stage.key === "check");
    assert.deepEqual(
      [check?.state, check?.count],
      ["problem", "1 of 2 items not checked"],
    );
    const finish = finishOf(0, progress);
    assert.notEqual(finish.tone, "success");
    assert.match(finish.note, /1 check did not finish\./);
    const line = progressLine({ progress, summary: null, seconds: 0 });
    assert.equal(line?.tone, "warning");
    assert.match(line?.text ?? "", /1 check did not finish\./);
    // Every file placed, a check failed: still amber, never green.
    const placedOnly = { ...progress, needs: 0, notAdded: 0 };
    assert.equal(finishOf(0, placedOnly).tone, "warning");
    assert.equal(
      finishOf(0, { ...placedOnly, failedChecks: 0 }).tone,
      "success",
    );
  });

  // Design review, 18 November 2026: the dialog said "Read 3 of 3", each file "Read", and
  // "Checked 1 of 1 item" and "Finished in 0:23" in green, while the item said none of
  // its files was read. A file whose text was not read is not read; a held check is not
  // checked; the finish is amber and says why. Round 3 (same day): "not read" is the
  // file's own reading's word (read.text_read), before it is placed as after, never the
  // check's held list.
  it("never counts a file not read as read, nor a held check as checked", () => {
    const base = finishedBatch();
    const raw = {
      ...base,
      files: base.files.map((entry) =>
        entry.file_id === F1
          ? {
              ...entry,
              read: { ...entry.read, text_read: false, action: null },
            }
          : entry,
      ),
    };
    const held = {
      ...raw.items[0],
      assurance: {
        ...POLICY_CHECK,
        status: "HELD",
        held: { code: "UNREADABLE", reason: "" },
        held_files: [
          { file_id: F1, code: "UNREADABLE", reason: "", action: null },
        ],
        file_ids: [],
        attributes: [],
      },
    };
    const batch = batchOf({ ...raw, items: [held, raw.items[1]] });
    const progress = progressOf([], batch, NOW);
    assert.deepEqual([progress.notRead, progress.unchecked], [1, 1]);
    assert.equal(progress.checked, 1);
    assert.deepEqual(
      progress.stages.map((stage) => [stage.state, stage.count, stage.flag]),
      [
        ["done", "Secured 7 of 7", ""],
        ["partial", "Read 6 of 7", "1 not read"],
        ["partial", "Sorted 6 of 7", "1 needs you"],
        ["partial", "Checked 1 of 2 items", "1 not checked"],
      ],
    );
    const finish = finishOf(23, progress);
    assert.equal(finish.tone, "warning");
    assert.equal(
      finish.note,
      "Finished in 0:23. 1 file needs you. 1 item not checked: 1 file could not be read.",
    );
    // Every file placed: still amber, never green over an item not checked.
    assert.equal(finishOf(23, { ...progress, needs: 0 }).tone, "warning");
    assert.equal(
      finishOf(23, { ...progress, needs: 0 }).note,
      "Finished in 0:23. 1 item not checked: 1 file could not be read.",
    );
    const line = progressLine({ progress, summary: null, seconds: 23 });
    assert.equal(line?.tone, "warning");
    assert.match(
      line?.text ?? "",
      /1 item not checked: 1 file could not be read./,
    );
    // The file's own Read step says it was not read, amber; the others keep theirs.
    const lines = fileLines([], batch, facts());
    const shot = lineOf(lines, F1);
    assert.equal(shot.track[1], "needs");
    assert.equal(shot.trackLabels[1], NOT_READ_STEP);
    assert.equal(NOT_READ_STEP, "Not read");
    const other = lineOf(lines, F2);
    assert.deepEqual([other.track[1], other.trackLabels[1]], ["done", "Read"]);
    // The only item held: "1 item not checked", never "Checked 0 of 1 item".
    const alone = batchOf({ ...raw, items: [held] });
    const check = progressOf([], alone, NOW).stages[3];
    assert.deepEqual(
      [check?.state, check?.count, check?.flag],
      ["partial", "1 item not checked", ""],
    );
  });

  // Design review, 18 November 2026, round 3: the dialog offered "Read it again" from the
  // words of the server's reason while text recognition was not available; before the
  // file was placed it said "Read 1 of 1" and "Read"; the item's line counted the whole
  // request's files while the card counted this upload's.
  describe("a file whose text was not read, in the dialog", () => {
    const OCR_UNAVAILABLE =
      "Text recognition is not available, so the text in the file's images could not be read. Review the file yourself, or read it again once an owner or admin turns on text recognition in Settings › AI workforce.";
    const shot = (over: Record<string, unknown> = {}) =>
      file({
        name: "1_screenshot.png",
        extension: "png",
        read: {
          status: "READY",
          method: "NONE",
          pages: 1,
          started_at: at(2),
          finished_at: at(9),
          note: "",
          text_read: false,
          action: null,
        },
        placement: {
          status: "NEEDS_PERSON",
          method: "AGENT",
          requirement_ids: [],
          reason: OCR_UNAVAILABLE,
          suggestions: [],
          version: 1,
        },
        ...over,
      });
    const waiting = (read: Record<string, unknown> = {}) =>
      batchOf(
        finishedBatch({
          files: [
            shot({
              read: {
                status: "READY",
                method: "NONE",
                pages: 1,
                started_at: at(2),
                finished_at: at(9),
                note: "",
                text_read: false,
                action: null,
                ...read,
              },
            }),
          ],
          items: [],
        }),
      );

    it("offers Read the file again only where the server says it can read it now", () => {
      const off = waiting();
      const [file] = off.files;
      assert.ok(file !== undefined);
      // The reason's own words ("read it again once…") offer nothing.
      assert.match(file.placement.reason, /read it again once/);
      assert.equal(needsFix(file), null);
      const line = lineOf(fileLines([], off, facts()), F1);
      assert.equal(line.dest?.kind === "needs" ? line.dest.fix : "", null);
      const [now] = waiting({ action: "READ_AGAIN" }).files;
      assert.ok(now !== undefined);
      assert.equal(now.read.action, "READ_AGAIN");
      assert.equal(needsFix(now), "reread");
      // A reading that failed is read again, as before.
      const [failed] = waiting({ status: "FAILED", text_read: false }).files;
      assert.ok(failed !== undefined);
      assert.equal(needsFix(failed), "reread");
    });

    it("says it was not read before it is placed, from its own reading", () => {
      const before = waiting();
      const progress = progressOf([], before, NOW);
      assert.equal(progress.notRead, 1);
      const read = progress.stages[1];
      assert.deepEqual(
        [read?.state, read?.count, read?.flag],
        ["partial", "Read 0 of 1", "1 not read"],
      );
      const [line] = fileLines([], before, facts());
      assert.deepEqual(
        [line?.track[1], line?.trackLabels[1]],
        ["needs", NOT_READ_STEP],
      );
      const finish = finishOf(9, progress);
      assert.equal(finish.tone, "warning");
      assert.match(finish.note, / 1 file could not be read\.$/);
      // An older server that does not say text_read: a reading that ended READY is read.
      const older = batchOf(finishedBatch({ files: [file()], items: [] }));
      assert.equal(older.files[0]?.read.textRead, true);
    });

    it("words the item's line for this upload's files, and the request's others apart", () => {
      const mine = [F1, F2];
      const raw = finishedBatch({
        files: mine.map((fileId, at) =>
          shot({
            file_id: fileId,
            name: `${at + 1}_screenshot.png`,
            placement: {
              status: "PLACED",
              method: "PERSON",
              requirement_ids: [POLICY],
              reason: "",
              suggestions: [],
              version: 2,
            },
          }),
        ),
        items: [
          {
            requirement_id: POLICY,
            title: "Access review policy and designated owners list",
            request_title: "Request PBC-1A2B3C4D",
            letters: ["B", "C", "D", "E", "F"],
            file_ids: mine,
            assurance: {
              ...POLICY_CHECK,
              status: "HELD",
              held: { code: "UNREADABLE", reason: OCR_UNAVAILABLE },
              file_ids: [],
              attributes: [],
              held_files: [...mine, uuid(250)].map((fileId) => ({
                file_id: fileId,
                code: "UNREADABLE",
                reason: OCR_UNAVAILABLE,
                action: null,
              })),
            },
          },
        ],
      });
      const batch = batchOf(raw);
      const [card] = itemCards(batch, {
        items: ITEMS,
        attributes: ATTRIBUTES,
        now: NOW,
      });
      assert.equal(card?.count, "2 files");
      assert.equal(
        card?.status.text,
        "2 files were not read, so the request was not checked: text recognition is not available. Review the files yourself, or read them again once an owner or admin turns on text recognition in Settings › AI workforce. 1 other file on this request was not read either.",
      );
      const progress = progressOf([], batch, NOW);
      assert.equal(
        finishOf(9, progress).note,
        "Finished in 0:09. 1 item not checked: 2 files could not be read.",
      );
      assert.deepEqual(
        [progress.stages[1]?.count, progress.stages[1]?.flag],
        ["Read 0 of 2", "2 not read"],
      );
      // Round 4, 18 November 2026: the list line's banner says what the footer says of a
      // held, not-read check ("1 item not checked"), never "did not finish".
      const banner = progressLine({ progress, summary: null, seconds: 9 });
      assert.equal(banner?.tone, "warning");
      assert.equal(
        banner?.text,
        "2 files read: 2 sorted into the items. 1 item not checked: 2 files could not be read.",
      );
      assert.ok(
        (banner?.text ?? "").endsWith(
          finishOf(9, progress).note.replace(/^Finished in 0:09\./, ""),
        ),
      );
      assert.doesNotMatch(banner?.text ?? "", /did not finish/);
    });

    // Round 4, 18 November 2026: the banner above the first request said "2 files
    // analyzed: 1 sorted into the items, 1 needs you. 1 check did not finish." for a
    // session of that morning, taken up because one of its files still waited for a
    // person, while the latest uploads had placed every file and the row said "Check on
    // hold". A session older than the control's latest says only its waiting files.
    it("an earlier session taken up for a waiting file says only that file", () => {
      const summary = (batchId: string, minutes: number, needs: number) => ({
        batchId,
        createdAt: CREATED + minutes * 60_000,
        createdBy: "Ryan James",
        chosenRequirementId: null,
        files: 2,
        inProgress: false,
        needsPerson: needs,
        notDesign: 0,
        finished: true,
        finishedAt: CREATED + minutes * 60_000 + 30_000,
      });
      const older = summary(uuid(70), 0, 1);
      const latest = summary(uuid(71), 600, 0);
      const list = [latest, older];
      // Taken up as before: a file of the older one still waits for a person.
      assert.equal(batchToShow(list, new Set())?.batchId, uuid(70));
      assert.equal(isEarlierSession(list, uuid(70)), true);
      assert.equal(isEarlierSession(list, uuid(71)), false);
      assert.equal(isEarlierSession(list, uuid(72)), false);
      // Its own batch as it stands: 1 placed, 1 waiting, its item's check failed.
      const raw = finishedBatch();
      const [first, second] = raw.files;
      const batch = batchOf({
        ...raw,
        files: [
          first,
          second
            ? {
                ...second,
                placement: {
                  ...second.placement,
                  status: "NEEDS_PERSON",
                  requirement_ids: [],
                },
              }
            : second,
        ],
        items: [
          {
            ...raw.items[0],
            file_ids: [F1],
            assurance: { ...POLICY_CHECK, status: "FAILED" },
          },
        ],
      });
      const progress = progressOf([], batch, NOW);
      assert.equal(progress.needs, 1);
      assert.equal(progress.failedChecks, 1);
      const shown = progressLine({
        progress,
        summary: older,
        seconds: 30,
        earlier: true,
      });
      assert.deepEqual(shown, {
        text: "1 file from an earlier upload is waiting to be placed. Added by Ryan James on Nov 13, 2026.",
        done: true,
        action: PLACE_FILES,
        tone: "warning",
      });
      // The latest session keeps its own full line.
      assert.match(
        progressLine({ progress, summary: older, seconds: 30 })?.text ?? "",
        /1 check did not finish\./,
      );
    });
  });

  it("finishes when every file is read and sorted and every item's check has ended", () => {
    const batch = batchOf(finishedBatch());
    const progress = progressOf([], batch, NOW);
    assert.deepEqual(
      progress.stages.map((stage) => [stage.state, stage.count, stage.flag]),
      // Design review, 17 November 2026 (one screen, one story): "Sorted" means placed or ruled out, so a file
      // that needs a person is not counted, and the stage waits on the person (amber,
      // "partial"). Old: ["done", "Sorted 7 of 7", "1 needs you"]; new: the row below.
      [
        ["done", "Secured 7 of 7", ""],
        ["done", "Read 7 of 7", ""],
        ["partial", "Sorted 6 of 7", "1 needs you"],
        ["done", "Checked 2 of 2 items", ""],
      ],
    );
    assert.equal(progress.done, true);
    assert.equal(pollDelay({ open: true, ...progress }), null);
    assert.equal(
      finishedNote(33, progress),
      "Finished in 0:33. 1 file needs you.",
    );
  });

  it("checks while an item's check is queued or at work, and polls at the check's pace", () => {
    const checking = batchOf(
      finishedBatch({
        items: [
          {
            ...finishedBatch().items[0],
            assurance: {
              ...POLICY_CHECK,
              status: "CHECKING",
              stage: "VERIFY",
              attributes: [],
            },
          },
          {
            ...finishedBatch().items[1],
            assurance: {
              ...REVIEW_CHECK,
              status: "QUEUED",
              stage: "GATE",
              attributes: [],
            },
          },
        ],
      }),
    );
    const progress = progressOf([], checking, NOW);
    assert.deepEqual(
      [
        progress.stages[3]?.state,
        progress.stages[3]?.count,
        progress.checking,
        progress.done,
      ],
      ["active", "Checked 0 of 2 items", true, false],
    );
    assert.equal(pollDelay({ open: true, ...progress }), 5000);
    assert.equal(pollDelay({ open: false, ...progress }), 10000);
    assert.equal(
      pollDelay({
        open: false,
        uploading: false,
        reading: false,
        checking: false,
      }),
      null,
    );
  });

  it("waits a minute for a check not queued yet after the last reading, then says it is not checked", () => {
    const fresh = batchOf(
      finishedBatch({
        items: [
          {
            ...finishedBatch().items[0],
            assurance: {
              ...POLICY_CHECK,
              status: "NOT_CHECKED",
              run_id: null,
              attributes: [],
            },
          },
        ],
      }),
    );
    assert.equal(progressOf([], fresh, CREATED + 20_000).checking, true);
    const later = progressOf([], fresh, CREATED + 14_000 + 61_000);
    assert.equal(later.checking, false);
    assert.equal(later.done, true);
    const [card] = itemCards(fresh, {
      items: ITEMS,
      attributes: ATTRIBUTES,
      now: CREATED + 75_000,
    });
    assert.deepEqual(card?.status, {
      text: "Not checked against the attributes yet",
      mode: "held",
    });
    assert.equal(card?.lanes, null);
  });

  it("measures the elapsed time on the server's clock, frozen once done", () => {
    const clock = serverClock(CREATED + 40_000, 1_000_000, 1_005_000);
    assert.equal(clock, CREATED + 45_000);
    // Without an answer yet, this browser's own clock.
    assert.equal(serverClock(null, null, 123), 123);
    assert.equal(
      elapsedSeconds({
        createdAt: CREATED,
        now: clock,
        done: false,
        finished: null,
        startedAt: null,
      }),
      45,
    );
    const batch = batchOf(finishedBatch());
    assert.equal(finishedAt(batch), CREATED + 33_000);
    assert.equal(
      elapsedSeconds({
        createdAt: CREATED,
        now: clock,
        done: true,
        finished: finishedAt(batch),
        startedAt: null,
      }),
      33,
    );
    // Before the server has the batch: since this browser started it.
    assert.equal(
      elapsedSeconds({
        createdAt: null,
        now: 50_000,
        done: false,
        finished: null,
        startedAt: 8_000,
      }),
      42,
    );
    assert.equal(formatElapsed(42), "0:42");
    assert.equal(formatElapsed(725), "12:05");
    assert.equal(formatElapsed(3723), "1:02:03");
    assert.equal(formatElapsed(-5), "0:00");
  });

  it("measures a session taken up again from its files' reading, not the batch's creation (E1 design review, round 10)", () => {
    // Created 1 h 28 min before its files were read in about half a minute.
    const resumed = batchOf(finishedBatch({ created_at: at(-5280) }));
    assert.equal(firstRead(resumed), CREATED + 2_000);
    const taken = elapsedSeconds({
      createdAt: resumed.createdAt,
      now: CREATED + 9_000_000,
      done: true,
      finished: finishedAt(resumed),
      startedAt: null,
      firstRead: firstRead(resumed),
    });
    assert.equal(formatDuration(taken), "31 s");
    // Files this page added start the clock where it added the first of them.
    assert.equal(
      elapsedSeconds({
        createdAt: resumed.createdAt,
        now: CREATED + 9_000_000,
        done: true,
        finished: finishedAt(resumed),
        startedAt: CREATED + 1_000,
        firstRead: firstRead(resumed),
      }),
      32,
    );
    assert.equal(firstRead(batchOf(finishedBatch({ files: [] }))), null);
    // Files dropped in again 12 minutes later, each read in seconds: the pause between
    // the two readings is not counted.
    const read = file().read;
    const later = batchOf(
      finishedBatch({
        created_at: at(-5280),
        files: [
          file(),
          file({
            file_id: F2,
            read: { ...read, started_at: at(722), finished_at: at(724) },
          }),
        ],
      }),
    );
    assert.deepEqual(idleGaps(later), [[CREATED + 9_000, CREATED + 722_000]]);
    assert.equal(
      elapsedSeconds({
        createdAt: later.createdAt,
        now: CREATED + 9_000_000,
        done: true,
        finished: finishedAt(later),
        startedAt: null,
        firstRead: firstRead(later),
        idle: idleGaps(later),
      }),
      9,
    );
    // Readings that follow one another closely are one run of work.
    assert.deepEqual(idleGaps(resumed), []);
  });

  it("counts the files withdrawn from a session taken up again, once each (E1 final design review)", () => {
    // Taken up in a new page: none of its files are this browser's uploads.
    const two = batchOf(
      finishedBatch({ files: [file(), file({ file_id: F2 })] }),
    );
    const seen = seenFiles(null, two);
    assert.equal(seenFiles(seen, two), seen);
    const empty = batchOf(finishedBatch({ files: [] }));
    assert.equal(withdrawnCount([], empty, null, seen), 2);
    // Before: "No file has been added yet." after the last file was withdrawn.
    assert.equal(
      resultsSummary(empty, [], progressOf([], empty, NOW), 2).lead,
      "No files left in this upload · 2 withdrawn",
    );
    // This browser's own upload of one of them is not counted twice.
    const mine = upload({ state: "stored", fileId: F1 });
    assert.equal(withdrawnCount([mine], empty, null, seen), 2);
    // Another session's files say nothing of this one.
    assert.equal(
      withdrawnCount([], empty, null, { batchId: "other", ids: new Set([F1]) }),
      0,
    );
  });

  it("estimates plainly by the number of files", () => {
    assert.equal(estimateText(1), "Usually 1 to 3 minutes for 1 file");
    assert.equal(estimateText(7), "Usually 2 to 4 minutes for 7 files");
    assert.equal(estimateText(12), "Usually 3 to 6 minutes for 12 files");
  });

  it("announces a stage change, not the clock", () => {
    const before = progressOf(
      [],
      batchOf(
        finishedBatch({
          items: [
            {
              ...finishedBatch().items[0],
              assurance: {
                ...POLICY_CHECK,
                status: "CHECKING",
                stage: "ASSESS",
                attributes: [],
              },
            },
          ],
        }),
      ),
      NOW,
    );
    const after = progressOf([], batchOf(finishedBatch()), NOW);
    assert.equal(announcement(null, after), null);
    assert.equal(announcement(after, after), null);
    assert.equal(
      announcement(before, after),
      "Analysis finished. The results are ready.",
    );
  });
});

describe("step 2: each item's two readings, drawn from the check's real stage", () => {
  const stageOf = (status: string, stage: string) =>
    itemCards(
      batchOf(
        finishedBatch({
          items: [
            {
              ...finishedBatch().items[1],
              assurance: {
                ...REVIEW_CHECK,
                status,
                stage,
                attributes:
                  status === "REVIEWED" ? REVIEW_CHECK.attributes : [],
              },
            },
          ],
        }),
      ),
      { items: ITEMS, attributes: ATTRIBUTES, now: NOW },
    )[0];
  const lanes = (status: string, stage: string) => {
    const card = stageOf(status, stage);
    return card?.lanes === null || card?.lanes === undefined
      ? null
      : [card.lanes.first, card.lanes.second, card.lanes.compare].map(
          (lane) => `${lane.state}:${lane.text}`,
        );
  };

  it("runs the first reading, then the second, then the comparison, one after the other", () => {
    assert.deepEqual(lanes("QUEUED", "GATE"), [
      "wait:Waiting",
      "wait:After the first reading",
      "wait:After both readings",
    ]);
    assert.deepEqual(lanes("CHECKING", "GATE"), [
      "wait:Starting",
      "wait:After the first reading",
      "wait:After both readings",
    ]);
    assert.deepEqual(lanes("CHECKING", "ASSESS"), [
      "active:Reading",
      "wait:After the first reading",
      "wait:After both readings",
    ]);
    assert.deepEqual(lanes("CHECKING", "VERIFY"), [
      "done:Done",
      "active:Reading",
      "wait:After both readings",
    ]);
    assert.deepEqual(lanes("CHECKING", "COMPARE"), [
      "done:Done",
      "done:Done",
      "active:Comparing",
    ]);
    assert.deepEqual(lanes("REVIEWED", "DONE"), [
      "done:Done",
      "done:Done",
      "done:Done",
    ]);
    // A stage it does not know: at work, without saying which reading.
    assert.equal(lanes("CHECKING", "TELEPORT"), null);
    assert.deepEqual(stageOf("CHECKING", "TELEPORT")?.status, {
      text: "Checking against attributes A to F",
      mode: "on",
    });
  });

  it("says what an item's check waits for: its own files, then the batch's other files (the server queues the checks once the last is read)", () => {
    const waiting = (files: unknown[]) =>
      itemCards(
        batchOf({
          batch_id: BATCH,
          files,
          items: [
            {
              ...finishedBatch().items[0],
              assurance: {
                ...POLICY_CHECK,
                status: "NOT_CHECKED",
                run_id: null,
                attributes: [],
              },
            },
          ],
        }),
        { items: ITEMS, attributes: ATTRIBUTES, now: NOW },
      )[0]?.status;
    const reading = file({
      file_id: F2,
      read: { status: "WORKING", started_at: at(30) },
      classification: null,
      placement: { status: "PENDING" },
    });
    assert.deepEqual(
      waiting([
        file({
          read: { status: "WORKING", started_at: at(30) },
          classification: null,
          placement: { status: "PENDING" },
        }),
      ]),
      {
        text: "Waiting for its files to be read",
        mode: "wait",
      },
    );
    assert.deepEqual(waiting([file(), reading]), {
      text: "Waiting for the other files to be read",
      mode: "wait",
    });
    // However long ago its own file was read: another still being read holds the check.
    const longAgo = itemCards(
      batchOf({
        batch_id: BATCH,
        files: [file(), reading],
        items: [
          {
            ...finishedBatch().items[0],
            assurance: {
              ...POLICY_CHECK,
              status: "NOT_CHECKED",
              run_id: null,
              attributes: [],
            },
          },
        ],
      }),
      { items: ITEMS, attributes: ATTRIBUTES, now: CREATED + 600_000 },
    )[0]?.status.text;
    assert.equal(longAgo, "Waiting for the other files to be read");
    assert.deepEqual(
      waiting([file({ read: { status: "READY", finished_at: at(38) } })]),
      {
        text: "Waiting to start the check",
        mode: "wait",
      },
    );
  });

  it("names the item's files and its results once reviewed", () => {
    const [policy, review] = itemCards(batchOf(finishedBatch()), {
      items: ITEMS,
      attributes: ATTRIBUTES,
      now: NOW,
    });
    assert.equal(policy?.count, "1 file");
    assert.deepEqual(policy?.status, {
      text: "Checked against attributes B to F",
      mode: "done",
    });
    assert.deepEqual(
      policy?.tally.map((group) => group.text),
      ["Supported: B C D E", "Not satisfied: F"],
    );
    assert.deepEqual(review?.fileNames, [
      "Q2-2026 SAP user listing.xlsx",
      "Q2 review sign-off - J Morales.pdf",
      "SNOW change tickets Q2.pdf",
      "SAP SUIM change log Jul-2026.csv",
    ]);
    assert.deepEqual(
      review?.tally.map((group) => group.text),
      ["Supported: A B C D", "Not satisfied: E", "Your judgment: F"],
    );
  });

  it("says a held item's reason and a failed check's note, with no lanes", () => {
    const heldOn = (held: unknown) =>
      itemCards(
        batchOf(
          finishedBatch({
            items: [
              {
                ...finishedBatch().items[1],
                assurance: {
                  ...REVIEW_CHECK,
                  status: "HELD",
                  stage: "GATE",
                  held,
                  attributes: [],
                },
              },
            ],
          }),
        ),
        { items: ITEMS, attributes: ATTRIBUTES, now: NOW },
      )[0];
    // The list's sentence for the gate's code where the gate sent none of its own.
    const held = heldOn({ code: "KIND_UNSURE", reason: "" });
    assert.equal(held?.status.mode, "held");
    assert.equal(
      held?.status.text,
      "The file's type is not confirmed, so the evidence has not been checked against the attributes.",
    );
    assert.equal(held?.lanes, null);
    // The gate's own sentence where it sent one; a code it does not know, cautiously.
    assert.equal(
      heldOn({
        code: "CUSTODY",
        reason: "The custody check found the file was changed after upload",
      })?.status.text,
      "The custody check found the file was changed after upload.",
    );
    assert.equal(stageOf("HELD", "GATE")?.status.text, "The check is on hold.");
    const failed = itemCards(
      batchOf(
        finishedBatch({
          items: [
            {
              ...finishedBatch().items[1],
              assurance: {
                ...REVIEW_CHECK,
                status: "FAILED",
                stage: "VERIFY",
                attributes: [],
                note: "The second reading ran out of time",
              },
            },
          ],
        }),
      ),
      { items: ITEMS, attributes: ATTRIBUTES, now: NOW },
    )[0];
    assert.deepEqual(failed?.status, {
      text: "The check did not finish, so nothing of it is shown. The second reading ran out of time.",
      mode: "failed",
    });
    assert.equal(failed?.lanes, null);
  });
});

describe("step 3: the results", () => {
  const results = (value = finishedBatch(), previous = {}) => {
    const batch = batchOf(value);
    return {
      batch,
      items: itemResults(batch, {
        items: ITEMS,
        attributes: ATTRIBUTES,
        now: NOW,
        previous,
      }),
      progress: progressOf([], batch, NOW),
    };
  };

  it("leads with one sentence, then a line per state naming its item", () => {
    const { batch, items, progress } = results();
    assert.deepEqual(resultsSummary(batch, items, progress), {
      lead: "5 of 7 files sorted into 2 items. 1 file needs you; 1 is not D&I evidence.",
      lines: [
        {
          key: "SUPPORTED",
          tone: "success",
          icon: "checkCircle",
          label: "Supported",
          text: "B, C, D, E (design) and A, B, C, D (implementation).",
        },
        {
          key: "NOT_SATISFIED",
          tone: "danger",
          icon: "xCircle",
          label: "Not satisfied",
          text: "F on Access review policy and designated owners list, E on One completed quarterly review, start to finish.",
        },
        {
          key: "JUDGMENT",
          tone: "warning",
          icon: "help",
          label: "Your judgment",
          text: "F on One completed quarterly review, start to finish.",
        },
      ],
    });
    assert.equal(
      resultsNote(progress),
      "2 items checked by two readings · 1 file needs you. Nothing is accepted until you accept it.",
    );
    // E1 final design review: an item accepted meanwhile (its card reads "Accepted by
    // ...") opens the note with the count, and the note never says nothing is accepted.
    assert.equal(
      resultsNote(progress, 1),
      "1 item accepted · 2 items checked by two readings · 1 file needs you.",
    );
    assert.equal(
      resultsNote({ ...progress, checked: 0, needs: 0 }, 2),
      "2 items accepted.",
    );
  });

  it("words each attribute with its mark: supported by design or implementation, not satisfied with its passage or what is missing, both readings where they differ", () => {
    const { items } = results();
    const [policy, review] = items;
    assert.deepEqual(
      policy?.attributes.map((row) => [row.letter, row.label, row.icon]),
      [
        ["B", "Supported (design)", "checkCircle"],
        ["C", "Supported (design)", "checkCircle"],
        ["D", "Supported (design)", "checkCircle"],
        ["E", "Supported (design)", "checkCircle"],
        ["F", "Not satisfied", "xCircle"],
      ],
    );
    const missing = policy?.attributes.find((row) => row.letter === "F");
    assert.deepEqual(missing?.missing, [
      "A step to find out whether access found inappropriate was used for unauthorized activity.",
    ]);
    assert.equal(
      missing?.reason,
      "The policy does not require access found inappropriate to be investigated.",
    );
    const late = review?.attributes.find((row) => row.letter === "E");
    assert.deepEqual(late?.quotes, [
      {
        quote: "2026-08-10 16:42:07, JMORALES, Lock user, RITM0048391",
        fileId: F5,
        fileName: "SAP SUIM change log Jul-2026.csv",
        location: "Line 418",
        page: null,
        opens: true,
      },
    ]);
    const judged = review?.attributes.find((row) => row.letter === "F");
    assert.equal(judged?.label, "Your judgment needed");
    assert.equal(
      judged?.reason,
      "The two readings do not agree. Your judgment is needed.",
    );
    assert.deepEqual(
      judged?.readings.map((reading) => [
        reading.who,
        reading.result,
        reading.met,
      ]),
      [
        ["First reading", "Met", "met"],
        ["Second reading, without seeing the first", "Not met", "not"],
      ],
    );
    assert.equal(judged?.quotes.length, 0);
    assert.equal(
      review?.sub,
      "Walkthrough instance · Implementation · 4 files",
    );
    assert.deepEqual(
      policy?.tally.map((group) => group.text),
      ["4 supported", "1 not satisfied"],
    );
  });

  it("shows both readings for an issue too when the server sends one from each (a split shortfall)", () => {
    const split = {
      ...REVIEW_CHECK,
      attributes: REVIEW_CHECK.attributes.map((item) =>
        item.code === "E"
          ? {
              ...item,
              result: "PARTLY_MET",
              views: [
                {
                  role: "ASSESSOR",
                  result: "NOT_MET",
                  reason: "the changes were late",
                },
                {
                  role: "REVIEWER",
                  result: "PARTLY_MET",
                  reason: "Most changes were on time.",
                },
              ],
            }
          : item,
      ),
    };
    const { items } = results(
      finishedBatch({
        items: [{ ...finishedBatch().items[1], assurance: split }],
      }),
    );
    const row = items[0]?.attributes.find((item) => item.letter === "E");
    assert.equal(row?.label, "Not satisfied");
    assert.deepEqual(
      row?.readings.map((reading) => [
        reading.result,
        reading.met,
        reading.reason,
      ]),
      [
        ["Not met", "not", "The changes were late."],
        ["Met in part", "part", "Most changes were on time."],
      ],
    );
  });

  it("says each letter of an item is not checked, with why, where its check did not end with results", () => {
    const held = results(
      finishedBatch({
        items: [
          {
            ...finishedBatch().items[1],
            assurance: {
              ...REVIEW_CHECK,
              status: "HELD",
              held: { code: "KIND_UNSURE", reason: "" },
              attributes: [],
            },
          },
        ],
      }),
    );
    const [item] = held.items;
    assert.deepEqual(
      item?.attributes.map((row) => [row.letter, row.label]),
      [
        ["A", "Not checked"],
        ["B", "Not checked"],
        ["C", "Not checked"],
        ["D", "Not checked"],
        ["E", "Not checked"],
        ["F", "Not checked"],
      ],
    );
    assert.deepEqual(item?.hold, {
      text: "The file's type is not confirmed, so the evidence has not been checked against the attributes.",
      short: "on hold",
      rerun: null,
    });
    assert.equal(
      resultsSummary(held.batch, held.items, held.progress).lines.at(-1)?.text,
      "One completed quarterly review, start to finish (on hold).",
    );
    const failed = results(
      finishedBatch({
        items: [
          {
            ...finishedBatch().items[1],
            assurance: {
              ...REVIEW_CHECK,
              status: "FAILED",
              attributes: [],
              note: "",
            },
          },
        ],
      }),
    );
    assert.deepEqual(failed.items[0]?.hold, {
      text: "The check did not finish, so nothing of it is shown.",
      short: "the check did not finish",
      rerun: "Check again",
    });
    const notChecked = results(
      finishedBatch({
        items: [
          {
            ...finishedBatch().items[1],
            assurance: {
              ...REVIEW_CHECK,
              status: "NOT_CHECKED",
              run_id: null,
              attributes: [],
            },
          },
        ],
      }),
    );
    // Long after its last file was read: not coming by itself.
    const later = itemResults(notChecked.batch, {
      items: ITEMS,
      attributes: ATTRIBUTES,
      now: CREATED + 600_000,
    });
    assert.deepEqual(later[0]?.hold, {
      text: "Not checked against the attributes yet.",
      short: "not checked yet",
      rerun: "Check now",
    });
    assert.equal(later[0]?.accept.state, "open");
    assert.match(
      later[0]?.accept.note ?? "",
      /accepting marks no attribute as evidenced/,
    );
  });

  it("leads an item with its review: the proposed outcome, why, and what to ask for", () => {
    // An item whose check is the first engine's has no review, and reads as it did.
    assert.deepEqual(
      results().items.map((item) => item.review),
      [null, null],
    );
    const base = finishedBatch();
    const reviewed = (review: unknown, over: Record<string, unknown> = {}) =>
      results(
        finishedBatch({
          items: [
            {
              ...base.items[0],
              assurance: {
                ...POLICY_CHECK,
                engine_version: 2,
                attributes: POLICY_CHECK.attributes.map((item) => ({
                  ...item,
                  assessment:
                    item.verdict === "SUPPORTED"
                      ? "SATISFIED"
                      : "NOT_DEMONSTRATED",
                  checks: [],
                })),
                review,
                ...over,
              },
            },
            base.items[1],
          ],
        }),
      ).items;
    const review = {
      overall: "ADDITIONAL_EVIDENCE",
      explanation:
        "4 of 5 requested attributes are supported. F is not demonstrated: the policy has no investigation step.",
      completeness: { state: "COMPLETE", reasons: [] },
      context_thin: false,
      files: [],
      confirmations: [],
      concerns: [],
      follow_ups: [
        {
          key: `${F}:pass`,
          attribute_ids: [F],
          codes: ["F"],
          elements: ["pass"],
          missing: "The investigation step.",
          why: "Nothing shows inappropriate access is followed up.",
          request:
            "Provide the procedure for investigating access found inappropriate.",
          alternatives: "",
          kind: "EVIDENCE",
          priority: "HIGH",
          raised_by: ["ASSESSOR"],
          status: "OPEN",
        },
      ],
      follow_ups_more: 1,
      follow_ups_dropped: 0,
      resolved: [],
      considerations: [],
    };
    const [policy, other] = reviewed(review);
    assert.deepEqual(policy?.review, {
      label: "Additional evidence needed",
      icon: "plus",
      tone: "warning",
      explanation:
        "4 of 5 requested attributes are supported. F is not demonstrated: the policy has no investigation step.",
      followUps: [
        {
          key: `${F}:pass`,
          request:
            "Provide the procedure for investigating access found inappropriate.",
        },
      ],
      more: "1 more follow-up is not listed here.",
    });
    // The other item, and everything else of this one, is as it was.
    assert.equal(other?.review, null);
    const [before] = results().items;
    assert.deepEqual(policy?.attributes, before?.attributes);
    assert.deepEqual(policy?.tally, before?.tally);
    assert.deepEqual(policy?.accept, before?.accept);
    // Sufficient evidence lists nothing to ask for.
    const [sufficient] = reviewed(
      {
        ...review,
        overall: "SUFFICIENT",
        explanation: "",
        follow_ups: [],
        follow_ups_more: 0,
      },
      {
        attributes: POLICY_CHECK.attributes
          .filter((item) => item.verdict === "SUPPORTED")
          .map((item) => ({ ...item, assessment: "SATISFIED", checks: [] })),
      },
    );
    assert.equal(sufficient?.review?.label, "Sufficient evidence");
    assert.deepEqual(sufficient?.review?.followUps, []);
    assert.equal(sufficient?.review?.more, "");
    // No review while the check runs again, and none for a review that is not one.
    assert.equal(
      reviewed(review, { status: "CHECKING", stage: "ASSESS" })[0]?.review,
      null,
    );
    assert.equal(reviewed("SUFFICIENT")[0]?.review, null);
    assert.equal(reviewed(review, { engine_version: 1 })[0]?.review, null);
  });

  it("shows what a check found before, marked, while it runs again after a move", () => {
    const previous = { [REVIEW]: batchOf(finishedBatch()).items[1]?.check };
    const rerun = results(
      finishedBatch({
        items: [
          {
            ...finishedBatch().items[1],
            assurance: {
              ...REVIEW_CHECK,
              status: "QUEUED",
              stage: "GATE",
              attributes: [],
            },
          },
        ],
      }),
      previous,
    );
    const [item] = rerun.items;
    assert.equal(item?.rechecking, true);
    assert.equal(item?.hold, null);
    assert.equal(
      item?.attributes.find((row) => row.letter === "A")?.label,
      "Supported (implementation)",
    );
    assert.deepEqual(item?.accept, {
      state: "waiting",
      note: "Checking again. You can accept once the check finishes.",
    });
  });

  it("says what accepting marks as evidenced, in the list's words, and an accepted item as accepted", () => {
    const { items } = results();
    assert.equal(items[0]?.accept.state, "open");
    assert.equal(
      items[0]?.accept.note,
      "Accepting marks no attribute as evidenced: the two readings find no record of an instance that shows one. B to E: design documented, implementation not yet shown. Both readings found an issue on F. You can still accept; accepting does not settle these.",
    );
    assert.equal(
      items[1]?.accept.note,
      "Accepting marks attributes A to D as evidenced. Both readings found an issue on E. Your judgment is needed on F. You can still accept; accepting does not settle these.",
    );
    const accepted = itemResults(batchOf(finishedBatch()), {
      items: ITEMS.map((item) =>
        item.requirementId === POLICY
          ? { ...item, accepted: true, acceptedBy: "Daniel Osei" }
          : item,
      ),
      attributes: ATTRIBUTES,
      now: NOW,
    });
    assert.deepEqual(accepted[0]?.accept, {
      state: "accepted",
      note: "Accepted by Daniel Osei.",
    });
  });

  it("names the attributes each file addresses, once its item's check is reviewed", () => {
    const batch = batchOf(finishedBatch());
    const byId = (id: string) =>
      batch.files.find((item) => item.fileId === id) ?? null;
    assert.deepEqual(addressesLine(byId(F1), batch), {
      kind: "letters",
      letters: ["B", "C", "D", "E"],
      spoken: "B (supported), C (supported), D (supported) and E (supported)",
    });
    assert.deepEqual(addressesLine(byId(F5), batch), {
      kind: "letters",
      letters: ["E"],
      spoken: "E (not satisfied)",
    });
    const checking = batchOf(
      finishedBatch({
        items: [
          {
            ...finishedBatch().items[0],
            assurance: { ...POLICY_CHECK, status: "CHECKING", attributes: [] },
          },
        ],
      }),
    );
    assert.deepEqual(addressesLine(checking.files[0] ?? null, checking), {
      kind: "later",
    });
    const none = batchOf(finishedBatch({ files: [file({ addresses: [] })] }));
    assert.deepEqual(addressesLine(none.files[0] ?? null, none), {
      kind: "none",
    });
  });

  it("sets apart the files a person must place, those not D&I evidence, and those not added", () => {
    const batch = batchOf(finishedBatch());
    const apart = filesApart(
      fileLines(
        [upload({ key: "u9", name: "Big.zip", state: "refused", detail: "x" })],
        batch,
        facts(),
      ),
    );
    // Design review round 2, 17 November 2026: the files not added have their own section ("1 not added"),
    // and "not in an item" counts only the files in the control. Old: [Scan, photo,
    // Big.zip] and "3 files are not in an item"; new: the two files in the control.
    assert.deepEqual(
      apart.map((line) => line.name),
      ["Scan_0042.pdf", "Team offsite photo.jpg"],
    );
    assert.equal(apartTitle(apart.length), "2 files are not in an item");
    assert.equal(apartTitle(1), "1 file is not in an item");
    const out = filesNotAdded(
      fileLines(
        [upload({ key: "u9", name: "Big.zip", state: "refused", detail: "x" })],
        batch,
        facts(),
      ),
    );
    assert.deepEqual(
      out.map((line) => line.name),
      ["Big.zip"],
    );
    assert.equal(notAddedTitle(out.length), "1 not added");
  });

  it("says a batch where nothing could be placed plainly", () => {
    const nothing = batchOf({
      batch_id: BATCH,
      created_at: at(0),
      server_now: at(30),
      files: [
        finishedBatch().files[5],
        finishedBatch().files[6],
        file({
          file_id: F1,
          placement: {
            status: "NEEDS_PERSON",
            method: "AGENT",
            requirement_ids: [],
            reason:
              "The reader found it covers several items in part, and no one item stands out. Choose where it goes.",
            suggestions: [],
            version: 1,
          },
        }),
      ],
      items: [],
    });
    const progress = progressOf([], nothing, CREATED + 30_000);
    assert.equal(progress.done, true);
    // Design review, 17 November 2026 (one screen, one story): with files waiting for a person, the check
    // waits for them rather than being ticked. Old: "No item to check", done; new:
    // waiting, "Waiting for 2 files to be placed".
    assert.equal(progress.stages[3]?.count, "Waiting for 2 files to be placed");
    assert.equal(progress.stages[3]?.state, "wait");
    const summary = resultsSummary(nothing, [], progress);
    assert.equal(
      summary.lead,
      "None of the 3 files could be sorted into an item. 2 files need you; 1 is not D&I evidence.",
    );
    assert.deepEqual(summary.lines, []);
    assert.equal(
      itemCards(nothing, { items: ITEMS, attributes: ATTRIBUTES, now: NOW })
        .length,
      0,
    );
    assert.equal(
      resultsSummary(
        null,
        [],
        progressOf([upload({ state: "refused" })], null, NOW),
      ).lead,
      // Design review round 2, 17 November 2026: the same sentence as the footer. Old: "No file was added. 1
      // file could not be added: each says why."
      // 18 November 2026, design review round 3: the closing sentence was "Its row gives the
      // reason." / "Each row gives the reason."; it is now "The list shows why.", because the
      // reason of several files withdrawn from one control sits in one group note, not on each row.
      "The file was not added. The list shows why.",
    );
  });
});

describe("a row's batch: the person's choice stands, the agent only suggests", () => {
  const rowBatch = () =>
    batchOf({
      batch_id: BATCH,
      chosen_requirement_id: REVIEW,
      created_at: at(0),
      server_now: at(20),
      files: [
        file({
          placement: {
            status: "PLACED",
            method: "PERSON",
            requirement_ids: [REVIEW],
            reason: "Added on this item by a person.",
            suggestions: [
              {
                requirement_id: POLICY,
                title: "Access review policy and designated owners list",
                reason:
                  "This looks like a policy or procedure. Move it to “Access review policy and designated owners list”?",
              },
            ],
            version: 1,
          },
        }),
      ],
      items: [
        {
          ...finishedBatch().items[1],
          file_ids: [F1],
          assurance: { ...REVIEW_CHECK, status: "QUEUED", attributes: [] },
        },
      ],
    });

  it("files a row's upload on its item at once, and says the reader's better fit as a suggestion", () => {
    const batch = rowBatch();
    const [line] = fileLines([], batch, facts({ chosenRequirementId: REVIEW }));
    assert.deepEqual(line?.dest, {
      kind: "placed",
      titles: ["One completed quarterly review, start to finish"],
      note: "your choice",
    });
    assert.deepEqual(line?.suggestion, {
      requirementId: POLICY,
      text: "This looks like a policy or procedure. Move it to “Access review policy and designated owners list”?",
    });
    // Seen from another browser: the row's choice, not "yours".
    const elsewhere = fileLines(
      [],
      batch,
      facts({ chosenRequirementId: REVIEW, mine: false }),
    )[0]?.dest;
    assert.deepEqual(elsewhere, {
      kind: "placed",
      titles: ["One completed quarterly review, start to finish"],
      note: "chosen on its row",
    });
    // "Leave it" puts the suggestion away; nothing moves.
    assert.equal(
      fileLines(
        [],
        batch,
        facts({ chosenRequirementId: REVIEW, leftAlone: new Set([F1]) }),
      )[0]?.suggestion,
      null,
    );
  });

  it("follows a file moved elsewhere: worded from the latest answer, a new version, no suggestion", () => {
    const moved = batchOf({
      ...rowBatch(),
      batch_id: BATCH,
      chosen_requirement_id: REVIEW,
      files: [
        file({
          placement: {
            status: "PLACED",
            method: "PERSON",
            requirement_ids: [POLICY],
            reason: "Placed by a person.",
            suggestions: [],
            version: 2,
          },
        }),
      ],
    });
    const [line] = fileLines([], moved, facts({ chosenRequirementId: REVIEW }));
    assert.deepEqual(line?.dest, {
      kind: "placed",
      titles: ["Access review policy and designated owners list"],
      note: "placed by a person",
    });
    assert.equal(line?.version, 2);
    assert.deepEqual(line?.on, [POLICY]);
    assert.equal(line?.suggestion, null);
  });
});

describe("the list's line and the session remembered here", () => {
  it("says where the session stands, then what came of it", () => {
    const running = progressOf(
      [],
      batchOf(
        finishedBatch({
          items: [
            {
              ...finishedBatch().items[0],
              assurance: {
                ...POLICY_CHECK,
                status: "CHECKING",
                stage: "ASSESS",
                attributes: [],
              },
            },
          ],
        }),
      ),
      NOW,
    );
    // Changed 18 November 2026 (E1 design review, round 5: one verb on the D&I Evidence
    // step). Old: "Analyzing 7 files · …" and "7 files analyzed: …". New: "Reading 7
    // files · …" and "7 files read: …".
    assert.deepEqual(
      progressLine({ progress: running, summary: null, seconds: 42 }),
      // Design review, 17 November 2026 (one screen, one story): every line carries its tone. Old: text,
      // done, action; new: the same, with `tone`.
      {
        text: "Reading 7 files · Checking 1 item against the attributes · 0:42",
        done: false,
        action: "Show progress",
        tone: "working",
      },
    );
    const reading = progressOf(
      [],
      batchOf({
        batch_id: BATCH,
        files: [
          file(),
          file({
            file_id: F2,
            read: { status: "WORKING" },
            classification: null,
            placement: { status: "PENDING" },
          }),
        ],
      }),
      NOW,
    );
    assert.equal(
      progressLine({ progress: reading, summary: null, seconds: 9 })?.text,
      "Reading 2 files · Read 1 of 2 · 0:09",
    );
    const done = progressOf([], batchOf(finishedBatch()), NOW);
    assert.deepEqual(
      progressLine({ progress: done, summary: null, seconds: 33 }),
      {
        text: "7 files read: 5 sorted into the items, 1 needs you.",
        done: true,
        action: "See results",
        // A file waits for a person: amber, never green.
        tone: "warning",
      },
    );
    // Reopened from the server's list, its state not read yet.
    assert.deepEqual(
      progressLine({
        progress: null,
        summary: {
          batchId: BATCH,
          createdAt: CREATED,
          createdBy: "Ryan James",
          chosenRequirementId: null,
          files: 7,
          inProgress: false,
          needsPerson: 1,
          notDesign: 1,
          finished: true,
          finishedAt: CREATED + 33_000,
        },
        seconds: 33,
      }),
      {
        text: "7 files read: 1 needs you. Added by Ryan James.",
        done: true,
        action: "See results",
        tone: "warning",
      },
    );
    // Reopened from the list before its state is read, with no file at work but not
    // finished (its items may still be checked): in progress, never "analyzed".
    const unfinished = progressLine({
      progress: null,
      summary: {
        batchId: BATCH,
        createdAt: CREATED,
        createdBy: "Ryan James",
        chosenRequirementId: null,
        files: 7,
        inProgress: false,
        needsPerson: 0,
        notDesign: 0,
        finished: false,
        finishedAt: null,
      },
      seconds: 20,
    });
    assert.equal(unfinished?.done, false);
    assert.equal(unfinished?.action, "Show progress");
    assert.doesNotMatch(unfinished?.text ?? "", / files read/);
    assert.match(unfinished?.text ?? "", /^Reading 7 files/);
    assert.equal(
      progressLine({ progress: null, summary: null, seconds: 0 }),
      null,
    );
  });

  it("remembers the session as a hint, read defensively", () => {
    assert.equal(hintKey(CONTROL), `aw.evidence-wizard.${CONTROL}`);
    const hint = {
      batchId: BATCH,
      requirementId: REVIEW,
      dismissed: [uuid(90)],
    };
    assert.deepEqual(readHint(writeHint(hint)), hint);
    assert.equal(readHint(null), null);
    assert.equal(readHint("{not json"), null);
    assert.deepEqual(
      readHint(
        JSON.stringify({
          batch: "x",
          requirement: 4,
          dismissed: ["y", uuid(91)],
        }),
      ),
      {
        batchId: "",
        requirementId: null,
        dismissed: [uuid(91)],
      },
    );
  });
});

describe("the wording", () => {
  it("puts no internal code on screen, in any state", () => {
    const batch = batchOf(finishedBatch());
    const states = [
      batch,
      batchOf(
        finishedBatch({
          items: [
            {
              ...finishedBatch().items[0],
              assurance: {
                ...POLICY_CHECK,
                status: "HELD",
                held: { code: "POPULATION", reason: "" },
                attributes: [],
              },
            },
          ],
        }),
      ),
      batchOf(
        finishedBatch({
          items: [
            {
              ...finishedBatch().items[0],
              assurance: {
                ...POLICY_CHECK,
                status: "OUT_OF_DATE",
                out_of_date: ["A file was moved off it"],
                attributes: [],
              },
            },
          ],
        }),
      ),
      batchOf(
        finishedBatch({
          items: [
            {
              ...finishedBatch().items[0],
              assurance: {
                ...POLICY_CHECK,
                status: "CHECKING",
                stage: "COMPARE",
                attributes: [],
              },
            },
          ],
        }),
      ),
    ];
    const shown: string[] = [];
    for (const state of states) {
      const progress = progressOf(
        [
          upload({ state: "sending", sent: 5 }),
          upload({ key: "u2", state: "refused", detail: "No." }),
        ],
        state,
        NOW,
      );
      const lines = fileLines(
        [upload({ state: "sending", sent: 5 })],
        state,
        facts(),
      );
      const items = itemResults(state, {
        items: ITEMS,
        attributes: ATTRIBUTES,
        now: NOW,
      });
      shown.push(
        ...texts(progress.stages),
        ...texts(lines),
        ...texts(
          itemCards(state, { items: ITEMS, attributes: ATTRIBUTES, now: NOW }),
        ),
        ...texts(items),
        ...texts(resultsSummary(state, items, progress)),
        ...texts(progressLine({ progress, summary: null, seconds: 12 })),
      );
    }
    const offenders = shown.filter((text) => CODES.test(text));
    assert.deepEqual(offenders, []);
    assert.ok(shown.length > 100);
  });

  it("reads what a reading found as an auditor says it", () => {
    const rows = attributeRows(
      batchOf(finishedBatch()).items[1] as NonNullable<
        BatchState["items"][number]
      >,
      batchOf(finishedBatch()),
      {
        attributes: ATTRIBUTES,
        items: ITEMS,
      },
    );
    assert.deepEqual(
      rows.map((row) => row.wording.slice(0, 20)),
      [
        "The user listing the",
        "The review was signe",
        "The reviewer recorde",
        "Every removal or cha",
        "The review was compl",
        "Access found inappro",
      ],
    );
  });
});

// The joint review of the wizard with the server (13 November 2026): each decision on
// the server's own JSON (tests/fixtures/evidence-wizard, written by the server's tests).
describe("the joint review's decisions", () => {
  const fixture = (name: string): Record<string, unknown> =>
    JSON.parse(
      readFileSync(
        new URL(`./fixtures/evidence-wizard/${name}`, import.meta.url),
        "utf8",
      ),
    ) as Record<string, unknown>;
  const ids = fixture("ids.json") as {
    policy_item: string;
    walk_item: string;
    files: Record<string, string>;
  };
  const all = () =>
    fixture("batch-state-all.json") as Record<string, unknown> & {
      files: Array<Record<string, unknown>>;
      items: Array<Record<string, unknown>>;
    };
  const policyFile = ids.files.policy ?? "";
  const ticketFile = ids.files.ticket ?? "";

  it("2: each item card shows a file's letters from its own item's check, the file's own list only for a file on one item", () => {
    const raw = all();
    // The policy file on both items, each item's own map naming different letters.
    raw.files = raw.files.map((each) =>
      each.file_id === policyFile
        ? {
            ...each,
            placement: {
              ...(each.placement as Record<string, unknown>),
              requirement_ids: [ids.policy_item, ids.walk_item],
            },
          }
        : each,
    );
    raw.items = raw.items.map((item) => ({
      ...item,
      file_ids:
        item.requirement_id === ids.walk_item
          ? [...(item.file_ids as string[]), policyFile]
          : item.file_ids,
      addresses:
        item.requirement_id === ids.policy_item
          ? { [policyFile]: [{ code: "A", verdict: "SUPPORTED" }] }
          : {
              [policyFile]: [{ code: "B", verdict: "ISSUE" }],
              [ticketFile]: [{ code: "C", verdict: "SUPPORTED" }],
            },
    }));
    const batch = batchOf(raw);
    const policy =
      batch.files.find((each) => each.fileId === policyFile) ?? null;
    assert.deepEqual(addressesLine(policy, batch, ids.policy_item), {
      kind: "letters",
      letters: ["A"],
      spoken: "A (supported)",
    });
    assert.deepEqual(addressesLine(policy, batch, ids.walk_item), {
      kind: "letters",
      letters: ["B"],
      spoken: "B (not satisfied)",
    });
    // Without the map (an older server): the file's own list only on one item.
    const older = batchOf({
      ...raw,
      items: raw.items.map(({ addresses: _unused, ...item }) => item),
    });
    const onTwo =
      older.files.find((each) => each.fileId === policyFile) ?? null;
    assert.deepEqual(addressesLine(onTwo, older, ids.walk_item), {
      kind: "unknown",
    });
    const ticket =
      older.files.find((each) => each.fileId === ticketFile) ?? null;
    assert.equal(addressesLine(ticket, older, ids.walk_item).kind, "letters");
  });

  it("3: a file removed from this upload is gone once a batch read after it was stored leaves it out", () => {
    const batch = batchOf(fixture("batch-state-after-withdraw.json"));
    const minutes = ids.files.minutes ?? "";
    const stored = upload({
      key: "m",
      state: "stored",
      fileId: minutes,
      answeredAt: 1_000,
    });
    // A read that set out before the file was stored does not know it yet: arriving.
    assert.equal(goneFromBatch(stored, batch, 500), false);
    assert.equal(progressOf([stored], batch, NOW, 500).reading, true);
    // Read after it: gone, with no row and nothing held back.
    assert.equal(goneFromBatch(stored, batch, 2_000), true);
    assert.equal(
      fileLines([stored], batch, facts({ readAt: 2_000 })).some(
        (line) => line.fileId === minutes,
      ),
      false,
    );
    const reviewed = batchOf(fixture("batch-state-reviewed.json"));
    const after = {
      ...reviewed,
      files: reviewed.files.filter((each) => each.fileId !== minutes),
    };
    const finished = progressOf([stored], after, NOW + 600_000, 2_000);
    assert.equal(finished.done, true);
    assert.equal(pollDelay({ open: true, ...finished }), null);
  });

  it("1: an accepted item is no destination, and a refused move says the server's sentence", () => {
    const batch = batchOf(all());
    const notes = batch.files.find((each) => each.fileId === ids.files.notes);
    assert.ok(notes !== undefined);
    const items: WizardItem[] = batch.items.map((item) => ({
      requirementId: item.requirementId,
      title: item.title,
      kind: "Kind",
      icon: "file",
      shows: "",
      letters: item.letters,
      files: 1,
      choosable: item.requirementId !== ids.policy_item,
      accepted: item.requirementId === ids.policy_item,
      canAccept: false,
      acceptedBy: "",
      version: 1,
      held: [],
    }));
    assert.deepEqual(
      choicesFor(notes, items, batch).choices.map((choice) => choice.value),
      [ids.walk_item, OUT],
    );
    assert.equal(
      placementProblem(
        409,
        "the item's evidence is accepted, so its files stay as they are",
      ),
      "The item's evidence is accepted, so its files stay as they are.",
    );
  });

  it("6: offers the action a reason names (confirm the kind, read it again), and Choose for a duplicate that needs a person", () => {
    const batch = batchOf(all());
    const lines = fileLines([], batch, facts());
    const notes = lineOf(lines, ids.files.notes ?? "");
    const scan = lines.find((line) => line.name === "unreadable scan.txt");
    assert.equal(
      notes.dest?.kind === "needs" ? notes.dest.fix : null,
      "confirm-kind",
    );
    assert.equal(scan?.dest?.kind === "needs" ? scan.dest.fix : null, "reread");
    const policy = batch.files.find((each) => each.fileId === policyFile);
    assert.ok(policy !== undefined);
    assert.equal(needsFix(policy), null);
    const duplicate = batchOf(fixture("batch-state-duplicate-needs.json"));
    const [held] = fileLines([], duplicate, facts({ items: [] }));
    assert.equal(held?.duplicate, true);
    assert.equal(held?.movable, true);
    assert.equal(progressOf([], duplicate, NOW).needs, 1);
    // A duplicate placed already stays where it is.
    const placed = fileLines(
      [],
      batchOf(fixture("batch-state-duplicate.json")),
      facts({ items: [] }),
    );
    assert.equal(placed.find((line) => line.duplicate)?.movable, false);
    assert.equal(readingProblem(200), null);
    assert.equal(
      readingProblem(409, "the reading changed"),
      "The reading changed.",
    );
    assert.equal(
      readingProblem(422),
      "This file’s reading is not known here yet. Refresh the page and try again.",
    );
  });

  it("7: while an item is checked again, its counts and summary lines from before the change are not shown", () => {
    const reviewed = batchOf(fixture("batch-state-reviewed.json"));
    const previous = Object.fromEntries(
      reviewed.items.flatMap((item) =>
        item.check === null ? [] : [[item.requirementId, item.check]],
      ),
    );
    const raw = fixture("batch-state-reviewed.json") as Record<
      string,
      unknown
    > & {
      items: Array<Record<string, unknown>>;
    };
    raw.items = raw.items.map((item) =>
      item.requirement_id === ids.walk_item
        ? {
            ...item,
            assurance: {
              ...(item.assurance as Record<string, unknown>),
              status: "QUEUED",
              stage: "GATE",
              attributes: [],
            },
          }
        : item,
    );
    const batch = batchOf(raw);
    const results = itemResults(batch, {
      items: [],
      attributes: [],
      now: NOW,
      previous,
    });
    const walk = results.find((item) => item.requirementId === ids.walk_item);
    assert.equal(walk?.rechecking, true);
    assert.deepEqual(walk?.tally, []);
    const summary = resultsSummary(batch, results, progressOf([], batch, NOW));
    // The walkthrough's issue on B was from before the change: not said.
    assert.equal(
      summary.lines.find((line) => line.key === "NOT_SATISFIED"),
      undefined,
    );
    assert.match(
      summary.lines.find((line) => line.key === "NOT_CHECKED")?.text ?? "",
      /\(being checked again\)/,
    );
  });

  it("8: after three reads in a row that did not reach the server it says so and retries further apart; the open window is remembered", () => {
    assert.equal(UNREACHABLE_AFTER, 3);
    assert.equal(UNREACHABLE, "Can’t reach the server. Retrying.");
    assert.equal(retryDelay(2_000, 0), 2_000);
    assert.equal(retryDelay(2_000, 2), 2_000);
    assert.equal(retryDelay(2_000, 3), 4_000);
    assert.equal(retryDelay(2_000, 4), 8_000);
    assert.equal(retryDelay(2_000, 9), 30_000);
    // Nothing would be read again, yet a failed read keeps trying.
    assert.equal(retryDelay(null, 1), 2_000);
    assert.equal(retryDelay(null, 0), null);
    const hint = {
      batchId: BATCH,
      requirementId: null,
      dismissed: [],
      open: true as const,
    };
    assert.deepEqual(readHint(writeHint(hint)), hint);
    const view = readFileSync("apps/web/src/evidence-wizard.tsx", "utf8");
    assert.match(view, /hint\.open === true/);
    assert.match(view, /setReopenOnRead\(true\)/);
    assert.match(view, /status === 0 \|\| status >= 500 \? count \+ 1 : 0/);
  });

  it("13: the server's stage stands where a file left the control or its reading ended", () => {
    const raw = all();
    const policy = raw.files.find((each) => each.file_id === policyFile) ?? {};
    const out = batchOf({
      ...raw,
      files: [
        { ...policy, stage: "NOT_DESIGN" },
        {
          ...policy,
          file_id: uuid(80),
          stage: "SORTED",
          read: {
            ...(policy.read as Record<string, unknown>),
            status: "WORKING",
          },
        },
      ],
    });
    assert.equal(out.files[0]?.placement.status, "NOT_DESIGN");
    assert.deepEqual(out.files[0]?.placement.requirementIds, []);
    assert.equal(out.files[1]?.read.status, "READY");
  });

  it("13: the elapsed time never runs backwards, the list counts the items being checked exactly, and the comparison is drawn from COMPARE", () => {
    assert.equal(steadySeconds(null, 10, false), 10);
    assert.equal(steadySeconds(42, 40, false), 42);
    assert.equal(steadySeconds(42, 45, false), 45);
    assert.equal(steadySeconds(42, 33, true), 33);
    const running = batchOf(
      finishedBatch({
        items: [
          {
            ...finishedBatch().items[0],
            assurance: {
              ...POLICY_CHECK,
              status: "CHECKING",
              stage: "COMPARE",
              attributes: [],
            },
          },
          finishedBatch().items[1],
        ],
      }),
    );
    const progress = progressOf([], running, NOW);
    assert.equal(progress.checkingItems, 1);
    assert.equal(
      progressLine({ progress, summary: null, seconds: 30 })?.text,
      "Reading 7 files · Checking 1 item against the attributes · 0:30",
    );
    const [card] = itemCards(running, {
      items: ITEMS,
      attributes: ATTRIBUTES,
      now: NOW,
    });
    assert.deepEqual(card?.lanes?.compare, {
      state: "active",
      text: "Comparing",
    });
  });

  it("13: a move that leaves an item without evidence says it is asked for again in a new draft", () => {
    const batch = batchOf(fixture("batch-state-reviewed.json"));
    const items: WizardItem[] = [
      {
        requirementId: ids.policy_item,
        title: "Access management policy",
        kind: "",
        icon: "file",
        shows: "",
        letters: [],
        files: 1,
        choosable: true,
        accepted: false,
        canAccept: true,
        acceptedBy: "",
        version: 1,
        held: [{ id: policyFile, name: "access policy.txt" }],
      },
    ];
    // The policy was the policy item's only file.
    assert.deepEqual(
      leftWithout(policyFile, [ids.policy_item], [ids.walk_item], items, batch),
      [ids.policy_item],
    );
    // The ticket leaves the walkthrough with its change log: not empty.
    assert.deepEqual(
      leftWithout(ticketFile, [ids.walk_item], [], items, batch),
      [],
    );
    assert.equal(askedAgain(1), ASKED_AGAIN);
    assert.equal(
      ASKED_AGAIN,
      "That item is asked for again in a new draft, which needs approval before it is sent.",
    );
    assert.equal(askedAgain(0), "");
    const view = readFileSync("apps/web/src/evidence-wizard.tsx", "utf8");
    assert.match(view, /askedAgain\(emptied\)/);
  });

  it("13: Cancel, Close or Escape on Add files with files queued asks before dropping them", () => {
    const view = readFileSync("apps/web/src/evidence-wizard.tsx", "utf8");
    assert.match(view, /function requestClose\(\)/);
    assert.match(
      view,
      /Drop the \$\{plural\(view\.queued, "file"\)\} queued\?/,
    );
    assert.match(
      view,
      /if \(wizard\.queued > 0\) \{\s*event\.preventDefault\(\);/,
    );
    assert.equal(
      (view.match(/onClick=\{wizard\.requestClose\}/g) ?? []).length,
      2,
    );
  });
});

// Restore and read (product owner, 17 November 2026). The owner withdrew screenshots
// from ITGC-AC-01, dropped the same files into Add evidence to have them read again, and
// every row was refused with no way to the withdrawn files, while the Analyze step showed
// a done tick on Secure ("Secured 0 of 9"), "Finished in 0:00" in green and "See results".
// Now a file withdrawn from the control is restored and read as a file added now; one
// withdrawn from another control links to the withdrawn files; and the stages, the
// finished line and the footer tell one story.
describe("restore and read: a withdrawn file dropped again, and one story when files are not added", () => {
  const withdrawnElsewhere =
    "Withdrawn from ITGC-AC-02 (SAP ERP). Restoring it returns it to that control, not this one.";

  it("reads a restored answer as a stored file and a withdrawn refusal as one with a way to the withdrawn files", () => {
    assert.deepEqual(
      uploadAnswer(200, { file_id: F1, duplicate: true, restored: true }),
      {
        state: "stored",
        fileId: F1,
        detail: "",
        restored: true,
        withdrawn: false,
        withdrawnFrom: null,
      },
    );
    assert.deepEqual(
      uploadAnswer(409, {
        detail: withdrawnElsewhere,
        withdrawn: true,
        withdrawn_from: "ITGC-AC-02 (SAP ERP)",
      }),
      {
        state: "refused",
        fileId: null,
        detail: withdrawnElsewhere,
        restored: false,
        withdrawn: true,
        // Passed through, so rows withdrawn from one control are said once.
        withdrawnFrom: "ITGC-AC-02 (SAP ERP)",
      },
    );
    // Still a duplicate where the server says it was not restored.
    assert.equal(
      uploadAnswer(200, { file_id: F1, duplicate: true, restored: false })
        .state,
      "duplicate",
    );
  });

  it("shows a restored file through the stages of a file added now, never as already held", () => {
    const restored = upload({ state: "stored", fileId: F1, restored: true });
    // Before the batch lists it: secured, waiting for its new reading.
    const [first] = fileLines([restored], null, facts());
    assert.ok(first !== undefined);
    assert.equal(first.activity?.text, RESTORED_WAITING);
    assert.deepEqual(first.track, ["done", "wait", "wait", "wait"]);
    assert.equal(first.duplicate, false);
    assert.equal(first.restored, true);
    assert.match(first.meta, / · Restored$/);
    // Listed by the server (duplicate and restored), its reading not started yet.
    const waiting = batchOf(
      finishedBatch({
        files: [
          file({
            duplicate: true,
            restored: true,
            read: {
              status: "PENDING",
              method: "NONE",
              pages: null,
              started_at: null,
              finished_at: null,
              note: "",
            },
            classification: null,
          }),
        ],
        items: [],
      }),
    );
    const [pending] = fileLines([restored], waiting, facts());
    assert.ok(pending !== undefined);
    assert.equal(waiting.files[0]?.duplicate, false);
    assert.equal(pending.activity?.text, RESTORED_WAITING);
    assert.equal(pending.dest, null);
    assert.equal(pending.duplicate, false);
    assert.equal(pending.movable, false);
    // Read and sorted: every stage done, and it can be moved as the session's own file.
    const read = batchOf(
      finishedBatch({
        files: [file({ duplicate: true, restored: true })],
        items: [],
      }),
    );
    const [sorted] = fileLines([restored], read, facts());
    assert.ok(sorted !== undefined);
    assert.deepEqual(sorted.track, ["done", "done", "done", "done"]);
    assert.equal(sorted.activity, null);
    assert.equal(sorted.dest?.kind, "placed");
    assert.equal(sorted.movable, true);
    assert.match(sorted.meta, / · Restored$/);
    // A file already held, never withdrawn, is still shown as already held.
    const held = batchOf(
      finishedBatch({ files: [file({ duplicate: true })], items: [] }),
    );
    const [kept] = fileLines([], held, facts());
    assert.equal(kept?.duplicate, true);
    assert.equal(kept?.restored, false);
    assert.equal(
      kept?.activity?.text,
      "Already added earlier: shown where it is",
    );
    for (const line of [first, pending, sorted]) {
      assert.doesNotMatch(texts(line).join(" "), CODES);
    }
  });

  it("links a file withdrawn from another control to the Withdrawn list, searched for it", () => {
    const refused = upload({
      name: "6_mfa-config.png",
      ...uploadAnswer(409, { detail: withdrawnElsewhere, withdrawn: true }),
    });
    const [line] = fileLines([refused], null, facts());
    assert.ok(line !== undefined);
    assert.equal(line.withdrawn, true);
    // One red chip in place of the track; the reason in plain text beside it.
    assert.equal(line.notAdded, true);
    assert.equal(NOT_ADDED_CHIP, "Not added");
    assert.equal(line.activity?.text, withdrawnElsewhere);
    assert.equal(line.activity?.tone, "note");
    assert.equal(WITHDRAWN_LINK, "Open withdrawn files");
    const href = withdrawnFilesHref(ORG, PROJECT, line.name);
    assert.equal(
      href,
      `/?organization=${ORG}&project=${PROJECT}&section=evidence&tab=files&queue=withdrawn&q=6_mfa-config.png`,
    );
    // The page reads that address as the Evidence library's Withdrawn list, searched.
    const params = new URLSearchParams(href.slice(2));
    assert.deepEqual(
      parseEvidenceView({
        tab: params.get("tab"),
        queue: params.get("queue"),
        q: params.get("q"),
        group: params.get("group"),
        file: params.get("file"),
      }),
      {
        tab: "files",
        queue: "withdrawn",
        query: "6_mfa-config.png",
        group: "list",
        file: null,
      },
    );
    // Any other refusal offers no such link.
    const other = upload({
      ...uploadAnswer(409, { detail: "the engagement is not active" }),
    });
    assert.equal(fileLines([other], null, facts())[0]?.withdrawn, false);
  });

  it("agrees when no file was added: Secure is a problem, nothing is finished in green, the footer adds files", () => {
    const uploads = Array.from({ length: 9 }, (_, at) =>
      upload({
        key: `u${at}`,
        ...uploadAnswer(409, { detail: withdrawnElsewhere, withdrawn: true }),
      }),
    );
    const progress = progressOf(uploads, null, NOW);
    assert.equal(progress.done, true);
    assert.equal(progress.nothingAdded, true);
    assert.deepEqual(
      progress.stages.map((stage) => [stage.state, stage.count, stage.flag]),
      [
        ["problem", "Secured 0 of 9", "9 not added"],
        ["wait", "Nothing to read", ""],
        ["wait", "Nothing to sort", ""],
        ["wait", "No item to check", ""],
      ],
    );
    assert.ok(progress.stages.every((stage) => stage.state !== "done"));
    const finish = finishOf(0, progress);
    // Red throughout, with no clock (nothing ran).
    assert.deepEqual(finish, {
      // Round 2: no short line (the red stage and the footer say it); old "No file added".
      short: "",
      note: "None of the 9 files were added. The list shows why.",
      tone: "problem",
      action: "add",
      primary: true,
    });
    assert.equal(finishedNote(0, progress), finish.note);
    assert.doesNotMatch(`${finish.short} ${finish.note}`, /Finished/);
    assert.equal(filesCount(progress), "9 files not added");
    assert.deepEqual(itemsPane(progress), {
      note: "",
      empty: "Nothing to check. No file was added.",
    });
    // The list behind the window says the same, in red.
    assert.deepEqual(progressLine({ progress, summary: null, seconds: 0 }), {
      text: "No file was added.",
      done: true,
      action: "See why",
      tone: "problem",
    });
    const one = progressOf([uploads[0] as Upload], null, NOW);
    assert.equal(
      finishOf(0, one).note,
      "The file was not added. The list shows why.",
    );
    const two = progressOf(uploads.slice(0, 2), null, NOW);
    assert.equal(
      finishOf(0, two).note,
      "Neither file was added. The list shows why.",
    );
    assert.equal(noneAdded(3), "None of the 3 files were added");
  });

  it("agrees when some files were not added: Secure is done with its flag, and the finished line says how many, in amber", () => {
    const ids = [F1, F2, F3, F4, F5, F6, F7];
    const uploads = [
      ...ids.map((fileId, at) =>
        upload({ key: `s${at}`, state: "stored", fileId }),
      ),
      upload({ key: "r1", state: "refused", detail: "No." }),
      upload({ key: "r2", state: "failed", detail: "Lost." }),
    ];
    const progress = progressOf(uploads, batchOf(finishedBatch()), NOW);
    assert.equal(progress.done, true);
    assert.equal(progress.nothingAdded, false);
    // Secure ended with files not added: amber, never the done tick.
    assert.deepEqual(
      [
        progress.stages[0]?.state,
        progress.stages[0]?.count,
        progress.stages[0]?.flag,
      ],
      ["partial", "Secured 7 of 9", "2 not added"],
    );
    assert.deepEqual(finishOf(33, progress), {
      short: "Finished in 0:33",
      note: "Finished in 0:33. 2 of 9 files were not added. 1 file needs you.",
      tone: "warning",
      action: "results",
      // A file needs a person: its row's choice is the primary action.
      primary: false,
    });
    assert.deepEqual(progressLine({ progress, summary: null, seconds: 33 }), {
      text: "7 files read: 5 sorted into the items, 1 needs you. 2 not added.",
      done: true,
      action: "See results",
      tone: "warning",
    });
    assert.equal(filesCount(progress), "6 of 7 sorted · 1 needs you");
  });

  it("agrees when every file was added: amber while a file needs you, green once none does", () => {
    const progress = progressOf([], batchOf(finishedBatch()), NOW);
    assert.deepEqual(
      progress.stages.map((stage) => stage.state),
      ["done", "done", "partial", "done"],
    );
    assert.deepEqual(finishOf(33, progress), {
      short: "Finished in 0:33",
      note: "Finished in 0:33. 1 file needs you.",
      tone: "warning",
      action: "results",
      primary: false,
    });
    // Every file placed or ruled out: green, See results the primary.
    const batch = finishedBatch();
    const placed = batchOf({
      ...batch,
      files: batch.files.filter(
        (entry) =>
          (entry.placement as { status: string }).status !== "NEEDS_PERSON",
      ),
    });
    const settled = progressOf([], placed, NOW);
    assert.equal(settled.needs, 0);
    assert.ok(settled.stages.every((stage) => stage.state === "done"));
    assert.deepEqual(finishOf(33, settled), {
      short: "Finished in 0:33",
      note: "Finished in 0:33.",
      tone: "success",
      action: "results",
      primary: true,
    });
    assert.equal(
      progressLine({ progress: settled, summary: null, seconds: 33 })?.tone,
      "success",
    );
    assert.equal(itemsPane(settled).note, "Two readings each");
    // Never "0:00", which reads as never read.
    assert.equal(tookLine(0), "Finished in under a second");
    assert.equal(tookLine(42), "Finished in 0:42");
  });

  it("waits for the files a person must place when no item holds a file yet", () => {
    const batch = finishedBatch();
    const waiting = batchOf({
      ...batch,
      files: batch.files.filter(
        (entry) =>
          (entry.placement as { status: string }).status === "NEEDS_PERSON",
      ),
      items: [],
    });
    const progress = progressOf([], waiting, NOW);
    assert.equal(progress.needs, 1);
    assert.deepEqual(
      [progress.stages[3]?.state, progress.stages[3]?.count],
      ["wait", "Waiting for 1 file to be placed"],
    );
    assert.equal(itemsPane(progress).empty, "Files appear here once placed.");
    assert.equal(filesCount(progress), "0 of 1 sorted · 1 needs you");
    // The row's last step says what it waits for.
    const [line] = fileLines([], waiting, facts());
    assert.equal(line?.trackLabels[3], NEEDS_YOU_STEP);
    assert.equal(line?.track[3], "needs");
    assert.equal(NEEDS_YOU_STEP, "Needs you");
  });

  it("holds the three cases to one rule, and the window reads the line from the model", () => {
    const refused = (key: string) =>
      upload({ key, state: "refused", detail: "No." });
    const cases = [
      progressOf([refused("a"), refused("b")], null, NOW),
      progressOf(
        [upload({ key: "s", state: "stored", fileId: F1 }), refused("b")],
        batchOf(finishedBatch()),
        NOW,
      ),
      progressOf([], batchOf(finishedBatch()), NOW),
    ];
    for (const progress of cases) {
      assert.equal(progress.done, true);
      const finish = finishOf(10, progress);
      const line = progressLine({ progress, summary: null, seconds: 10 });
      const secure = progress.stages[0]?.state;
      // Green only when everything was added and none needs a person; red (Secure, the
      // finish, the list line) exactly when nothing was; the footer adds files exactly
      // when there are no results; the list line's tone is the finish's.
      assert.equal(
        finish.tone === "success",
        secure === "done" && progress.notAdded === 0 && progress.needs === 0,
      );
      assert.equal(secure === "problem", progress.nothingAdded);
      assert.equal(finish.tone === "problem", progress.nothingAdded);
      assert.equal(finish.action === "add", progress.nothingAdded);
      // Nothing added: no short line beside the (hidden) clock.
      assert.equal(finish.short === "", progress.nothingAdded);
      assert.equal(line?.tone, finish.tone);
      assert.equal(
        progress.stages.some((stage) => stage.state === "done"),
        !progress.nothingAdded,
      );
    }
    const view = readFileSync("apps/web/src/evidence-wizard.tsx", "utf8");
    // The finished line and the footer both come from finishOf; neither says
    // "Finished in" on its own.
    assert.equal((view.match(/finishOf\(view\.seconds/g) ?? []).length, 2);
    assert.doesNotMatch(view, /`Finished in \$\{formatElapsed/);
    assert.match(view, /withdrawnFilesHref\(/);
    // In-app navigation to the withdrawn files, never a full page load.
    assert.match(view, /import Link from "next\/link";/);
    assert.doesNotMatch(view, /<a\s+className="wz-fr-link"/);
    // The panes read their counts and notes from the model.
    assert.match(view, /filesCount\(progress\)/);
    assert.match(view, /itemsPane\(progress\)/);
    assert.doesNotMatch(view, /Two readings each/);
    // The list line is marked by its tone, never a check because it is done.
    assert.match(view, /LINE_ICONS\[line\.tone\]/);
    assert.doesNotMatch(view, /line\.done \? "checkCircle"/);
    // See results steps back while a file needs a person.
    assert.match(
      view,
      /finish\?\.primary === false \? "btn btn-secondary" : "btn"/,
    );
    const css = readFileSync("apps/web/app/evidence-wizard.css", "utf8");
    assert.match(css, /\.wz-stage\.is-problem \.wz-stage-mark \{/);
    assert.match(css, /\.wz-stage\.is-partial \.wz-stage-mark \{/);
    assert.match(css, /\.wz-est\.is-problem \{/);
    assert.match(css, /\.wz-note\.is-problem > svg \{/);
    assert.match(css, /\.wz-fr-act\.is-note \{/);
    const list = readFileSync("apps/web/app/design-evidence.css", "utf8");
    assert.match(list, /\.de-progress\.is-problem > svg \{/);
    assert.match(list, /\.de-progress\.is-warning > svg \{/);
    const route = readFileSync(
      "apps/web/app/workspace/evidence-uploads/route.ts",
      "utf8",
    );
    assert.match(route, /restored: body\.restored === true/);
    assert.match(
      route,
      /withdrawn: response\.status === 409 && refused\.withdrawn === true/,
    );
  });
});

// Design review round 2 (17 November 2026): the owner's nine files withdrawn from one
// control are said once, with one link; Results never says "None of the 1 file", sets
// the files not added apart, and never "Analyzed in 0:00"; the list line drops a
// "0 sorted" clause.
describe("refusals said once, and the results in plain words", () => {
  const from = "ITGC-AC-02 (SAP ERP)";
  const sentence =
    "Withdrawn from ITGC-AC-02 (SAP ERP). Restoring it returns it to that control, not this one.";
  const refused = (key: string, name: string, over: Partial<Upload> = {}) =>
    upload({
      key,
      name,
      ...uploadAnswer(409, {
        detail: sentence,
        withdrawn: true,
        withdrawn_from: from,
      }),
      ...over,
    });

  it("gathers files withdrawn from one control under one note and one link", () => {
    const nine = Array.from({ length: 9 }, (_, at) =>
      refused(`w${at}`, `${at + 1}_shot.png`),
    );
    const lines = fileLines(
      [
        ...nine.slice(0, 4),
        upload({
          key: "big",
          name: "Big.zip",
          ...uploadAnswer(413, {}),
        }),
        upload({
          key: "early",
          name: "early.png",
          ...uploadAnswer(409, {
            detail:
              "Withdrawn before it was filed to a control. Restore it from the withdrawn files to use it again.",
            withdrawn: true,
            withdrawn_from: null,
          }),
        }),
        ...nine.slice(4),
      ],
      null,
      facts(),
    );
    const blocks = refusalBlocks(lines);
    assert.deepEqual(
      blocks.map((block) => block.kind),
      ["group", "line", "line"],
    );
    const [group, big, early] = blocks;
    assert.ok(group?.kind === "group");
    assert.equal(
      group.note,
      "9 files were withdrawn from ITGC-AC-02 (SAP ERP). Restoring them returns them to that control, not this one.",
    );
    assert.equal(group.query, "ITGC-AC-02");
    assert.equal(group.lines.length, 9);
    // Grouped rows keep their name, size and chip; the reason and link are the note's.
    for (const line of group.lines) {
      assert.equal(line.group, "withdrawn:ITGC-AC-02 (SAP ERP)");
      assert.equal(line.notAdded, true);
    }
    // A unique reason keeps its own sentence, and "before it was filed" never merges.
    assert.ok(big?.kind === "line" && big.line.group === null);
    assert.ok(early?.kind === "line" && early.line.group === null);
    assert.equal(early.line.withdrawn, true);
    assert.equal(early.line.withdrawnFrom, null);
    // The link lists that control's withdrawn files: the page matches the ref there.
    const href = withdrawnFilesHref(ORG, PROJECT, group.query);
    const params = new URLSearchParams(href.slice(2));
    assert.equal(params.get("q"), "ITGC-AC-02");
    assert.equal(withdrawnQuery(from), "ITGC-AC-02");
    assert.equal(withdrawnQuery("ITGC-AC-02"), "ITGC-AC-02");
  });

  it("keeps one file withdrawn from a control with its own sentence and link", () => {
    const lines = fileLines([refused("w1", "one.png")], null, facts());
    const [block] = refusalBlocks(lines);
    assert.ok(block?.kind === "line");
    assert.equal(block.line.group, null);
    assert.equal(block.line.activity?.text, sentence);
    assert.equal(block.line.withdrawn, true);
    // Two from different controls are not gathered.
    const two = refusalBlocks(
      fileLines(
        [
          refused("a", "a.png"),
          refused("b", "b.png", { withdrawnFrom: "ITGC-AC-03" }),
        ],
        null,
        facts(),
      ),
    );
    assert.deepEqual(
      two.map((item) => item.kind),
      ["line", "line"],
    );
  });

  it("never says None of the 1 file, and says the files that need a person plainly", () => {
    const batch = finishedBatch();
    const needs = (count: number) =>
      batchOf({
        ...batch,
        files: batch.files
          .filter(
            (entry) =>
              (entry.placement as { status: string }).status === "NEEDS_PERSON",
          )
          .flatMap((entry) =>
            Array.from({ length: count }, (_, at) => ({
              ...entry,
              file_id: uuid(80 + at),
            })),
          ),
        items: [],
      });
    const one = needs(1);
    const twoRefused = [
      upload({ key: "r1", state: "refused", detail: "No." }),
      upload({ key: "r2", state: "refused", detail: "No." }),
    ];
    assert.equal(
      resultsSummary(one, [], progressOf(twoRefused, one, NOW)).lead,
      "The file needs you: choose where it goes. 2 files were not added.",
    );
    const three = needs(3);
    assert.equal(
      resultsSummary(three, [], progressOf([], three, NOW)).lead,
      "3 files need you: choose where they go.",
    );
    // One file not D&I evidence: "The file could not be sorted", never "None of the 1".
    const outOnly = batchOf({
      ...batch,
      files: batch.files.filter(
        (entry) =>
          (entry.placement as { status: string }).status === "NOT_DESIGN",
      ),
      items: [],
    });
    const lead = resultsSummary(outOnly, [], progressOf([], outOnly, NOW)).lead;
    assert.match(lead, /^The file could not be sorted into an item\./);
    assert.doesNotMatch(lead, /None of the 1 /);
    // The footer drops "0 items checked by two readings".
    assert.equal(
      resultsNote(progressOf([], one, NOW)),
      "1 file needs you. Nothing is accepted until you accept it.",
    );
    assert.equal(
      resultsNote(progressOf([], batchOf(finishedBatch()), NOW)),
      "2 items checked by two readings · 1 file needs you. Nothing is accepted until you accept it.",
    );
    // The list line: no "0 sorted" clause.
    assert.equal(
      progressLine({
        progress: progressOf(twoRefused, one, NOW),
        summary: null,
        seconds: 4,
      })?.text,
      "1 file needs you; 2 not added.",
    );
    // Rewritten 18 November 2026 (design review): files of an upload none of which is
    // placed are said as what they are, an earlier upload's files to place, so the line
    // never reads as the files on a request; its action says so. Old: "2 files need
    // you." with "See results".
    const waiting = progressLine({
      progress: progressOf([], needs(2), NOW),
      summary: null,
      seconds: 4,
    });
    assert.equal(
      waiting?.text,
      "2 files from an earlier upload are waiting to be placed.",
    );
    assert.equal(waiting?.action, PLACE_FILES);
    assert.equal(PLACE_FILES, "Place files");
    assert.equal(waiting?.tone, "warning");
    // With who added them and when, from the server's list.
    assert.equal(
      progressLine({
        progress: progressOf([], needs(3), NOW),
        summary: {
          batchId: BATCH,
          createdAt: CREATED,
          createdBy: "Ryan James",
          chosenRequirementId: null,
          files: 3,
          inProgress: false,
          needsPerson: 3,
          notDesign: 0,
          finished: true,
          finishedAt: CREATED + 33_000,
        },
        seconds: 4,
      })?.text,
      "3 files from an earlier upload are waiting to be placed. Added by Ryan James on Nov 13, 2026.",
    );
  });

  it("never says Analyzed in 0:00, and nothing when no file was added", () => {
    const done = progressOf([], batchOf(finishedBatch()), NOW);
    assert.equal(analyzedLine(0, done), "Analyzed in under a second");
    // Changed 19 November 2026 (E1 design review, round 9). Old: "Analyzed in 0:42", a
    // clock's form ("11:44:30" read as a time of day). New: a duration in words.
    assert.equal(analyzedLine(42, done), "Analyzed in 42 s");
    assert.equal(analyzedLine(125, done), "Analyzed in 2 min 5 s");
    const none = progressOf(
      [upload({ key: "r", state: "refused", detail: "No." })],
      null,
      NOW,
    );
    assert.equal(analyzedLine(0, none), "");
  });

  it("shows the clock only while work runs, and the window reads the blocks from the model", () => {
    const view = readFileSync("apps/web/src/evidence-wizard.tsx", "utf8");
    // The ELAPSED clock is rendered only while there is no finish.
    assert.match(view, /\{finish === null \? \(\s*<p className="wz-elapsed">/);
    assert.doesNotMatch(view, /finish\.clock/);
    assert.doesNotMatch(view, /Analyzed in \{formatElapsed/);
    assert.match(view, /analyzedLine\(view\.seconds, view\.progress\)/);
    // Analyze and Results both gather refusals; Results lists the files not added apart.
    assert.equal((view.match(/refusalBlocks\(/g) ?? []).length, 2);
    assert.match(view, /notAddedTitle\(view\.notAdded\.length\)/);
    // One chip for "Not added" in both steps.
    assert.equal(
      (view.match(/className="pill tone-danger wz-fr-chip"/g) ?? []).length,
      2,
    );
    const css = readFileSync("apps/web/app/evidence-wizard.css", "utf8");
    assert.match(css, /a\.wz-fr-link \{[^}]*font-size: var\(--fs-sm\);/);
    // The proxy passes the control a file was withdrawn from.
    const route = readFileSync(
      "apps/web/app/workspace/evidence-uploads/route.ts",
      "utf8",
    );
    assert.match(route, /withdrawn_from:/);
    // The withdrawn list's by-line is cut with an ellipsis, its title the whole name.
    // Changed 18 November 2026 (E1 design review, round 5). Old: the line was drawn in
    // evidence-view.tsx from the file. New: the Withdrawn list's rows draw it themselves
    // (WithdrawnRows, evidence-change.tsx), from the row the page hands them.
    const list = readFileSync("apps/web/src/evidence-change.tsx", "utf8");
    assert.match(
      list,
      /className="cell-sub" title=\{`by \$\{row\.withdrawnBy\}`\}/,
    );
    const globals = readFileSync("apps/web/app/globals.css", "utf8");
    assert.match(globals, /\.is-fixed td > \.cell-sub\[title\] \{/);
  });
});
