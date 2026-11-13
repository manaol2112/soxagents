import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { uploadTarget } from "../apps/web/src/evidence-model.ts";
import {
  ASKED_AGAIN,
  addressesLine,
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
  finishedAt,
  finishedNote,
  formatElapsed,
  goneFromBatch,
  hintKey,
  itemCards,
  itemResults,
  leftWithout,
  needsFix,
  OUT,
  OUT_LABEL,
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
  readHint,
  readingProblem,
  resultsNote,
  resultsSummary,
  retryDelay,
  STALLED_AFTER_MS,
  serverClock,
  steadySeconds,
  UNREACHABLE,
  UNREACHABLE_AFTER,
  type Upload,
  uploadAnswer,
  type WizardItem,
  windowHeading,
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
      "Reviewed and approved: Joanna Rose Manaol",
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
        name: "Q2 review sign-off - J Manaol.pdf",
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
    assert.deepEqual(first?.read, {
      status: "PENDING",
      method: "NONE",
      pages: null,
      startedAt: null,
      finishedAt: null,
      note: "",
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
    created_by_name: "Robert John",
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
    assert.deepEqual(uploadAnswer(200, { file_id: F1, duplicate: false }), {
      state: "stored",
      fileId: F1,
      detail: "",
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
            to: "Joanna Rose Manaol",
            role: "Application Owner",
            due: "Due Nov 23, 2026",
          },
        ],
      }),
      {
        title: "Add evidence for ITGC-AC-03 Periodic User Access Review",
        sub: "SAP S/4HANA · SOX FY2027 · One request to Joanna Rose Manaol, due Nov 23, 2026",
        requested: {
          to: "Joanna Rose Manaol",
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
    assert.equal(
      lines[0]?.activity?.text,
      "Not added. This batch was opened for another item; start the wizard again.",
    );
    const progress = progressOf(
      [upload({ state: "refused" }), upload({ key: "u2", state: "failed" })],
      null,
      NOW,
    );
    assert.equal(progress.stages[0]?.flag, "2 not added");
    assert.equal(progress.done, true);
  });

  it("finishes when every file is read and sorted and every item's check has ended", () => {
    const batch = batchOf(finishedBatch());
    const progress = progressOf([], batch, NOW);
    assert.deepEqual(
      progress.stages.map((stage) => [stage.state, stage.count, stage.flag]),
      [
        ["done", "Secured 7 of 7", ""],
        ["done", "Read 7 of 7", ""],
        ["done", "Sorted 7 of 7", "1 needs you"],
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
      "Q2 review sign-off - J Manaol.pdf",
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
      "Accepting marks attributes A to D as evidenced. Both readings found an issue on E. The readings do not agree on F: your judgment is needed. You can still accept; accepting does not settle these.",
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
    assert.deepEqual(
      apart.map((line) => line.name),
      ["Scan_0042.pdf", "Team offsite photo.jpg", "Big.zip"],
    );
    assert.equal(apartTitle(apart.length), "3 files are not in an item");
    assert.equal(apartTitle(1), "1 file is not in an item");
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
    assert.equal(progress.stages[3]?.count, "No item to check");
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
      "No file was added. 1 file could not be added: each says why.",
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
    assert.deepEqual(
      progressLine({ progress: running, summary: null, seconds: 42 }),
      {
        text: "Analyzing 7 files · Checking 1 item against the attributes · 0:42",
        done: false,
        action: "Show progress",
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
      "Analyzing 2 files · Read 1 of 2 · 0:09",
    );
    const done = progressOf([], batchOf(finishedBatch()), NOW);
    assert.deepEqual(
      progressLine({ progress: done, summary: null, seconds: 33 }),
      {
        text: "7 files analyzed: 5 sorted into the items, 1 needs you.",
        done: true,
        action: "See results",
      },
    );
    // Reopened from the server's list, its state not read yet.
    assert.deepEqual(
      progressLine({
        progress: null,
        summary: {
          batchId: BATCH,
          createdAt: CREATED,
          createdBy: "Robert John",
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
        text: "7 files analyzed: 1 needs you. Added by Robert John.",
        done: true,
        action: "See results",
      },
    );
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
      "Analyzing 7 files · Checking 1 item against the attributes · 0:30",
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
