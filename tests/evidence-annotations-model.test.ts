import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ANNOTATION_BOUNDS,
  type Annotation,
  type AnnotationScope,
  type AnnotationSet,
  ASK_CONTAINED_CHARACTERS,
  ASK_CONTAINED_WORDS,
  annotatedCopyName,
  annotationCitations,
  annotationFields,
  annotationFor,
  annotationName,
  annotationProblem,
  annotationReadPath,
  annotationsQuery,
  annotationWrite,
  attributeRows,
  boundsOf,
  CALLOUT_WIDTH,
  CHECKED_IN_CODE,
  calloutPlace,
  checkLine,
  clampBox,
  confirmAllWords,
  copyOffered,
  copyRows,
  doneWords,
  draftOf,
  drawnBox,
  editChanges,
  HANDLES,
  handlePoint,
  isDrawn,
  KIND_WORDS,
  kindLine,
  legendRows,
  lineBoxes,
  MARK_TOKEN,
  MIN_BOX,
  moveBox,
  NOT_IN_FILE,
  nextToReview,
  nudgeOf,
  pageMarks,
  parseAnnotations,
  positionWords,
  quoteKey,
  REVIEW_WORDS,
  rectsOf,
  resizeBox,
  reviewCounts,
  reviewedWords,
  reviewLine,
  reviewState,
  SHEET_BELOW,
  shortValue,
  stepTo,
  unboxedLine,
  wrapText,
} from "../apps/web/src/evidence-annotations-model.ts";
import { CHECKED_IN_CODE as REVIEW_CHECKED_IN_CODE } from "../apps/web/src/evidence-assurance-model.ts";

// Evidence annotations (docs/evidence-annotations.md; product owner, 14 November 2026: "the
// AI agent annotates the basis why the specific evidence satisfy the requirements of the
// control and the specific attribute. This annotations would be reviewed by the user and
// can be adjusted as needed."). The server decides what is annotated and who may change
// it; the preview reads its answer cautiously, words it, places it, and sends each review
// to the server. Three things it must never do: show an annotation as reviewed that the
// server did not say was, offer an action to a person who may not take it, and change the
// preview of a file that is on no D&I request.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ORG, PROJECT, CONTROL, REQUEST, FILE] = [
  uuid(1),
  uuid(2),
  uuid(3),
  uuid(4),
  uuid(5),
] as const;
const [A, B, C, D] = [uuid(11), uuid(12), uuid(13), uuid(14)] as const;
const N = [1, 2, 3, 4, 5, 6, 7].map((n) => uuid(100 + n));
const id = (n: number) => N[n - 1] ?? "";

const SCOPE: AnnotationScope = {
  organizationId: ORG,
  projectId: PROJECT,
  controlId: CONTROL,
  requirementId: REQUEST,
  fileId: FILE,
};

/** One annotation as the API sends it: by default the agent's proposal, on attribute A. */
function sent(n: number, over: Record<string, unknown> = {}) {
  return {
    id: id(n),
    number: n,
    kind: "SHOWS",
    label: "Account disabled",
    statement: "The leaver's account is disabled.",
    agent_statement: "The leaver's account is disabled.",
    quote: "Account Disabled Yes",
    attribute_ids: [A],
    codes: ["A"],
    page: 1,
    rects: [[0.037, 0.41, 0.26, 0.02]],
    check_sentence: "",
    origin: "AGENT",
    status: "PROPOSED",
    version: 1,
    decided_by_name: null,
    decided_at: null,
    ...over,
  };
}

/** The sample file of the approved mockup: seven annotations, two reviewed. */
const ANSWER = {
  file_id: FILE,
  requirement_id: REQUEST,
  positions: true,
  pages: [{ page: 1, width: 2200, height: 1032 }],
  attributes: [
    {
      id: A,
      code: "A",
      text: "Access disabled, per the system's record",
      annotation_ids: [id(2), id(4), id(5)],
    },
    {
      id: B,
      code: "B",
      text: "Every account of the leaver",
      annotation_ids: [],
    },
    {
      id: C,
      code: "C",
      text: "Removed within 1 business day",
      annotation_ids: [id(3), id(5)],
    },
    {
      id: D,
      code: "D",
      text: "No activity after removal",
      annotation_ids: [id(6)],
    },
  ],
  annotations: [
    sent(1, {
      kind: "IDENTIFIES",
      label: "Right system",
      statement: "The control's system, in production.",
      quote: "Workday · acme_prod (Production)",
      attribute_ids: [],
      codes: [],
      rects: [[0.0195, 0.1085, 0.2514, 0.032]],
      status: "CONFIRMED",
      version: 2,
      decided_by_name: "Dana Lee",
      decided_at: "2026-11-14T09:30:00Z",
    }),
    sent(2, {
      kind: "IDENTIFIES",
      label: "Right person",
      quote: "View Workday Account — Jordan Reyes (104582)",
      rects: [[0.025, 0.2035, 0.4773, 0.0436]],
    }),
    sent(3, {
      kind: "IDENTIFIES",
      label: "Termination date",
      quote: "Worker Status: Terminated (Effective 09/30/2026)",
      attribute_ids: [C],
      codes: ["C"],
      rects: [[0.025, 0.2607, 0.2809, 0.0233]],
    }),
    sent(4, { rects: [[0.0368, 0.4109, 0.2555, 0.0194]] }),
    sent(5, {
      label: "Disabled the same day",
      statement:
        "Disabled on 09/30/2026 at 11:59 PM PT, the same day the termination took effect.",
      quote: "Account Disabled On 09/30/2026 11:59:00 PM PT",
      attribute_ids: [A, C],
      codes: ["A", "C"],
      rects: [[0.0368, 0.4806, 0.3736, 0.0223]],
      check_sentence:
        "termination 30 September 2026, disabled 30 September 2026: the same day.",
    }),
    sent(6, {
      label: "Last sign-on before removal",
      quote: "Last Successful Signon 09/30/2026 04:47:31 PM PT",
      attribute_ids: [D],
      codes: ["D"],
      rects: [[0.0373, 0.7519, 0.3755, 0.0242]],
    }),
    sent(7, {
      kind: "SOURCE",
      label: "Source",
      statement: "Captured by the auditor on the live system.",
      agent_statement: "Screenshot taken by the auditor.",
      quote: "Screenshot captured by: Auditor (walkthrough with M. Santos)",
      attribute_ids: [],
      codes: [],
      rects: [[0.0145, 0.9632, 0.9714, 0.0223]],
      status: "EDITED",
      version: 3,
      decided_by_name: "Dana Lee",
      decided_at: "2026-11-14T09:41:00Z",
    }),
  ],
  reviewed: 2,
  total: 7,
  can_edit: true,
};

function read(value: unknown = ANSWER): AnnotationSet {
  const set = parseAnnotations(value);
  assert.ok(set !== null);
  return set;
}

const at = (set: AnnotationSet, n: number): Annotation => {
  const annotation = set.annotations[n - 1];
  assert.ok(annotation !== undefined);
  return annotation;
};

describe("reading the server's answer", () => {
  it("reads every field of an annotation", () => {
    const set = read();
    assert.equal(set.fileId, FILE);
    assert.equal(set.requirementId, REQUEST);
    assert.equal(set.positions, true);
    assert.equal(set.canEdit, true);
    assert.deepEqual(set.pages, [{ page: 1, width: 2200, height: 1032 }]);
    assert.deepEqual(
      set.attributes.map((attribute) => attribute.code),
      ["A", "B", "C", "D"],
    );
    assert.deepEqual(at(set, 5), {
      id: id(5),
      number: 5,
      kind: "SHOWS",
      label: "Disabled the same day",
      statement:
        "Disabled on 09/30/2026 at 11:59 PM PT, the same day the termination took effect.",
      agentStatement: "The leaver's account is disabled.",
      quote: "Account Disabled On 09/30/2026 11:59:00 PM PT",
      attributeIds: [A, C],
      codes: ["A", "C"],
      page: 1,
      rects: [{ x: 0.0368, y: 0.4806, w: 0.3736, h: 0.0223 }],
      checkSentence:
        "termination 30 September 2026, disabled 30 September 2026: the same day.",
      origin: "AGENT",
      status: "PROPOSED",
      version: 1,
      decidedByName: null,
      decidedAt: null,
    });
    const first = at(set, 1);
    assert.equal(first.status, "CONFIRMED");
    assert.equal(first.decidedByName, "Dana Lee");
    assert.equal(first.decidedAt, "2026-11-14T09:30:00Z");
    assert.equal(at(set, 7).status, "EDITED");
  });

  it("is nothing at all when the answer is not one", () => {
    for (const value of [
      null,
      undefined,
      "annotations",
      42,
      [],
      {},
      { ...ANSWER, file_id: "not-an-id" },
      { ...ANSWER, requirement_id: 7 },
    ]) {
      assert.equal(parseAnnotations(value), null);
    }
  });

  it("falls to the cautious reading where it does not know a value", () => {
    const set = read({
      file_id: FILE,
      requirement_id: REQUEST,
      positions: "yes",
      can_edit: 1,
      pages: "none",
      attributes: null,
      annotations: [
        {
          id: id(1),
          kind: "CONTRADICTS",
          status: "APPROVED",
          origin: "ROBOT",
          version: "3",
          page: 0,
          rects: "everywhere",
          attribute_ids: "A",
          codes: ["A", 7, ""],
          label: 12,
          statement: null,
          decided_by_name: "",
          decided_at: 20261114,
        },
      ],
    });
    // Only `true` offers the actions, and only `true` says positions are known.
    assert.equal(set.canEdit, false);
    assert.equal(set.positions, false);
    assert.deepEqual(set.pages, []);
    assert.deepEqual(set.attributes, []);
    assert.deepEqual(at(set, 1), {
      id: id(1),
      number: 1,
      // A kind the page does not know claims nothing: never "Shows an attribute".
      kind: "OTHER",
      label: "",
      statement: "",
      agentStatement: "",
      quote: "",
      attributeIds: [],
      codes: ["A"],
      page: 1,
      rects: [],
      checkSentence: "",
      // Model-derived until the server says a person stands behind it.
      origin: "AGENT",
      // Never reviewed unless the server says so in a word the page knows.
      status: "PROPOSED",
      version: 0,
      decidedByName: null,
      decidedAt: null,
    });
    assert.equal(KIND_WORDS.OTHER.tone, "neutral");
  });

  it("lists what is in force: no removed or replaced annotation, none twice, none without an id", () => {
    const set = read({
      ...ANSWER,
      annotations: [
        sent(1),
        sent(2, { status: "REMOVED" }),
        sent(3, { status: "SUPERSEDED" }),
        sent(4),
        sent(4),
        { ...sent(5), id: "five" },
        "six",
        null,
        sent(6),
      ],
    });
    assert.deepEqual(
      set.annotations.map((annotation) => annotation.id),
      [id(1), id(4), id(6)],
    );
    // The number is the place in the list shown, whatever the answer says.
    assert.deepEqual(
      set.annotations.map((annotation) => annotation.number),
      [1, 2, 3],
    );
  });

  it("bounds the lists: 24 annotations, 8 boxes each, and each sentence", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      ...sent(1),
      id: uuid(500 + index),
      rects: Array.from({ length: 12 }, (_unused, line) => [
        0.1,
        0.05 * line,
        0.5,
        0.03,
      ]),
      statement: "word ".repeat(300),
      label: "L".repeat(200),
      quote: "q".repeat(2000),
    }));
    const set = read({ ...ANSWER, annotations: many });
    assert.equal(set.annotations.length, 24);
    assert.equal(ANNOTATION_BOUNDS.annotations, 24);
    assert.equal(ANNOTATION_BOUNDS.rects, 8);
    for (const annotation of set.annotations) {
      assert.equal(annotation.rects.length, 8);
      assert.ok(annotation.statement.length <= ANNOTATION_BOUNDS.statement);
      assert.ok(annotation.label.length <= ANNOTATION_BOUNDS.label);
      assert.ok(annotation.quote.length <= ANNOTATION_BOUNDS.quote);
    }
  });

  it("keeps only boxes that are inside the page", () => {
    const rects = (value: unknown) =>
      at(read({ ...ANSWER, annotations: [sent(1, { rects: value })] }), 1)
        .rects;
    assert.deepEqual(rects([[0.1, 0.2, 0.3, 0.04]]), [
      { x: 0.1, y: 0.2, w: 0.3, h: 0.04 },
    ]);
    assert.deepEqual(
      rects([
        [-0.1, 0.2, 0.3, 0.04],
        [0.1, 0.2, 0, 0.04],
        [0.1, 0.2, 0.3, -1],
        [0.9, 0.2, 0.3, 0.04],
        [0.1, 0.99, 0.3, 0.04],
        [0.1, 0.2, 0.3],
        ["0.1", 0.2, 0.3, 0.04],
        [Number.NaN, 0.2, 0.3, 0.04],
        [0.1, 0.2, Number.POSITIVE_INFINITY, 0.04],
        { x: 0.1, y: 0.2, w: 0.3, h: 0.04 },
        null,
      ]),
      [],
    );
    // A box a rounding carries a hair past the edge is held at it.
    const [edge] = rects([[0.5, 0.5, 0.5005, 0.5005]]);
    assert.ok(edge !== undefined);
    assert.ok(edge.x + edge.w <= 1 && edge.y + edge.h <= 1);
  });

  it("reads the letters from the attributes it names, else from the answer's own", () => {
    // By id, in the control's order, whatever order the answer lists them in.
    assert.deepEqual(
      at(
        read({
          ...ANSWER,
          annotations: [sent(1, { attribute_ids: [C, A], codes: ["Z"] })],
        }),
        1,
      ).codes,
      ["A", "C"],
    );
    // An attribute the list does not hold: the answer's letters, once each.
    assert.deepEqual(
      at(
        read({
          ...ANSWER,
          attributes: [],
          annotations: [sent(1, { codes: ["A", "A", "C"] })],
        }),
        1,
      ).codes,
      ["A", "C"],
    );
  });

  it("reads an attribute only with an id and a letter, and a page only with a size", () => {
    const set = read({
      ...ANSWER,
      pages: [
        { page: 1, width: 2200, height: 1032 },
        { page: 1, width: 10, height: 10 },
        { page: 2, width: 0, height: 100 },
        { page: 0, width: 100, height: 100 },
        { page: 3, width: "wide", height: 100 },
        "page",
      ],
      attributes: [
        { id: A, code: "A", text: "First", annotation_ids: [id(1), "x", 4] },
        { id: A, code: "A", text: "First again" },
        { id: "b", code: "B", text: "No id" },
        { id: B, code: "", text: "No letter" },
        { id: C, code: "C" },
      ],
    });
    assert.deepEqual(set.pages, [{ page: 1, width: 2200, height: 1032 }]);
    assert.deepEqual(set.attributes, [
      { id: A, code: "A", text: "First", annotationIds: [id(1)] },
      { id: C, code: "C", text: "", annotationIds: [] },
    ]);
  });
});

describe("the words", () => {
  it("names each kind in words with a tone and a mark, no two alike", () => {
    assert.deepEqual(KIND_WORDS.SHOWS, {
      label: "Shows an attribute",
      tone: "success",
      mark: "check",
    });
    assert.equal(KIND_WORDS.IDENTIFIES.label, "Right system, person or date");
    assert.equal(KIND_WORDS.IDENTIFIES.tone, "info");
    assert.equal(KIND_WORDS.SOURCE.label, "Source");
    assert.equal(KIND_WORDS.SOURCE.tone, "source");
    assert.equal(KIND_WORDS.EXCEPTION.label, "Shows an exception");
    assert.equal(KIND_WORDS.EXCEPTION.tone, "danger");
    const kinds = Object.values(KIND_WORDS);
    for (const key of ["label", "tone", "mark"] as const) {
      assert.equal(new Set(kinds.map((kind) => kind[key])).size, kinds.length);
    }
    // Each tone has its colour over the evidence.
    for (const kind of kinds) {
      assert.match(MARK_TOKEN[kind.tone], /^--mark-/);
    }
  });

  it("says what an annotation is with the attributes it bears on", () => {
    const set = read();
    assert.equal(kindLine(at(set, 4)), "Shows attribute A");
    assert.equal(kindLine(at(set, 5)), "Shows attributes A and C");
    assert.equal(
      kindLine({ kind: "SHOWS", codes: ["A", "B", "C"] }),
      "Shows attributes A, B and C",
    );
    assert.equal(kindLine({ kind: "SHOWS", codes: [] }), "Shows an attribute");
    assert.equal(
      kindLine({ kind: "EXCEPTION", codes: ["B"] }),
      "Shows an exception to attribute B",
    );
    assert.equal(
      kindLine({ kind: "EXCEPTION", codes: [] }),
      "Shows an exception",
    );
    assert.equal(kindLine(at(set, 3)), "Right system, person or date");
    assert.equal(kindLine(at(set, 7)), "Source");
  });

  it("says who stands behind it: the agent's proposal, or the person who reviewed it", () => {
    const set = read();
    assert.equal(reviewLine(at(set, 5)), "Proposed by the agent");
    assert.equal(
      reviewLine(at(set, 1)),
      "Confirmed by Dana Lee on Nov 14, 2026",
    );
    assert.equal(reviewLine(at(set, 7)), "Edited by Dana Lee on Nov 14, 2026");
    assert.equal(
      reviewLine({
        status: "CONFIRMED",
        origin: "PERSON",
        decidedByName: "Sam Ortiz",
        decidedAt: null,
      }),
      "Added by Sam Ortiz",
    );
    assert.equal(
      reviewLine({
        status: "CONFIRMED",
        origin: "AGENT",
        decidedByName: null,
        decidedAt: null,
      }),
      "Confirmed",
    );
    // A review state is a word and a mark; a proposal's mark is the empty ring.
    assert.deepEqual(
      [1, 5, 7].map((n) => reviewState(at(set, n))),
      ["confirmed", "proposed", "edited"],
    );
    assert.deepEqual(REVIEW_WORDS, {
      proposed: { word: "Proposed", mark: "" },
      confirmed: { word: "Confirmed", mark: "✓" },
      edited: { word: "Edited", mark: "✎" },
    });
  });

  it("puts the comparison's sentence under the review's own heading, once", () => {
    assert.equal(CHECKED_IN_CODE, REVIEW_CHECKED_IN_CODE);
    assert.equal(
      checkLine("termination 30 September 2026: the same day."),
      "Checked in code: termination 30 September 2026: the same day.",
    );
    assert.equal(
      checkLine("Checked in code: the same day."),
      "Checked in code: the same day.",
    );
    assert.equal(checkLine("  "), "");
  });

  it("names a box and a line for a screen reader", () => {
    const set = read();
    assert.equal(
      annotationName(at(set, 5)),
      "Annotation 5: Disabled the same day. Shows attributes A and C. Proposed.",
    );
    assert.equal(
      annotationName(at(set, 1)),
      "Annotation 1: Right system. Right system, person or date. Confirmed.",
    );
  });
});

describe("what this file shows", () => {
  it("lists each attribute with the numbers that bear on it, or says it is not in the file", () => {
    const rows = attributeRows(read());
    assert.deepEqual(
      rows.map((row) => [row.code, row.marks.map((mark) => mark.number)]),
      [
        ["A", [2, 4, 5]],
        ["B", []],
        ["C", [3, 5]],
        ["D", [6]],
      ],
    );
    assert.equal(rows[1]?.text, "Every account of the leaver");
    assert.equal(NOT_IN_FILE, "Not in this file");
    // Each number carries its kind, so its colour is the annotation's own.
    assert.deepEqual(
      rows[2]?.marks.map((mark) => mark.kind),
      ["IDENTIFIES", "SHOWS"],
    );
  });

  it("counts an annotation by its own attributes too, and never one that is not listed", () => {
    const rows = attributeRows(
      read({
        ...ANSWER,
        attributes: [
          { id: A, code: "A", text: "", annotation_ids: [] },
          { id: B, code: "B", text: "", annotation_ids: [uuid(999), id(2)] },
        ],
        annotations: [sent(1, { attribute_ids: [A] }), sent(2)],
      }),
    );
    assert.deepEqual(
      rows.map((row) => row.marks.map((mark) => mark.number)),
      [[1, 2], [2]],
    );
  });
});

describe("the legend", () => {
  it("is one line per annotation: number, label, a short value, letters, review mark", () => {
    assert.deepEqual(
      legendRows(read()).map((row) => [
        row.number,
        row.label,
        row.value,
        row.codes.join(""),
        row.review,
      ]),
      [
        [
          1,
          "Right system",
          "Workday · acme_prod (Production)",
          "",
          "confirmed",
        ],
        [
          2,
          "Right person",
          "View Workday Account — Jordan Reyes…",
          "A",
          "proposed",
        ],
        [
          3,
          "Termination date",
          "Terminated (Effective 09/30/2026)",
          "C",
          "proposed",
        ],
        [4, "Account disabled", "Yes", "A", "proposed"],
        [
          5,
          "Disabled the same day",
          "Account Disabled On 09/30/2026…",
          "AC",
          "proposed",
        ],
        [
          6,
          "Last sign-on before removal",
          "Successful Signon 09/30/2026…",
          "D",
          "proposed",
        ],
        [7, "Source", "Auditor (walkthrough with M. Santos)", "", "edited"],
      ],
    );
  });

  it("takes the value from the quote only where the label does not already say it", () => {
    assert.equal(shortValue("Account disabled", "Account Disabled Yes"), "Yes");
    assert.equal(shortValue("Account disabled", "Account  disabled"), "");
    assert.equal(shortValue("Right system", ""), "");
    // The part after a field's colon, cut at a word.
    assert.equal(
      shortValue("Termination date", "Worker Status: Terminated"),
      "Terminated",
    );
    const long = shortValue("Source", `Run by: ${"report ".repeat(20)}`);
    assert.ok(long.length <= 37 && long.endsWith("…"));
    assert.ok(!long.includes("  "));
    // A label that is missing is the kind's own words.
    const [row] = legendRows(
      read({
        ...ANSWER,
        annotations: [sent(1, { label: "", kind: "SOURCE" })],
      }),
    );
    assert.equal(row?.label, "Source");
  });

  it("counts what is reviewed from the list it shows", () => {
    const set = read();
    const counts = reviewCounts(set.annotations);
    assert.deepEqual(counts, { reviewed: 2, proposed: 5, total: 7 });
    assert.equal(reviewedWords(counts), "2 of 7 reviewed");
    assert.equal(confirmAllWords(counts.proposed), "Confirm all 5 proposed");
    assert.equal(positionWords(set.annotations, id(5)), "5 of 7");
    assert.equal(positionWords(set.annotations, uuid(999)), "");
    assert.deepEqual(reviewCounts([]), { reviewed: 0, proposed: 0, total: 0 });
  });
});

describe("stepping", () => {
  const list = read().annotations;

  it("goes to the next annotation still proposed on Confirm & next, round to the top", () => {
    assert.equal(nextToReview(list, id(5)), id(6));
    // 7 is edited and 1 confirmed: after 6 it comes round to 2.
    assert.equal(nextToReview(list, id(6)), id(2));
    assert.equal(nextToReview(list, id(7)), id(2));
    // With none selected, the first one still proposed.
    assert.equal(nextToReview(list, null), id(2));
  });

  it("stays where it is when no other is left to review", () => {
    const one = read({
      ...ANSWER,
      annotations: [
        sent(1, { status: "CONFIRMED" }),
        sent(2),
        sent(3, { status: "EDITED" }),
      ],
    }).annotations;
    assert.equal(nextToReview(one, id(2)), null);
    assert.equal(nextToReview(one, id(1)), id(2));
    assert.equal(nextToReview([], null), null);
  });

  it("moves to the previous and the next in the list's order, and stops at an end", () => {
    assert.equal(stepTo(list, id(5), 1), id(6));
    assert.equal(stepTo(list, id(5), -1), id(4));
    assert.equal(stepTo(list, id(7), 1), null);
    assert.equal(stepTo(list, id(1), -1), null);
    // With none selected: next is the first, previous the last.
    assert.equal(stepTo(list, null, 1), id(1));
    assert.equal(stepTo(list, null, -1), id(7));
    assert.equal(stepTo([], null, 1), null);
  });
});

describe("where the callout goes", () => {
  const page = { width: 1000, height: 470 };
  const callout = { width: CALLOUT_WIDTH, height: 220 };
  const place = (
    box: { x: number; y: number; w: number; h: number } | null,
    over: Partial<Parameters<typeof calloutPlace>[0]> = {},
  ) => calloutPlace({ box, page, callout, viewportWidth: 1440, ...over });

  it("stands beside the box, in the free space to its right, when it fits", () => {
    // Annotation 5 of the sample: its box ends at 41% of the page.
    const at5 = place({ x: 0.0368, y: 0.4806, w: 0.3736, h: 0.0223 });
    assert.equal(at5.mode, "beside");
    assert.ok(at5.mode === "beside");
    assert.ok(at5.left > 0.4104 * page.width);
    assert.ok(at5.left + CALLOUT_WIDTH <= page.width);
    // It never leaves the page: held inside its height.
    assert.ok(at5.top >= 0 && at5.top + callout.height <= page.height);
    // Its pointer is level with the box.
    const middle = (0.4806 + 0.0223 / 2) * page.height;
    assert.ok(Math.abs(at5.top + at5.pointer - middle) < 1);
  });

  it("goes below a box with no room beside it, else above it", () => {
    // A wide line near the top: no room to the right, room below.
    const below = place({ x: 0.02, y: 0.1, w: 0.9, h: 0.04 });
    assert.equal(below.mode, "below");
    assert.ok(below.mode === "below");
    assert.ok(below.top >= (0.1 + 0.04) * page.height);
    assert.ok(below.left >= 0 && below.left + CALLOUT_WIDTH <= page.width);
    // The sample's source line, along the bottom: only above has room.
    const above = place({ x: 0.0145, y: 0.9632, w: 0.9714, h: 0.0223 });
    assert.equal(above.mode, "above");
    assert.ok(above.mode === "above");
    assert.ok(above.top >= 0);
    assert.ok(above.top + callout.height <= 0.9632 * page.height);
  });

  it("never covers its box: where it fits on neither side it goes below and the stage scrolls", () => {
    const tall = { width: CALLOUT_WIDTH, height: 400 };
    for (const y of [0, 0.05, 0.2, 0.5, 0.8, 0.95]) {
      const at = place({ x: 0.02, y, w: 0.9, h: 0.04 }, { callout: tall });
      assert.ok(at.mode === "below" || at.mode === "above", String(y));
      if (at.mode === "below") {
        assert.ok(at.top >= (y + 0.04) * page.height, String(y));
      } else {
        assert.ok(at.top >= 0, String(y));
        assert.ok(at.top + tall.height <= y * page.height, String(y));
      }
    }
    // In the middle of the page neither side holds it: below, past the page's foot.
    const middle = place(
      { x: 0.02, y: 0.5, w: 0.9, h: 0.04 },
      { callout: tall },
    );
    assert.equal(middle.mode, "below");
    assert.ok(middle.mode === "below");
    assert.ok(middle.top + tall.height > page.height);
  });

  it("is a sheet along the bottom on a small screen, with no box, or on a page too narrow", () => {
    const box = { x: 0.0368, y: 0.4806, w: 0.3736, h: 0.0223 };
    assert.equal(SHEET_BELOW, 720);
    assert.deepEqual(place(box, { viewportWidth: 390 }), { mode: "sheet" });
    assert.deepEqual(place(box, { viewportWidth: 719 }), { mode: "sheet" });
    assert.notEqual(place(box, { viewportWidth: 720 }).mode, "sheet");
    assert.deepEqual(place(null), { mode: "sheet" });
    assert.deepEqual(place(box, { page: { width: 280, height: 400 } }), {
      mode: "sheet",
    });
    assert.deepEqual(place(box, { page: { width: 1000, height: 0 } }), {
      mode: "sheet",
    });
  });

  it("never moves between the page and the sheet because its own size changed", () => {
    const box = { x: 0.02, y: 0.4, w: 0.9, h: 0.04 };
    for (const height of [0, 40, 220, 400, 2000]) {
      assert.notEqual(
        place(box, { callout: { width: CALLOUT_WIDTH, height } }).mode,
        "sheet",
      );
    }
  });
});

describe("the annotation a row's passage opens on", () => {
  // "View" on a row of a finished check's attribute (docs/evidence-assurance.md, section
  // 10.12) opens the file on the annotation that marks the row's passage. It only
  // chooses what is put in view.
  const numberFor = (
    quote: string,
    attributeId: string,
    set = read(),
  ): number | null =>
    annotationFor(set, { attributeId, quote })?.number ?? null;

  it("compares quotes with case, spacing and punctuation set aside", () => {
    assert.equal(
      quoteKey("  Account Disabled On 09/30/2026 11:59:00 PM PT. "),
      "account disabled on 09 30 2026 11 59 00 pm pt",
    );
    assert.equal(
      quoteKey("account   disabled\non: 09-30-2026, 11.59.00 pm (PT)"),
      quoteKey("Account Disabled On 09/30/2026 11:59:00 PM PT"),
    );
    assert.equal(quoteKey(" · — … "), "");
  });

  it("opens on the annotation whose quote is the row's passage", () => {
    assert.equal(
      numberFor("Account Disabled On 09/30/2026 11:59:00 PM PT", A),
      5,
    );
    // However the passage was typed.
    assert.equal(
      numberFor("account disabled on: 09/30/2026  11:59:00 pm pt.", A),
      5,
    );
    // Changed after the second review of section 10.12 (item 5). Old: the quote
    // decided even for an annotation of another attribute, so A's row opened on D's
    // sign-on (6) and C's on the system line (1). New: where the file has an annotation
    // of this attribute, one of another attribute is never chosen; the attribute's own
    // first annotation that shows it is.
    assert.equal(
      numberFor("Last Successful Signon 09/30/2026 04:47:31 PM PT", A),
      4,
    );
    assert.equal(numberFor("Workday · acme_prod (Production)", C), 5);
    // Where no annotation names the attribute, only the passage's own words are taken.
    assert.equal(
      numberFor("Last Successful Signon 09/30/2026 04:47:31 PM PT", B),
      6,
    );
    assert.equal(numberFor("Workday · acme_prod (Production)", B), 1);
  });

  it("never opens on another attribute's annotation where the file has one of this attribute", () => {
    // The second review of section 10.12, item 5: containment ran before "names the
    // attribute" and took any annotation whose short quote (a date, "Yes", a system's
    // name) appears in the passage. The rendered case: attribute A's row opened on B's
    // "Effective date · 09/30/2026".
    const date = read({
      ...ANSWER,
      annotations: [
        sent(1, {
          kind: "IDENTIFIES",
          label: "Effective date",
          quote: "09/30/2026",
          attribute_ids: [B],
          codes: ["B"],
        }),
        sent(2, {}),
      ],
    });
    assert.equal(
      numberFor("Account Disabled On 09/30/2026 11:59:00 PM PT", A, date),
      2,
    );
    // A one-word annotation of another attribute, held by the passage: not taken.
    const word = read({
      ...ANSWER,
      annotations: [
        sent(1, {
          kind: "SOURCE",
          quote: "Workday",
          attribute_ids: [],
          codes: [],
        }),
        sent(2, {}),
      ],
    });
    assert.equal(
      numberFor("Workday account jreyes: Disabled On 09/30/2026", A, word),
      2,
    );
    // An exact quote of another attribute's, beside one of this attribute's: this one's.
    const exact = read({
      ...ANSWER,
      annotations: [
        sent(1, {
          quote: "Account Disabled On 09/30/2026",
          attribute_ids: [C],
          codes: ["C"],
        }),
        sent(2, { quote: "Something else" }),
      ],
    });
    assert.equal(numberFor("Account Disabled On 09/30/2026", A, exact), 2);
  });

  it("takes containment only among this attribute's annotations, and only where the shorter side says something by itself", () => {
    assert.equal(ASK_CONTAINED_WORDS, 3);
    assert.equal(ASK_CONTAINED_CHARACTERS, 20);
    const two = read({
      ...ANSWER,
      annotations: [
        sent(1, { kind: "IDENTIFIES", quote: "MFA Enabled Yes" }),
        sent(2, { quote: "Account Disabled Yes" }),
      ],
    });
    // "Yes" is held by both, and says nothing by itself: the first that shows A.
    assert.equal(numberFor("Yes", A, two), 2);
    // Three words held whole: taken.
    assert.equal(numberFor("Account Disabled Yes, since 09/30", A, two), 2);
    // Two short words: not enough.
    const short = read({
      ...ANSWER,
      annotations: [
        sent(1, { kind: "IDENTIFIES", quote: "Row 14" }),
        sent(2, { quote: "Employee 104582 disabled" }),
      ],
    });
    assert.equal(numberFor("Row 14", A, short), 1);
    assert.equal(numberFor("Listing row 14 of 212", A, short), 2);
    // Twenty characters or more in two words: taken.
    const long = read({
      ...ANSWER,
      annotations: [
        sent(1, {
          kind: "IDENTIFIES",
          quote: "Supercalifragilistic expialidocious",
        }),
        sent(2, { quote: "Account Disabled Yes" }),
      ],
    });
    assert.equal(
      numberFor("before Supercalifragilistic expialidocious after", A, long),
      1,
    );
  });

  it("among annotations with the same words, takes one that names the attribute, else the first", () => {
    const twice = read({
      ...ANSWER,
      annotations: [
        sent(1, {
          quote: "Status: Disabled",
          attribute_ids: [C],
          codes: ["C"],
        }),
        sent(2, {
          quote: "Status: Disabled",
          attribute_ids: [A],
          codes: ["A"],
        }),
        sent(3, {
          quote: "Status: Disabled",
          attribute_ids: [A],
          codes: ["A"],
        }),
      ],
    });
    assert.equal(numberFor("status disabled", A, twice), 2);
    assert.equal(numberFor("status disabled", C, twice), 1);
    // None names D: the passage's own words, the first listed.
    assert.equal(numberFor("status disabled", D, twice), 1);
  });

  it("takes a quote that holds the passage, or is held by it, where none is the same", () => {
    // The passage is a part of the annotation's quote.
    assert.equal(numberFor("Terminated (Effective 09/30/2026)", C), 3);
    // The annotation's quote is a part of the passage.
    assert.equal(
      numberFor(
        "Security: Account Disabled Yes, Account Expiration Date (empty)",
        A,
      ),
      4,
    );
    // Whole words only: "able" is not "Disabled".
    assert.equal(numberFor("able", B), null);
  });

  it("without a matching quote, takes the first annotation naming the attribute: what shows it before what identifies or sources it", () => {
    // A: 2 identifies, 4 and 5 show. The first that shows it.
    assert.equal(numberFor("", A), 4);
    assert.equal(numberFor("words that are in no annotation", A), 4);
    // C: 3 identifies, 5 shows.
    assert.equal(numberFor("", C), 5);
    assert.equal(numberFor("", D), 6);
    // An exception counts as showing: the first listed of the two kinds.
    const excepted = read({
      ...ANSWER,
      annotations: [
        sent(1, { kind: "IDENTIFIES" }),
        sent(2, { kind: "EXCEPTION" }),
        sent(3, { kind: "SHOWS" }),
      ],
    });
    assert.equal(numberFor("", A, excepted), 2);
    const shown = read({
      ...ANSWER,
      annotations: [
        sent(1, { kind: "SOURCE" }),
        sent(2, { kind: "SHOWS" }),
        sent(3, { kind: "EXCEPTION" }),
      ],
    });
    assert.equal(numberFor("", A, shown), 2);
    // Without either, the first listed that names the attribute at all.
    const quiet = read({
      ...ANSWER,
      annotations: [
        sent(1, { kind: "SOURCE", attribute_ids: [C], codes: ["C"] }),
        sent(2, { kind: "SOURCE" }),
        sent(3, { kind: "IDENTIFIES" }),
      ],
    });
    assert.equal(numberFor("", A, quiet), 2);
  });

  it("selects nothing where the file has no annotation for it", () => {
    // B has no annotation, and nothing has these words.
    assert.equal(numberFor("", B), null);
    assert.equal(numberFor("Nothing like this is annotated", B), null);
    assert.equal(numberFor("", ""), null);
    assert.equal(
      numberFor(
        "Account Disabled Yes",
        A,
        read({ ...ANSWER, annotations: [] }),
      ),
      null,
    );
  });

  it("only chooses: the set and its annotations are left as they were", () => {
    const set = read();
    const before = JSON.stringify(set);
    const found = annotationFor(set, { attributeId: A, quote: "" });
    assert.equal(JSON.stringify(set), before);
    assert.equal(found, at(set, 4));
  });
});

describe("the box: moving, resizing and drawing", () => {
  const box = { x: 0.2, y: 0.3, w: 0.4, h: 0.1 };
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const inside = (value: { x: number; y: number; w: number; h: number }) =>
    value.x >= 0 &&
    value.y >= 0 &&
    value.x + value.w <= 1 + 1e-9 &&
    value.y + value.h <= 1 + 1e-9;

  it("moves a box by a fraction of the page, its size kept", () => {
    const moved = moveBox(box, 0.1, -0.05);
    assert.ok(near(moved.x, 0.3) && near(moved.y, 0.25));
    assert.ok(near(moved.w, 0.4) && near(moved.h, 0.1));
  });

  it("stops a moved box at the page's edges", () => {
    for (const [dx, dy] of [
      [5, 0],
      [-5, 0],
      [0, 5],
      [0, -5],
      [5, 5],
      [-5, -5],
    ] as const) {
      const moved = moveBox(box, dx, dy);
      assert.ok(inside(moved), `${dx}, ${dy}`);
      assert.ok(near(moved.w, 0.4) && near(moved.h, 0.1));
    }
    assert.ok(
      near(moveBox(box, 5, 5).x, 0.6) && near(moveBox(box, 5, 5).y, 0.9),
    );
    assert.equal(moveBox(box, -5, -5).x, 0);
  });

  it("has eight handles, one on each corner and each side", () => {
    assert.equal(HANDLES.length, 8);
    assert.equal(new Set(HANDLES).size, 8);
    assert.deepEqual(handlePoint("nw"), { x: 0, y: 0 });
    assert.deepEqual(handlePoint("n"), { x: 0.5, y: 0 });
    assert.deepEqual(handlePoint("se"), { x: 1, y: 1 });
    assert.deepEqual(handlePoint("w"), { x: 0, y: 0.5 });
    assert.equal(
      new Set(HANDLES.map((handle) => JSON.stringify(handlePoint(handle))))
        .size,
      8,
    );
  });

  it("moves only the side a handle is on: the opposite side stays", () => {
    const east = resizeBox(box, "e", 0.1, 0.5);
    assert.ok(near(east.x, 0.2) && near(east.w, 0.5));
    assert.ok(near(east.y, 0.3) && near(east.h, 0.1));
    const west = resizeBox(box, "w", 0.1, 0.5);
    assert.ok(near(west.x, 0.3) && near(west.w, 0.3));
    assert.ok(near(west.x + west.w, 0.6));
    const north = resizeBox(box, "n", 0.5, -0.1);
    assert.ok(near(north.y, 0.2) && near(north.h, 0.2));
    assert.ok(near(north.x, 0.2) && near(north.w, 0.4));
    const corner = resizeBox(box, "se", 0.1, 0.2);
    assert.ok(near(corner.w, 0.5) && near(corner.h, 0.3));
    assert.ok(near(corner.x, 0.2) && near(corner.y, 0.3));
    const other = resizeBox(box, "nw", -0.1, -0.1);
    assert.ok(near(other.x, 0.1) && near(other.y, 0.2));
    assert.ok(near(other.w, 0.5) && near(other.h, 0.2));
  });

  it("stops a resized box at the page's edge and at the smallest size", () => {
    for (const handle of HANDLES) {
      for (const [dx, dy] of [
        [5, 5],
        [-5, -5],
        [5, -5],
        [-5, 5],
      ] as const) {
        const sized = resizeBox(box, handle, dx, dy);
        assert.ok(inside(sized), `${handle} ${dx} ${dy}`);
        assert.ok(sized.w >= MIN_BOX.w - 1e-9, `${handle} width`);
        assert.ok(sized.h >= MIN_BOX.h - 1e-9, `${handle} height`);
      }
    }
    // Dragged past its opposite side, a side stops the smallest size short of it.
    const crossed = resizeBox(box, "w", 5, 0);
    assert.ok(near(crossed.w, MIN_BOX.w) && near(crossed.x + crossed.w, 0.6));
    const flat = resizeBox(box, "s", 0, -5);
    assert.ok(near(flat.h, MIN_BOX.h) && near(flat.y, 0.3));
    assert.ok(near(resizeBox(box, "e", 5, 0).w, 0.8));
    assert.equal(resizeBox(box, "n", 0, -5).y, 0);
  });

  it("holds any box inside the page at no less than the smallest size", () => {
    assert.ok(inside(clampBox({ x: 0.95, y: 0.95, w: 0.4, h: 0.4 })));
    const tiny = clampBox({ x: 0.999, y: 0.5, w: 0, h: 0 });
    assert.ok(inside(tiny));
    assert.ok(near(tiny.w, MIN_BOX.w) && near(tiny.h, MIN_BOX.h));
    assert.deepEqual(
      clampBox({ x: Number.NaN, y: -3, w: 9, h: Number.POSITIVE_INFINITY }),
      { x: 0, y: 0, w: 1, h: MIN_BOX.h },
    );
  });

  it("draws a box between two points, in any direction, inside the page", () => {
    const drawn = drawnBox({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.3 });
    assert.ok(near(drawn.x, 0.2) && near(drawn.y, 0.3));
    assert.ok(near(drawn.w, 0.4) && near(drawn.h, 0.2));
    assert.ok(inside(drawnBox({ x: -1, y: -1 }, { x: 4, y: 4 })));
    // A tap is not a box; a drag is.
    assert.equal(isDrawn({ x: 0.2, y: 0.2 }, { x: 0.203, y: 0.2 }), false);
    assert.equal(isDrawn({ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.201 }), false);
    assert.equal(isDrawn({ x: 0.4, y: 0.4 }, { x: 0.2, y: 0.3 }), true);
  });

  it("moves a handle by the arrow keys: finer by itself, coarser with Shift", () => {
    assert.deepEqual(nudgeOf("ArrowLeft", false), { dx: -0.004, dy: 0 });
    assert.deepEqual(nudgeOf("ArrowRight", false), { dx: 0.004, dy: 0 });
    assert.deepEqual(nudgeOf("ArrowUp", true), { dx: 0, dy: -0.02 });
    assert.deepEqual(nudgeOf("ArrowDown", true), { dx: 0, dy: 0.02 });
    assert.equal(nudgeOf("Enter", false), null);
    const nudged = nudgeOf("ArrowRight", false);
    assert.ok(nudged !== null);
    assert.ok(near(resizeBox(box, "e", nudged.dx, nudged.dy).w, 0.404));
  });

  it("takes the one box around an annotation's boxes", () => {
    assert.equal(boundsOf([]), null);
    const around = boundsOf([
      { x: 0.2, y: 0.3, w: 0.4, h: 0.02 },
      { x: 0.1, y: 0.33, w: 0.2, h: 0.02 },
    ]);
    assert.ok(around !== null);
    assert.ok(near(around.x, 0.1) && near(around.y, 0.3));
    assert.ok(near(around.w, 0.5) && near(around.h, 0.05));
  });

  it("joins a PDF's runs into one box per line, at most eight", () => {
    const lines = lineBoxes([
      { x: 0.5, y: 0.101, w: 0.2, h: 0.02 },
      { x: 0.1, y: 0.1, w: 0.3, h: 0.02 },
      { x: 0.1, y: 0.14, w: 0.6, h: 0.02 },
    ]);
    assert.equal(lines.length, 2);
    assert.ok(near(lines[0]?.x ?? 0, 0.1) && near(lines[0]?.w ?? 0, 0.6));
    assert.equal(
      lineBoxes(
        Array.from({ length: 20 }, (_, line) => ({
          x: 0.1,
          y: 0.04 * line,
          w: 0.5,
          h: 0.02,
        })),
      ).length,
      8,
    );
  });
});

describe("the boxes on the page in view", () => {
  it("uses the server's boxes on an image, each on its annotation", () => {
    const set = read();
    const marks = pageMarks(set.annotations, null);
    assert.equal(marks.length, 7);
    assert.deepEqual(marks[4], { id: id(5), rects: at(set, 5).rects });
    assert.equal(unboxedLine(set.annotations, null, marks), null);
  });

  it("boxes a text PDF from the runs its quote covers, on the annotation's page only", () => {
    const set = read({
      ...ANSWER,
      positions: false,
      annotations: [
        sent(1, { rects: [], page: 1 }),
        sent(2, { rects: [], page: 2 }),
        // A box a person drew is the server's own, whatever the text says.
        sent(3, { rects: [[0.1, 0.1, 0.2, 0.05]], page: 2 }),
      ],
    });
    const found = [
      { box: { x: 0.1, y: 0.2, w: 0.2, h: 0.02 }, index: 1 },
      { box: { x: 0.32, y: 0.2, w: 0.2, h: 0.02 }, index: 1 },
      { box: { x: 0.5, y: 0.5, w: 0.2, h: 0.02 }, index: 2 },
    ];
    const marks = pageMarks(set.annotations, 2, found);
    assert.deepEqual(
      marks.map((mark) => mark.rects.length),
      [0, 1, 1],
    );
    assert.ok(Math.abs((marks[1]?.rects[0]?.w ?? 0) - 0.42) < 1e-9);
    assert.deepEqual(marks[2]?.rects, [{ x: 0.1, y: 0.1, w: 0.2, h: 0.05 }]);
    // Page 1 shows only its own annotation, and it has no box there yet.
    assert.deepEqual(
      pageMarks(set.annotations, 1, []).map((mark) => mark.rects.length),
      [0, 0, 0],
    );
  });

  it("says in one quiet line that annotations are listed without boxes", () => {
    const none = read({
      ...ANSWER,
      positions: false,
      annotations: [sent(1, { rects: [] }), sent(2, { rects: [] })],
    });
    assert.equal(
      unboxedLine(none.annotations, null, pageMarks(none.annotations, null)),
      "The annotations are listed without boxes: where their words sit in this file is not known.",
    );
    const some = read({
      ...ANSWER,
      annotations: [sent(1), sent(2, { rects: [] }), sent(3, { rects: [] })],
    });
    assert.equal(
      unboxedLine(some.annotations, null, pageMarks(some.annotations, null)),
      "2 annotations are listed without a box: where their words sit in this file is not known.",
    );
    const one = read({
      ...ANSWER,
      annotations: [sent(1), sent(2, { rects: [] })],
    });
    assert.match(
      unboxedLine(one.annotations, null, pageMarks(one.annotations, null)) ??
        "",
      /^1 annotation is listed without a box/,
    );
    // Only the page in view is counted.
    const paged = read({
      ...ANSWER,
      annotations: [sent(1, { page: 1 }), sent(2, { rects: [], page: 2 })],
    });
    assert.equal(
      unboxedLine(paged.annotations, 1, pageMarks(paged.annotations, 1)),
      null,
    );
  });

  it("hands the annotations to the text viewers as cited passages, by number", () => {
    const set = read();
    const citations = annotationCitations(set, "account.pdf");
    assert.equal(citations.length, 7);
    assert.deepEqual(citations[4], {
      fileId: FILE,
      fileName: "account.pdf",
      quote: "Account Disabled On 09/30/2026 11:59:00 PM PT",
      found: true,
      location: "",
      page: 1,
      box: null,
      label: "5",
    });
  });
});

describe("what each action sends", () => {
  const set = read();
  const base = {
    organization_id: ORG,
    project_id: PROJECT,
    control_id: CONTROL,
    requirement_id: REQUEST,
    file_id: FILE,
  };
  const path = `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/evidence-annotations`;

  it("reads a file's annotations by the control, the request and the file", () => {
    const query = annotationsQuery(SCOPE);
    assert.equal(
      annotationReadPath(new URLSearchParams(query)),
      `${path}?requirement_id=${REQUEST}&file_id=${FILE}`,
    );
    for (const key of [
      "organization",
      "project",
      "control",
      "requirement",
      "file",
    ]) {
      const params = new URLSearchParams(query);
      params.set(key, "../../admin");
      assert.equal(annotationReadPath(params), null, key);
      params.delete(key);
      assert.equal(annotationReadPath(params), null, key);
    }
  });

  it("confirms one annotation at the version the person saw", () => {
    const fields = annotationFields(SCOPE, {
      intent: "confirm",
      id: id(5),
      version: 1,
    });
    assert.deepEqual(fields, {
      ...base,
      intent: "confirm",
      annotation_id: id(5),
      version: 1,
    });
    assert.deepEqual(annotationWrite(fields), {
      path: `${path}/${id(5)}/confirm`,
      body: { version: 1 },
    });
  });

  it("confirms every proposal of the file as one decision", () => {
    const fields = annotationFields(SCOPE, { intent: "confirm-all" });
    assert.deepEqual(fields, { ...base, intent: "confirm-all" });
    assert.deepEqual(annotationWrite(fields), {
      path: `${path}/confirm-all`,
      body: { requirement_id: REQUEST, file_id: FILE },
    });
  });

  it("removes one annotation at its version", () => {
    assert.deepEqual(
      annotationWrite(
        annotationFields(SCOPE, { intent: "remove", id: id(4), version: 7 }),
      ),
      { path: `${path}/${id(4)}/remove`, body: { version: 7 } },
    );
  });

  it("sends only what an edit changed", () => {
    const annotation = at(set, 5);
    const draft = draftOf(annotation);
    assert.deepEqual(draft.box, annotation.rects[0]);
    // Nothing changed, or no sentence left: nothing to send.
    assert.equal(editChanges(annotation, draft), null);
    assert.equal(editChanges(annotation, { ...draft, statement: "   " }), null);
    assert.equal(
      editChanges(annotation, {
        ...draft,
        statement: `  ${annotation.statement}  `,
        attributeIds: [C, A],
      }),
      null,
    );

    const sentence = editChanges(annotation, {
      ...draft,
      statement: "Disabled the same day the termination took effect.",
    });
    assert.deepEqual(sentence, {
      statement: "Disabled the same day the termination took effect.",
    });
    assert.ok(sentence !== null);
    assert.deepEqual(
      annotationWrite(
        annotationFields(SCOPE, {
          intent: "edit",
          id: annotation.id,
          version: annotation.version,
          changes: sentence,
        }),
      ),
      {
        path: `${path}/${id(5)}/edit`,
        body: {
          version: 1,
          statement: "Disabled the same day the termination took effect.",
        },
      },
    );

    const letters = editChanges(annotation, { ...draft, attributeIds: [A] });
    assert.deepEqual(letters, { attributeIds: [A] });

    const moved = editChanges(annotation, {
      ...draft,
      box: resizeBox(draft.box ?? { x: 0, y: 0, w: 1, h: 1 }, "e", 0.05, 0),
    });
    assert.ok(moved !== null && moved.rects !== undefined);
    assert.deepEqual(Object.keys(moved), ["rects"]);
    const write = annotationWrite(
      annotationFields(SCOPE, {
        intent: "edit",
        id: annotation.id,
        version: annotation.version,
        changes: moved,
      }),
    );
    assert.deepEqual(write, {
      path: `${path}/${id(5)}/edit`,
      body: { version: 1, rects: [[0.0368, 0.4806, 0.4236, 0.0223]] },
    });
  });

  it("adjusts several boxes as the one around them, and none where there is none", () => {
    const lines = read({
      ...ANSWER,
      annotations: [
        sent(1, {
          rects: [
            [0.2, 0.3, 0.4, 0.02],
            [0.1, 0.33, 0.2, 0.02],
          ],
        }),
        sent(2, { rects: [] }),
      ],
    });
    const box = draftOf(at(lines, 1)).box;
    assert.ok(box !== null);
    assert.ok(Math.abs(box.x - 0.1) < 1e-9 && Math.abs(box.w - 0.5) < 1e-9);
    const bare = draftOf(at(lines, 2));
    assert.equal(bare.box, null);
    assert.deepEqual(
      editChanges(at(lines, 2), { ...bare, statement: "Reworded." }),
      { statement: "Reworded." },
    );
  });

  it("adds a person's own annotation: the page, the box, the sentence, the attributes, the kind", () => {
    const fields = annotationFields(SCOPE, {
      intent: "add",
      page: 1,
      rects: [{ x: 0.12345678, y: 0.2, w: 0.3, h: 0.05 }],
      statement: "The reviewer's name is on the ticket.",
      attributeIds: [A, C],
      kind: "IDENTIFIES",
    });
    assert.deepEqual(annotationWrite(fields), {
      path,
      body: {
        requirement_id: REQUEST,
        file_id: FILE,
        page: 1,
        rects: [[0.1235, 0.2, 0.3, 0.05]],
        statement: "The reviewer's name is on the ticket.",
        attribute_ids: [A, C],
        kind: "IDENTIFIES",
      },
    });
    assert.deepEqual(rectsOf([{ x: 0.5, y: 0.25, w: 0.125, h: 0.0625 }]), [
      [0.5, 0.25, 0.125, 0.0625],
    ]);
  });

  it("refuses anything that is not a well-formed action, before the API is called", () => {
    const invalid = { error: "invalid" };
    const confirm = {
      ...base,
      intent: "confirm",
      annotation_id: id(5),
      version: 1,
    };
    assert.ok("path" in annotationWrite(confirm));
    for (const fields of [
      {},
      { ...confirm, intent: "approve" },
      { ...confirm, intent: undefined },
      { ...confirm, organization_id: "../admin" },
      { ...confirm, control_id: null },
      { ...confirm, annotation_id: `${id(5)}/../../x` },
      { ...confirm, version: "1" },
      { ...confirm, version: -1 },
      { ...confirm, version: 0 },
      { ...confirm, version: 1.5 },
      // An edit that changes nothing.
      { ...confirm, intent: "edit" },
      { ...confirm, intent: "edit", statement: "  " },
      { ...confirm, intent: "edit", statement: "x".repeat(401) },
      { ...confirm, intent: "edit", attribute_ids: ["A"] },
      { ...confirm, intent: "edit", rects: [] },
      { ...confirm, intent: "edit", rects: [[0.9, 0.9, 0.5, 0.5]] },
      {
        ...confirm,
        intent: "edit",
        rects: Array(9).fill([0.1, 0.1, 0.1, 0.1]),
      },
    ]) {
      assert.deepEqual(
        annotationWrite(fields),
        invalid,
        JSON.stringify(fields),
      );
    }
    const add = {
      ...base,
      intent: "add",
      page: 1,
      rects: [[0.1, 0.2, 0.3, 0.05]],
      statement: "A sentence.",
      attribute_ids: [],
      kind: "SHOWS",
    };
    assert.ok("path" in annotationWrite(add));
    for (const over of [
      { page: 0 },
      { page: "1" },
      { rects: [] },
      { rects: [[0.1, 0.2, 0.3]] },
      { rects: "all" },
      { statement: "" },
      { statement: 7 },
      { attribute_ids: ["a"] },
      { attribute_ids: null },
      { kind: "OTHER" },
      { kind: "shows" },
      { file_id: "file" },
    ]) {
      assert.deepEqual(
        annotationWrite({ ...add, ...over }),
        invalid,
        JSON.stringify(over),
      );
    }
  });

  it("says a refusal in the server's own sentence, and what to do where it gives none", () => {
    assert.equal(annotationProblem(200), null);
    assert.equal(
      annotationProblem(
        409,
        "This annotation changed since the page loaded. Refresh and try again.",
      ),
      "This annotation changed since the page loaded. Refresh and try again.",
    );
    assert.equal(
      annotationProblem(409, "the engagement is archived"),
      "the engagement is archived.",
    );
    assert.match(annotationProblem(409) ?? "", /changed since the page loaded/);
    assert.equal(
      annotationProblem(422, "The box covers no words of the file."),
      "The box covers no words of the file.",
    );
    assert.match(
      annotationProblem(422) ?? "",
      /Check the sentence and the box/,
    );
    assert.match(
      annotationProblem(403, "forbidden") ?? "",
      /^Your role cannot/,
    );
    assert.match(annotationProblem(404) ?? "", /no longer here/);
    for (const status of [0, 500, 502]) {
      assert.match(
        annotationProblem(status, "Traceback…") ?? "",
        /Nothing was saved/,
      );
    }
  });

  it("says what was done once the server has confirmed it", () => {
    assert.equal(
      doneWords({ intent: "confirm", id: id(5), version: 1 }, { number: 5 }),
      "Annotation 5 confirmed.",
    );
    assert.equal(
      doneWords({ intent: "confirm-all" }, { count: 5 }),
      "5 annotations confirmed.",
    );
    assert.equal(
      doneWords({ intent: "confirm-all" }, { count: 1 }),
      "1 annotation confirmed.",
    );
    assert.equal(
      doneWords(
        { intent: "edit", id: id(5), version: 1, changes: {} },
        { number: 5 },
      ),
      "Annotation 5 saved.",
    );
    assert.equal(
      doneWords({ intent: "remove", id: id(5), version: 1 }, { number: 5 }),
      "Annotation 5 removed. It stays on record.",
    );
    assert.equal(
      doneWords({
        intent: "add",
        page: 1,
        rects: [],
        statement: "",
        attributeIds: [],
        kind: "SHOWS",
      }),
      "Annotation added.",
    );
  });
});

describe("the annotated copy", () => {
  it("is offered for an image with annotations, and for nothing else", () => {
    const set = read();
    assert.equal(copyOffered("3_ex-b-account-disabled.png", set), true);
    assert.equal(copyOffered("shot.JPEG", set), true);
    assert.equal(copyOffered("ticket.pdf", set), false);
    assert.equal(copyOffered("listing.xlsx", set), false);
    assert.equal(
      copyOffered("shot.png", read({ ...ANSWER, annotations: [] })),
      false,
    );
  });

  it("is named after the file", () => {
    assert.equal(
      annotatedCopyName("3_ex-b-account-disabled.png"),
      "3_ex-b-account-disabled (annotated).png",
    );
    assert.equal(
      annotatedCopyName("Q3 access.review.JPG"),
      "Q3 access.review (annotated).png",
    );
    assert.equal(annotatedCopyName("a/b\\c:d.png"), "a b c d (annotated).png");
    assert.equal(annotatedCopyName(""), "Evidence (annotated).png");
  });

  it("lists each annotation with its letters, its sentence and who reviewed it", () => {
    const rows = copyRows(read());
    assert.equal(rows.length, 7);
    assert.deepEqual(rows[4], {
      number: 5,
      kind: "SHOWS",
      letters: "A, C",
      statement:
        "Disabled on 09/30/2026 at 11:59 PM PT, the same day the termination took effect.",
      // A proposal is never passed off as reviewed.
      review: "Proposed by the agent, not reviewed by a person",
    });
    assert.equal(rows[0]?.review, "Confirmed by Dana Lee on Nov 14, 2026");
    assert.equal(rows[0]?.letters, "");
    assert.equal(rows[6]?.review, "Edited by Dana Lee on Nov 14, 2026");
  });

  it("breaks a sentence into lines no wider than the legend", () => {
    const measure = (text: string) => text.length;
    assert.deepEqual(wrapText("one two three four five", 9, measure), [
      "one two",
      "three",
      "four five",
    ]);
    assert.deepEqual(wrapText("unbreakablylongword tail", 5, measure), [
      "unbreakablylongword",
      "tail",
    ]);
    assert.deepEqual(wrapText("  ", 10, measure), []);
  });
});

describe("the screen's own files", () => {
  const view = readFileSync("apps/web/src/evidence-annotations.tsx", "utf8");
  // Changed 14 November 2026 (docs/evidence-annotations.md, section 5a). Old: the old
  // viewer and its openers in evidence-preview.tsx. New: that file is gone; the openers
  // are evidence-opener.tsx, and every file is drawn by the one viewer (`view`) and its
  // stages (evidence-stages.tsx).
  const preview = readFileSync("apps/web/src/evidence-opener.tsx", "utf8");
  const stages = readFileSync("apps/web/src/evidence-stages.tsx", "utf8");
  const list = readFileSync("apps/web/src/design-evidence.tsx", "utf8");
  const dialog = readFileSync("apps/web/src/evidence-dialog.tsx", "utf8");
  const route = readFileSync(
    "apps/web/app/workspace/evidence-annotations/route.ts",
    "utf8",
  );
  const css = readFileSync("apps/web/app/evidence-annotations.css", "utf8");
  const tokens = readFileSync("apps/web/app/globals.css", "utf8");
  const layout = readFileSync("apps/web/app/layout.tsx", "utf8");
  /** A function's source: from its declaration to the next top-level one. */
  const component = (source: string, name: string) => {
    const from = source.search(
      new RegExp(`\\n(?:export )?(?:async )?function ${name}\\b`),
    );
    assert.ok(from >= 0, name);
    const next = source
      .slice(from + 1)
      .search(/\n(?:export )?(?:async )?(?:function |const [A-Z_]+\b|type )/);
    return source.slice(from, next < 0 ? undefined : from + 1 + next);
  };

  it("offers the actions only to a person who may edit", () => {
    // Each action's component is rendered once, and only under `set.canEdit`.
    for (const [name, guard] of [
      ["ReviewActions", /set\.canEdit \? \(\s*<ReviewActions\b/],
      [
        "ConfirmAll",
        /set\.canEdit && counts\.proposed > 0 \? \(\s*<ConfirmAll\b/,
      ],
      ["AddAnnotation", /set\.canEdit && drawable \? \(\s*<AddAnnotation\b/],
    ] as const) {
      assert.equal(view.match(new RegExp(`<${name}\\b`, "g"))?.length, 1, name);
      assert.match(view, guard, name);
    }
    // The basis itself holds no action: it shows the ones it is handed, or none.
    const basis = component(view, "Basis");
    for (const word of [
      "Confirm &amp; next",
      "onConfirm",
      "onEdit",
      "onRemove",
    ]) {
      assert.ok(!basis.includes(word), word);
    }
    assert.match(basis, /\{actions\}/);
    assert.match(component(view, "ReviewActions"), /Confirm &amp; next/);
    // The form an edit opens is reached only through Edit, and saving is refused below.
    // And each handler refuses by itself for a reader, whatever is on screen.
    const body = component(view, "AnnotatedEvidence");
    for (const name of [
      "confirm",
      "confirmAll",
      "saveEdit",
      "remove",
      "saveAdd",
    ]) {
      const from = body.indexOf(`async function ${name}(`);
      assert.ok(from >= 0, name);
      assert.match(
        body.slice(from, from + 420),
        /if \(\s*!set\.canEdit \|\|/,
        name,
      );
    }
    // Changed 14 November 2026 (section 5a). Old: the dialog had its own "Add
    // annotation" button for a file with none yet, under `notes.set?.canEdit === true`.
    // New: the viewer's one AddAnnotation (asserted above, under `set.canEdit &&
    // drawable`) serves a file with none too, and no opener draws a second.
    assert.ok(!/Add annotation/.test(preview));
    // A file of no D&I request has no annotations to act on: nothing is offered.
    assert.match(
      view,
      /const set = useMemo\(\(\) => given \?\? noAnnotations\(file\.id\), \[given, file\.id\]\);/,
    );
  });

  it("shows a review as done only once the server has answered", () => {
    const body = component(view, "AnnotatedEvidence");
    // What was done is said after the answer, and only for an answer that confirmed it.
    const run = body.slice(body.indexOf("async function run("));
    assert.match(
      run,
      /const result = await act\(action\);\s*sending\.current = false;\s*if \(result\.ok\) \{\s*setDone\(doneWords\(action, about\)\);/,
    );
    assert.equal(body.match(/setDone\(doneWords\(/g)?.length, 1);
    // One action at a time: a key held down sends once.
    assert.match(run, /if \(sending\.current\) \{\s*return null;\s*\}/);
    // The selection moves on, and a form closes, only after it too.
    assert.match(
      body,
      /if \(result\?\.ok\) \{\s*setSelectedId\(next \?\? annotation\.id\);/,
    );
    assert.match(body, /if \(result\?\.ok\) \{\s*setMode\(VIEW\);/);
    // The list on screen is only ever a list the server returned, read by the parser:
    // nothing is marked confirmed, edited or removed in the browser.
    const hook = component(view, "useEvidenceAnnotations");
    assert.match(
      hook,
      /const set = status === 200 \? parseAnnotations\(result\) : null;/,
    );
    assert.match(hook, /const confirmed = parseAnnotations\(result\);/);
    const shown = [...hook.matchAll(/setLoaded\(\{[^}]*\}\)/g)].map((call) =>
      call[0].replace(/\s+/g, " "),
    );
    assert.deepEqual(shown, [
      'setLoaded({ key, status: "ready", set })',
      'setLoaded({ key, status: status === 404 || status === 403 ? "absent" : "failed", set: null, })',
      'setLoaded({ key, status: "ready", set: confirmed })',
    ]);
    assert.equal(view.match(/setLoaded\(/g)?.length, 3);
    assert.ok(
      !/status: "CONFIRMED"|status: "EDITED"|status: "REMOVED"/.test(view),
    );
    // A refusal is shown in the server's words, and a stale one reads only the list again.
    assert.match(hook, /const problem = annotationProblem\(status, detail\);/);
    assert.match(
      hook,
      /if \(status === 409 \|\| status === 404\) \{[^}]*read\(true\)/,
    );
    // No page reload, and no page data read again: the dialog and the selection stay.
    assert.ok(
      !/router\.refresh|useRouter|location\.reload|window\.location/.test(view),
    );
    // The latest answer wins.
    assert.match(hook, /if \(run !== latest\.current\) \{\s*return;/);
  });

  it("calls the API only through the proxy route, with the session", () => {
    assert.equal(view.match(/fetch\(/g)?.length, 2);
    assert.match(view, /fetch\(`\/workspace\/evidence-annotations\?\$\{key\}`/);
    assert.match(
      view,
      /fetch\("\/workspace\/evidence-annotations", \{\s*method: "POST"/,
    );
    assert.match(
      route,
      /annotationReadPath\(new URL\(request\.url\)\.searchParams\)/,
    );
    assert.match(
      route,
      /const write = annotationWrite\(fields\);\s*if \("error" in write\) \{\s*return NextResponse\.json\(\{ status: 422/,
    );
    assert.match(route, /headers\.set\("cookie", `aw_session=\$\{session\}`\)/);
    assert.match(route, /export async function GET/);
    assert.match(route, /export async function POST/);
  });

  it("leaves the preview as it was for a file that is on no D&I request", () => {
    // Nothing is asked without the request: no scope, so no call.
    assert.match(
      preview,
      /controlId === undefined \|\|\s*requirementId === undefined \|\|\s*shownId === undefined\s*\? null/,
    );
    assert.match(preview, /const notes = useEvidenceAnnotations\(scope\);/);
    const hook = component(view, "useEvidenceAnnotations");
    assert.match(
      hook,
      /const key = scope === null \? "" : annotationsQuery\(scope\);/,
    );
    assert.match(hook, /if \(key === ""\) \{\s*return;\s*\}\s*const run/);
    assert.match(
      hook,
      /if \(key === ""\) \{\s*return \{ status: "off", set: null, busy: null, act \};/,
    );
    // Changed 14 November 2026 (section 5a, "One evidence viewer"). Old: the annotated
    // layout only with annotations in hand, else the old viewer (EvidenceViewer, Viewer,
    // Highlight, ImageViewer) with its list of cited passages. New: one viewer for every
    // file; the legend of annotations only with annotations in hand (or one being drawn),
    // the cited passages beside them, and a file with neither shown by itself.
    assert.match(
      view,
      /const annotated =\s*given !== null &&\s*\(annotations\.length > 0 \|\| active\.kind === "draw" \|\| active\.kind === "add"\);/,
    );
    assert.match(
      view,
      /const withPanel = loading \|\| annotated \|\| cited\.length > 0;/,
    );
    // Changed 14 November 2026 (section 5b). Old: a file with nothing in its legend was
    // shown by itself (`is-plain`). New: also only where no "About this file" is beside
    // it, the panel's second tab.
    assert.match(
      view,
      /ea-body\$\{withPanel \|\| about !== null \? "" : " is-plain"\}/,
    );
    // Both openers draw that viewer, and nothing else.
    assert.equal(preview.match(/<AnnotatedEvidence\b/g)?.length, 2);
    assert.equal(
      /<(EvidenceViewer|PreviewDialog|Viewer|Highlight|ImageViewer)\b/.test(
        preview,
      ),
      false,
    );
    // Today's ways of showing a file are all still there, under the one viewer.
    for (const kept of [
      "<ImageStage",
      "<PdfStage",
      "<TextStage",
      'citedBy = "What the tester relied on"',
      "Boxed on the image; the words were not read by OCR.",
    ]) {
      assert.ok(view.includes(kept), kept);
    }
    assert.ok(preview.includes('sourcesTitle = "What the tester relied on"'));
    assert.ok(stages.includes("pdfRuns("));
    assert.ok(stages.includes("readingBlocks(text)"));
    // A PDF always draws the viewer's layer over the page it shows.
    assert.match(stages, /\{layer\(\s*boxedPage === page \? boxes : \[\],/);
    // A load that failed says so in one quiet line, under the file as it always was.
    assert.match(
      view,
      /\{status === "failed" \? \(\s*<p className="ea-hint">\s*The annotations could not be loaded\. The file is shown without\s*them\.\s*<\/p>/,
    );
    // No annotations, or none this person may read, is silent.
    assert.match(
      hook,
      /status === 404 \|\| status === 403 \? "absent" : "failed"/,
    );
    // Only the D&I list hands a request on: since item 9 (14 November 2026) every opener
    // of the D&I list opens the evidence reviewer with the request (no standalone
    // preview is drawn in the list any more), and the reviewer shows the annotations,
    // inline and in its full view.
    const callers = [
      "sheet-view",
      "controls-view",
      "evidence-view",
      "evidence-wizard",
      "console-chat",
      "evidence-workspace-view",
    ];
    for (const name of callers) {
      const source = readFileSync(`apps/web/src/${name}.tsx`, "utf8");
      assert.ok(!/annotations=\{/.test(source), name);
    }
    assert.equal(/<EvidencePreview\b|<PreviewButton\b/.test(list), false);
    assert.match(
      list,
      /item\.phase === "DESIGN"\s*\? \{\s*requirementId: item\.id,\s*\.\.\.\(annotation === undefined \? \{\} : \{ annotation \}\),\s*\}/,
    );
    assert.match(
      list,
      /item\.phase === "DESIGN"\s*\? \[\s*\{\s*label: "Annotations",\s*onSelect: \(\) => openFile\(file\.fileId\),/,
    );
    // Changed 14 November 2026 (docs/evidence-annotations.md, section 5b). Old: the file's
    // name opened the reviewer with `{ requirementId: item.id }` on a D&I request, and the
    // reviewer read that request's annotations for its file (`open.mode === "review"`).
    // New: the reviewer's review mode is gone; the file's name opens the one viewer
    // through `openFile`, which hands the request on in the same way (above), and the
    // dialog only adds evidence, its file shown without a request's annotations.
    assert.match(list, /onClick=\{\(\) => openFile\(file\.fileId\)\}/);
    assert.ok(!/open\.mode === "review"|mode: "review"/.test(dialog));
    assert.ok(!/annotations=\{/.test(dialog));
    // The reviewer's head holds the annotated view's actions before the expand icon, on
    // one line: a fourth column only while the slot holds something.
    assert.match(
      dialog,
      /<span className="ed-view-notes" ref=\{setNotesSlot\} \/>\s*<PreviewButton\b/,
    );
    const head = readFileSync("apps/web/app/evidence-dialog.css", "utf8");
    assert.match(
      head,
      /\.ed-view-head:has\(> \.ed-view-notes:not\(:empty\)\) \{\s*grid-template-columns: auto minmax\(0, 1fr\) auto auto;\s*\}/,
    );
    assert.match(
      head,
      /\.ed-view-head > \.ed-view-notes:empty \{\s*display: none;\s*\}/,
    );
  });

  it("closes the callout on Escape before the dialog, and keeps the keys out of a field", () => {
    const body = component(view, "AnnotatedEvidence");
    assert.match(body, /document\.addEventListener\("keydown", onKey, true\)/);
    assert.match(
      body,
      /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/,
    );
    // Changed 14 November 2026 (section 5a: keyboard use kept in every caller). Old: the
    // dialog closed only on an Escape no one had cancelled, so inside the evidence
    // wizard's window (which cancels Escape's default to stay open) neither the callout
    // nor the dialog closed by Escape. New: the viewer's own Escape stops where it is
    // taken (above), so the dialog hears only one nothing inside took, cancelled or not.
    assert.match(
      preview,
      /if \(event\.key === "Escape" && isTopmostDialog\(dialog\.current\)\) \{\s*onClose\(\);/,
    );
    assert.match(
      body,
      /here === null \|\|\s*\(event\.defaultPrevented && event\.key !== "Escape"\)/,
    );
    // Changed 14 November 2026 (section 5b). Old: the selector was written in the key
    // handler, for fields and a box's handles. New: it is KEYS_OF_THEIR_OWN, which adds
    // the side panel's tabs (their arrows move between them) and "About this file".
    assert.match(
      body,
      /if \(target\?\.closest\(KEYS_OF_THEIR_OWN\)\) \{\s*return;/,
    );
    assert.match(
      view,
      /const KEYS_OF_THEIR_OWN =\s*'input, textarea, select, \[contenteditable\], \[data-handle\], \[role="tablist"\], \.ea-about, \.ea-data';/,
    );
    // Enter on a button or a link is that control's own.
    assert.match(
      body,
      /event\.key === "Enter" && !target\?\.closest\("button, a, summary"\)/,
    );
    assert.match(
      body,
      // Changed 14 November 2026 (section 5a): the selection may be a cited passage, which
      // has nothing to confirm, so Enter confirms only an annotation proposed.
      // Changed again 14 November 2026 (review of the one viewer, item 4a). Old: Enter
      // confirmed any proposed annotation selected, so one Enter after the viewer opened
      // on a citation merged into an annotation confirmed an audit record nobody chose.
      // New: not one the viewer was opened on (`asked`): the person selects it, or presses
      // Confirm, first.
      /selected !== null &&\s*!asked &&\s*set\.canEdit &&\s*selected\.status === "PROPOSED"\s*\) \{\s*stop\(\);\s*confirm\(selected\)/,
    );
  });

  it("draws the boxes in colours that hold on any evidence, in both themes", () => {
    // Over the evidence: the --mark tokens, one value in both themes, in a white ring.
    const value = (block: string, name: string) =>
      new RegExp(`${name}: (#[0-9a-f]{6});`).exec(block)?.[1];
    const dark = tokens.slice(tokens.indexOf(':root[data-theme="dark"]'));
    const light = tokens.slice(0, tokens.indexOf(':root[data-theme="dark"]'));
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((from) => {
        const c = Number.parseInt(hex.slice(from, from + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    };
    assert.equal(value(light, "--mark-paper"), "#ffffff");
    for (const name of Object.values(MARK_TOKEN)) {
      const colour = value(light, name);
      assert.ok(colour !== undefined, name);
      assert.equal(value(dark, name), colour, `${name} is the same in dark`);
      // 4.5:1 against the white ring and under the white number of its tickmark.
      assert.ok(1.05 / (luminance(colour) + 0.05) >= 4.5, `${name} on white`);
    }
    assert.match(
      css,
      /button\.ea-box \{[^}]*border: 2px solid var\(--ea-mark\);[^}]*box-shadow: 0 0 0 1\.5px var\(--mark-paper\);/,
    );
    assert.match(
      css,
      /\.ea-tick \{[^}]*left: -27px;[^}]*background: var\(--ea-mark\);[^}]*box-shadow: 0 0 0 2px var\(--mark-paper\);/,
    );
    // No colour of its own: tokens only.
    assert.equal(css.match(/#[0-9a-f]{3,8}\b|rgb\(/gi), null);
    // Motion within the documented durations, and off under reduced motion.
    for (const [, time] of css.matchAll(
      /(?:transition|animation):[^;]*?(\d+)ms/g,
    )) {
      assert.ok(Number(time) <= 300, `${time}ms`);
    }
    assert.match(
      css,
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.ea-callout,\s*\.ea-skel \{\s*animation: none;/,
    );
    // The callout is laid over the evidence, so opening it moves nothing.
    assert.match(css, /\.ea-callout \{\s*position: absolute;/);
    // Under 960px the legend goes under the evidence; the sheet stays along the bottom.
    assert.match(
      css,
      /@media \(max-width: 960px\) \{[\s\S]*\.ea-sheet-host\.is-end \{\s*position: sticky;/,
    );
    // The script picks the sheet's place at the same width the stylesheet stacks at.
    assert.match(view, /const STACKED_BELOW = 960;/);
    assert.match(
      view,
      /useViewportWidth\(\) <= STACKED_BELOW \? endHost : footHost/,
    );
    assert.match(
      layout,
      /import "\.\/evidence-annotations\.css";\n\/\/ Last: the glass layer/,
    );
  });

  it("takes hold of a handle by mouse, touch and keyboard", () => {
    const layer = component(view, "Layer");
    for (const handler of [
      "onPointerDown",
      "onPointerMove",
      "onPointerUp",
      "onPointerCancel",
      "onKeyDown",
    ]) {
      assert.ok(layer.includes(`${handler}:`), handler);
    }
    assert.match(layer, /setPointerCapture\(event\.pointerId\)/);
    assert.match(layer, /\{HANDLES\.map\(\(handle\) => \{/);
    assert.match(layer, /nudgeOf\(event\.key, event\.shiftKey\)/);
    assert.match(css, /button\.ea-handle \{[^}]*touch-action: none;/);
    assert.match(css, /\.ea-draw \{[^}]*touch-action: none;/);
    // Drawing has a way that needs no drag.
    assert.match(view, /Place a box to adjust/);
  });
});
