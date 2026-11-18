import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DW_SECTION } from "../apps/web/src/design-workpaper-model.ts";
import {
  anchorOf,
  attributeKey,
  CONCLUSION,
  choiceCounts,
  cleanQuote,
  closedLine,
  closedWord,
  contextOf,
  countsOf,
  criticalityForKey,
  documentOrder,
  eventWords,
  FIELD_KEY,
  fieldTextsOf,
  filterNotes,
  findAnchor,
  firstWords,
  GONE_WORDS,
  groupsOf,
  headLine,
  historyOf,
  isClosed,
  isFiltered,
  isMine,
  isOpen,
  isRetiredField,
  NO_FILTERS,
  NOTE_BOUNDS,
  noteFields,
  notesHref,
  notesProblem,
  notesReadPath,
  noteTextProblem,
  openLine,
  type PaperFields,
  paintedOf,
  parseFilters,
  parseNote,
  parseReviewNotes,
  passageOf,
  piecesOf,
  placeOf,
  pointKey,
  positionsOf,
  RAIL_START,
  type ReviewNote,
  railFiltered,
  railNotes,
  reasonProblem,
  replyCount,
  replyMode,
  replyProblem,
  reportKey,
  reviewNoteWrite,
  richPlain,
  SECTIONS,
  STALE,
  STARTING_FILTERS,
  searchHit,
  sectionOf,
  selectionTooLong,
  TOO_LONG_WORDS,
  tabCount,
  threadEvents,
  threadTag,
  timeLabel,
  UNDERSTANDING,
  WRITE_IN_DOUBT,
  walkthroughColumnsOf,
  walkthroughKey,
  whereLine,
  whereWords,
  withNote,
  wordsGone,
  writeInDoubt,
} from "../apps/web/src/review-notes-model.ts";

// Workpaper review notes (docs/workpaper-review.md, sections 3 to 6), as the page reads
// them. Synthetic data only.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = uuid(1);
const PROJECT = uuid(2);
const PAPER = uuid(3);
const RILEY = uuid(10);
const DANA = uuid(11);
const SAM = uuid(12);
const ATTR_C = uuid(30);
const ATTR_D = uuid(31);
const FILE_E7 = uuid(70);
const POINT_C = "c".repeat(32);
const POINT_FILE = "f".repeat(32);
const POINT_REQUEST = "e".repeat(32);

const CAN_ALL = {
  reply: true,
  respond: true,
  clear: true,
  reopen: false,
  dismiss: true,
  criticality: true,
  owner: true,
};

/** A note as the server sends it. */
function raw(n: number, over: Record<string, unknown> = {}) {
  return {
    id: uuid(100 + n),
    number: n,
    anchor_kind: "FIELD",
    field: UNDERSTANDING,
    quote: "",
    prefix: "",
    suffix: "",
    occurrence: 0,
    workpaper_version: 4,
    text: `Note number ${n} says something.`,
    criticality: "NORMAL",
    status: "OPEN",
    owner: { id: DANA, name: "Dana Lee" },
    raised_by: { id: RILEY, name: "Riley Park" },
    raised_at: "2026-11-15T14:04:00Z",
    cleared_by: null,
    cleared_at: null,
    dismissed_by: null,
    dismissed_at: null,
    dismiss_reason: "",
    version: 1,
    events: [
      {
        id: uuid(500 + n),
        kind: "RAISED",
        by: { id: RILEY, name: "Riley Park" },
        at: "2026-11-15T14:04:00Z",
        text: "",
        data: {},
      },
    ],
    can: CAN_ALL,
    ...over,
  };
}

const note = (n: number, over: Record<string, unknown> = {}): ReviewNote => {
  const parsed = parseNote(raw(n, over));
  assert.ok(parsed !== null);
  return parsed;
};

const PAPER_FIELDS: PaperFields = {
  risk: "Leavers keep access.",
  activity: "The administrator removes access.",
  understanding:
    "Control ITGC-AC-02 is **manual**. The administrator removes access within 1 business day.\n\nWe walked through one instance: access was removed timely.",
  procedures: ["Inspected the HR list.", "Inspected the audit trail."],
  walkthrough: {
    columns: ["Step", "Who", "Evidence inspected", "Result"],
    steps: [
      {
        number: 1,
        when: "",
        step: "HR records the termination",
        who: "HR",
        evidence: "E1",
        result: "Recorded 09/30",
      },
      {
        number: 2,
        when: "",
        step: "Access disabled",
        who: "Admin",
        evidence: "E2",
        result: "Disabled 09/30 11:59 PM; group removed 10/01 10:18 AM",
      },
    ],
  },
  attributes: [
    { id: ATTR_C, code: "C", basis: "Removed within 1 day.", notes: "" },
    { id: ATTR_D, code: "D", basis: "Not triggered.", notes: "Checked later." },
  ],
  reports: [
    { ref: "E7", report: "Sign-on report", source: "Workday", procedure: "" },
  ],
  // Rewritten (docs/design-workpaper.md, section 3.9). Old: `matters: [{ text }]`, noted
  // by position as matters.<n>. New: the points, each at its place (an attribute's row, a
  // report's row naming the file, the head of section 5 since 3.10), and the evidence
  // that places a file's point.
  points: [
    {
      key: POINT_C,
      text: "Attribute C is shown only on files not relied on.",
      place: { at: "ATTRIBUTE", attributeId: ATTR_C },
      considered: {
        id: uuid(301),
        by: { id: DANA, name: "Dana Lee" },
        at: "2026-11-16T12:00:00Z",
        reason: "The ticket itself shows the approval.",
      },
    },
    {
      key: POINT_FILE,
      text: "The sign-on report does not show its parameters.",
      place: { at: "FILE", fileId: FILE_E7 },
      considered: null,
    },
    {
      key: POINT_REQUEST,
      text: "The check of the request is out of date. Check the request again.",
      place: { at: "REQUEST", requirementId: null },
      considered: null,
    },
  ],
  evidence: [{ ref: "E7", fileId: FILE_E7 }],
  conclusion: { text: "The control is designed and implemented." },
};

describe("reading the notes", () => {
  it("parses a note and the read", () => {
    const set = parseReviewNotes(
      {
        notes: [raw(1), raw(2, { criticality: "URGENT", status: "RESPONDED" })],
        members: [
          { id: DANA, name: "Dana Lee", role: "Preparer" },
          { id: RILEY, name: "Riley Park", role: "Reviewer" },
        ],
        can_raise: true,
        can_review: true,
        counts: {
          open: 99,
          responded: 99,
          cleared: 0,
          dismissed: 0,
          urgent_open: 99,
        },
        default_owner_id: DANA,
      },
      RILEY,
    );
    assert.ok(set !== null);
    assert.equal(set.notes.length, 2);
    assert.equal(set.canRaise, true);
    assert.equal(set.defaultOwnerId, DANA);
    assert.equal(set.viewerId, RILEY);
    // Counted from the notes read, so the page and its filters agree.
    assert.deepEqual(set.counts, {
      open: 1,
      responded: 1,
      cleared: 0,
      dismissed: 0,
      urgentOpen: 1,
    });
    assert.equal(set.members[0]?.role, "Preparer");
  });

  it("never reads an unknown value as Urgent, as Cleared or as allowed", () => {
    const odd = note(1, {
      criticality: "CRITICAL",
      status: "CLOSED",
      can: { clear: "yes", reply: 1, dismiss: true },
    });
    assert.equal(odd.criticality, "OTHER");
    assert.equal(odd.status, "OTHER");
    assert.equal(isOpen(odd), false);
    assert.equal(isClosed(odd), false);
    assert.equal(odd.can.clear, false);
    assert.equal(odd.can.reply, false);
    assert.equal(odd.can.dismiss, true);
    assert.equal(countsOf([odd]).urgentOpen, 0);
  });

  it("drops the notes the page cannot place", () => {
    for (const over of [
      { id: "not-a-uuid" },
      { number: 0 },
      { number: 1.5 },
      { version: 0 },
      { anchor_kind: "PAGE" },
      { field: "" },
      { field: "has space" },
      { field: "x".repeat(121) },
      { anchor_kind: "TEXT", field: UNDERSTANDING, quote: "" },
      { owner: null },
      { raised_by: { id: "x", name: "y" } },
    ]) {
      assert.equal(parseNote(raw(1, over)), null, JSON.stringify(over));
    }
    const set = parseReviewNotes({
      notes: [raw(1), raw(2, { id: "bad" }), raw(1), "x", null],
      members: [{ id: "bad" }, { id: DANA, name: "Dana" }],
    });
    assert.equal(set?.notes.length, 1);
    assert.equal(set?.members.length, 1);
    // A default owner who is not a member is not offered.
    assert.equal(
      parseReviewNotes({ notes: [], default_owner_id: SAM })?.defaultOwnerId,
      null,
    );
    assert.equal(parseReviewNotes(null), null);
    assert.equal(parseReviewNotes({ notes: "x" }), null);
    assert.equal(parseReviewNotes({ notes: [] }, "not-an-id")?.viewerId, null);
  });

  it("keeps a whole-workpaper note's field empty, and its words only for highlighted ones", () => {
    const whole = note(1, {
      anchor_kind: "WORKPAPER",
      field: "anything",
      quote: "x",
    });
    assert.equal(whole.field, "");
    assert.equal(whole.quote, "");
    const field = note(2, { quote: "ignored", prefix: "p" });
    assert.equal(field.quote, "");
    assert.equal(field.prefix, "");
  });

  it("reads the events and their words", () => {
    const parsed = note(1, {
      events: [
        {
          id: uuid(601),
          kind: "REPLIED",
          by: { id: DANA, name: "Dana" },
          at: "x",
          text: "Done",
          data: {},
        },
        {
          id: uuid(602),
          kind: "CRITICALITY",
          by: { id: RILEY, name: "Riley" },
          at: "x",
          text: "",
          data: { from: "NORMAL", to: "URGENT" },
        },
        {
          id: uuid(603),
          kind: "OWNER",
          by: { id: RILEY, name: "Riley" },
          at: "x",
          text: "",
          data: { from: DANA, to: SAM, from_name: "Dana", to_name: "Sam" },
        },
        {
          id: uuid(604),
          kind: "MOVED",
          by: { id: RILEY, name: "Riley" },
          at: "x",
          text: "",
          data: {},
        },
        { id: "bad", kind: "REPLIED", by: { id: DANA, name: "Dana" } },
      ],
    });
    assert.equal(parsed.events.length, 4);
    assert.deepEqual(parsed.events.map(eventWords), [
      "Dana replied",
      "Riley changed the criticality from Normal to Urgent",
      "Riley handed the note to Sam",
      "Riley changed the note",
    ]);
  });

  it("puts a confirmed note in place of its earlier copy", () => {
    const set = parseReviewNotes({ notes: [raw(1), raw(2)] });
    assert.ok(set !== null);
    const cleared = note(1, { status: "CLEARED", version: 2 });
    const after = withNote(set, cleared);
    assert.equal(after.notes[0]?.status, "CLEARED");
    assert.equal(after.counts.open, 1);
    assert.equal(after.counts.cleared, 1);
    const added = withNote(set, note(3));
    assert.equal(added.notes.length, 3);
  });
});

describe("the field keys (section 3)", () => {
  it("names each place and its section", () => {
    // Renumbered (docs/design-workpaper.md, section 3.10; product owner, 16 November
    // 2026: procedures first, the understanding as their result, a section of its own).
    // Old: understanding 1 (inside Objective, risk and control), walkthrough 3, the
    // attributes 4, the reports 5, the Conclusion 6. New: the understanding is section 3
    // of its own, the walkthrough 4, the attributes 5, the reports 6, the Conclusion 7.
    // The control's risk and activity stay in 1, the procedures in 2.
    const keys: Array<[string, number | null]> = [
      [UNDERSTANDING, 3],
      ["control.risk", 1],
      ["control.activity", 1],
      ["procedures.2", 2],
      [walkthroughKey(2, 4), 4],
      [attributeKey(ATTR_C, "result"), 5],
      [attributeKey(ATTR_C, "basis"), 5],
      [attributeKey(ATTR_C, "note"), 5],
      [reportKey(1, 2), 6],
      // Rewritten (docs/design-workpaper.md, section 3.9). Old: ["matters.1", 6],
      // [CONCLUSION, 7], ["conclusion.choice", 7]. New: the matters section is gone, so a
      // note on it is in no section (it is listed as "On an item no longer listed"), and
      // the Conclusion is section 6 (section 7 since 3.10, above).
      ["matters.1", null],
      [CONCLUSION, 7],
      ["conclusion.choice", 7],
      ["something.else", null],
      ["walkthrough.0.1", null],
    ];
    for (const [key, section] of keys) {
      assert.equal(
        sectionOf({ anchorKind: "FIELD", field: key }),
        section,
        key,
      );
    }
    assert.equal(sectionOf({ anchorKind: "WORKPAPER", field: "" }), 0);
    // A considered point is in the section of its place; one this read does not have,
    // or a key that is not 32 hex, is in none.
    const context = contextOf(PAPER_FIELDS);
    const pointSection = (field: string) =>
      sectionOf({ anchorKind: "FIELD", field }, context);
    // Renumbered (section 3.10). Old: 4, 5, 4. New: 5 (an attribute's point), 6 (a
    // report's), 5 (a REQUEST point at the head of Attributes tested).
    assert.equal(pointSection(pointKey(POINT_C)), 5);
    assert.equal(pointSection(pointKey(POINT_FILE)), 6);
    assert.equal(pointSection(pointKey(POINT_REQUEST)), 5);
    assert.equal(pointSection(pointKey("a".repeat(32))), null);
    assert.equal(pointSection("points.ABC"), null);
    assert.equal(
      sectionOf({ anchorKind: "FIELD", field: pointKey(POINT_C) }),
      null,
    );
    assert.deepEqual(placeOf(pointKey(POINT_C)), {
      kind: "point",
      key: POINT_C,
    });
    assert.ok(FIELD_KEY.test(pointKey(POINT_C)));
    // The sections as the document numbers them, and there is no "Matters for the
    // reviewer". Rewritten (docs/design-workpaper.md, section 3.10; product owner, 16
    // November 2026: procedures first, the understanding as their result). Old: 1
    // Objective, risk and control, 2 Procedures performed, 3 Walkthrough, 4 Attributes
    // tested, 5 Information produced by the entity, 6 Conclusion. New: 3 Understanding of
    // the control after the procedures, then 4 to 7, and "Tickmarks and evidence" after.
    assert.deepEqual(
      SECTIONS.map((item) => item.name),
      [
        "The workpaper as a whole",
        "1 Objective, risk and control",
        "2 Procedures performed",
        "3 Understanding of the control",
        "4 Walkthrough",
        "5 Attributes tested",
        "6 Information produced by the entity",
        "7 Conclusion",
        "Tickmarks and evidence",
      ],
    );
    // The numbers are the one constant's, in the document's order.
    assert.deepEqual(
      SECTIONS.map((item) => item.n),
      [
        0,
        DW_SECTION.objective,
        DW_SECTION.procedures,
        DW_SECTION.understanding,
        DW_SECTION.walkthrough,
        DW_SECTION.attributes,
        DW_SECTION.ipe,
        DW_SECTION.conclusion,
        8,
      ],
    );
    assert.deepEqual(placeOf(walkthroughKey(12, 3)), {
      kind: "walkthrough",
      row: 12,
      column: 3,
    });
  });

  it("says where a note is in words", () => {
    const context = contextOf(PAPER_FIELDS);
    const where = (field: string) =>
      whereWords({ anchorKind: "FIELD", field }, context);
    // Renumbered (docs/design-workpaper.md, section 3.10; product owner, 16 November
    // 2026: procedures first, the understanding as their result). Old: "4 Attributes",
    // "1 Understanding of the control", "3 Walkthrough", "5 Reports", "6 Conclusion".
    // New: "5 Attributes", "3 Understanding of the control", "4 Walkthrough", "6
    // Reports", "7 Conclusion"; the control's facts stay "1", the procedures "2".
    assert.equal(
      where(attributeKey(ATTR_C, "result")),
      "5 Attributes · C, result",
    );
    assert.equal(
      where(attributeKey(ATTR_D, "basis")),
      "5 Attributes · D, what the evidence shows",
    );
    assert.equal(
      where(attributeKey(ATTR_D, "note")),
      "5 Attributes · D, preparer's note",
    );
    assert.equal(where(UNDERSTANDING), "3 Understanding of the control");
    assert.equal(where("control.risk"), "1 Risk addressed");
    assert.equal(where("control.activity"), "1 Control activity");
    assert.equal(where("procedures.2"), "2 Procedures · 2");
    assert.equal(where(walkthroughKey(2, 4)), "4 Walkthrough · step 2, result");
    assert.equal(where(reportKey(1, 2)), "6 Reports · E7, source");
    assert.equal(where(reportKey(3, 1)), "6 Reports · row 3, report");
    // Rewritten (section 3.9). Old: "7 Conclusion". New: the Conclusion is section 6.
    // Rewritten again (section 3.10). Old: "6 Conclusion". New: "7 Conclusion".
    assert.equal(where(CONCLUSION), "7 Conclusion");
    assert.equal(where("conclusion.choice"), "7 Conclusion · the choice");
    // A considered point: "Considered point" and its first words, in its place's section.
    assert.equal(
      where(pointKey(POINT_C)),
      "5 Attributes · Considered point: Attribute C is shown only on files not relied…",
    );
    assert.equal(
      where(pointKey(POINT_FILE)),
      "6 Reports · Considered point: The sign-on report does not show its parameters.",
    );
    assert.equal(where(pointKey("a".repeat(32))), "Considered point");
    // A note on the removed matters keeps its words, said as on an item no longer listed.
    assert.equal(where("matters.3"), "On an item no longer listed");
    assert.equal(isRetiredField("matters.3"), true);
    assert.equal(isRetiredField(pointKey(POINT_C)), false);
    assert.equal(where("odd.key"), "odd.key");
    assert.equal(
      whereWords({ anchorKind: "WORKPAPER", field: "" }),
      "The workpaper as a whole",
    );
  });

  it("gives a considered point its one line, and orders it at its place (section 3.9)", () => {
    const texts = fieldTextsOf(PAPER_FIELDS);
    // Rewritten (found failing before this change, at fd25ecc, while the sections were
    // renumbered for docs/design-workpaper.md section 3.10). Old: "16 Nov" (en-GB). New:
    // "Nov 16", the date style consideredLine adopted at the screenshot check of 3.9 (16
    // November 2026; design-points-model.test.ts records the same change); this test was
    // not updated with it.
    assert.equal(
      texts.get(pointKey(POINT_C)),
      "Considered by Dana Lee, Nov 16: The ticket itself shows the approval.",
    );
    // Only a considered point is a field of the sheet.
    assert.equal(texts.has(pointKey(POINT_FILE)), false);
    const context = contextOf(PAPER_FIELDS);
    const order = documentOrder(
      [
        note(1, { field: CONCLUSION }),
        note(2, { field: "matters.2" }),
        note(3, { field: pointKey(POINT_C) }),
        note(4, { field: attributeKey(ATTR_D, "basis") }),
        note(5, { field: attributeKey(ATTR_C, "basis") }),
        note(6, { field: reportKey(1, 1) }),
      ],
      context,
    ).map((item) => item.number);
    // C's own field, then its point, then D; the report; the conclusion; and the note on
    // an item no longer listed last.
    assert.deepEqual(order, [5, 3, 4, 6, 1, 2]);
    // The filters read the point's section from the same context.
    // Renumbered (section 3.10). Old: section 4. New: section 5, Attributes tested.
    assert.deepEqual(
      filterNotes(
        [note(3, { field: pointKey(POINT_C) }), note(1)],
        { ...NO_FILTERS, section: 5 },
        context,
      ).map((item) => item.number),
      [3],
    );
    assert.equal(
      railNotes(
        [note(3, { field: pointKey(POINT_C) })],
        { ...RAIL_START, section: true },
        null,
        5,
        context,
      ).length,
      1,
    );
    // A highlight on a removed matter's words is not said to have lost them.
    const kept = note(7, {
      anchor_kind: "TEXT",
      field: "matters.1",
      quote: "kept words",
    });
    assert.equal(wordsGone(kept, texts), false);
  });

  it("numbers the walkthrough's stored columns, a When column apart", () => {
    assert.deepEqual(
      walkthroughColumnsOf(["Step", "Who", "Evidence", "Result"]),
      {
        when: null,
        step: 1,
        who: 2,
        evidence: 3,
        result: 4,
      },
    );
    assert.deepEqual(
      walkthroughColumnsOf(["When", "Step", "Who", "Evidence", "Result"]),
      { when: 1, step: 2, who: 3, evidence: 4, result: 5 },
    );
    assert.deepEqual(walkthroughColumnsOf([]), {
      when: null,
      step: 1,
      who: 2,
      evidence: 3,
      result: 4,
    });
  });

  it("gives each field its text as the sheet draws it", () => {
    const texts = fieldTextsOf(PAPER_FIELDS);
    // The formatted text without its marks, with nothing between its paragraphs: what
    // the page's text nodes hold.
    assert.equal(
      texts.get(UNDERSTANDING),
      "Control ITGC-AC-02 is manual. The administrator removes access within 1 business day.We walked through one instance: access was removed timely.",
    );
    assert.equal(richPlain("- one\n- **two**"), "onetwo");
    assert.equal(
      texts.get(walkthroughKey(2, 4)),
      PAPER_FIELDS.walkthrough.steps[1]?.result,
    );
    assert.equal(texts.get(attributeKey(ATTR_D, "note")), "Checked later.");
    assert.equal(texts.get(reportKey(1, 2)), "Workday");
    assert.equal(texts.get("procedures.2"), "Inspected the audit trail.");
  });
});

describe("highlighted words: the anchor", () => {
  const text =
    "access was removed. Then access was removed again, and access was kept.";

  it("takes the selection's words, what is around them and which match they are", () => {
    const start = text.indexOf("access was removed again");
    const anchor = anchorOf(text, start, start + "access was removed".length);
    assert.ok(anchor !== null);
    assert.equal(anchor.quote, "access was removed");
    assert.equal(anchor.occurrence, 1);
    assert.equal(anchor.prefix, "access was removed. Then ");
    assert.equal(anchor.suffix, " again, and access was kept.");
    // Found again where it was, not at the first match.
    assert.deepEqual(findAnchor(text, anchor), { start, end: anchor.end });
  });

  it("round-trips every repeated match", () => {
    const repeated = "ab ab ab ab";
    for (let at = 0; at < 4; at++) {
      const start = at * 3;
      const anchor = anchorOf(repeated, start, start + 2);
      assert.ok(anchor !== null);
      assert.equal(anchor.occurrence, at);
      assert.deepEqual(findAnchor(repeated, anchor), { start, end: start + 2 });
    }
  });

  it("leaves out the space at the ends, and takes a selection made backwards", () => {
    const start = text.indexOf("Then");
    const anchor = anchorOf(text, start + 4 + 1, start - 2);
    assert.ok(anchor !== null);
    assert.equal(anchor.quote, ". Then");
    const spaced = anchorOf("a   word   b", 1, 10);
    assert.equal(spaced?.quote, "word");
    assert.equal(spaced?.start, 4);
    assert.equal(anchorOf("a    b", 1, 5), null);
    assert.equal(anchorOf(text, 3, 3), null);
  });

  it("bounds the words and what is around them", () => {
    const long = `${"x".repeat(100)}WORD${"y".repeat(100)}`;
    const anchor = anchorOf(long, 100, 104);
    assert.equal(anchor?.prefix.length, NOTE_BOUNDS.around);
    assert.equal(anchor?.suffix.length, NOTE_BOUNDS.around);
    assert.equal(anchorOf("z".repeat(600), 0, 501), null);
    assert.equal(anchorOf("z".repeat(600), 0, 500)?.quote.length, 500);
  });

  it("never cuts a character in two", () => {
    const emoji = "start 😀 middle 😀 end";
    const at = emoji.indexOf("😀");
    // A selection that ends inside the pair takes all of it.
    const anchor = anchorOf(emoji, at, at + 1);
    assert.equal(anchor?.quote, "😀");
    const edge = `😀${"a".repeat(59)}X`;
    const around = anchorOf(edge, 60, 61);
    assert.ok(around !== null);
    assert.ok(!/^[\udc00-\udfff]/.test(around.prefix));
  });

  it("finds the words again after the text around them changed", () => {
    const start = text.indexOf("access was kept");
    const anchor = anchorOf(text, start, start + "access was kept".length);
    assert.ok(anchor !== null);
    const edited = `A new opening sentence. ${text.replace("Then", "Later")}`;
    const found = findAnchor(edited, anchor);
    assert.equal(found?.start, edited.indexOf("access was kept"));
  });

  it("prefers the match whose surroundings fit when the occurrence moved", () => {
    const anchor = {
      quote: "removed",
      prefix: "Then access was ",
      suffix: " again",
      occurrence: 1,
    };
    // A sentence with the words was added before it: the second match is now third.
    const edited = `It was removed. ${text}`;
    const found = findAnchor(edited, anchor);
    assert.equal(found?.start, edited.indexOf("removed again"));
  });

  it("says when the words are gone", () => {
    const anchor = {
      quote: "removed timely",
      prefix: "",
      suffix: "",
      occurrence: 0,
    };
    assert.equal(findAnchor("access was removed on time", anchor), null);
    const gone = note(1, {
      anchor_kind: "TEXT",
      field: UNDERSTANDING,
      quote: "no longer here",
      prefix: "",
      suffix: "",
    });
    const texts = fieldTextsOf(PAPER_FIELDS);
    assert.equal(wordsGone(gone, texts), true);
    assert.equal(passageOf(gone, texts), null);
    assert.equal(
      GONE_WORDS,
      "The highlighted words have changed since this note was raised",
    );
    const there = note(2, {
      anchor_kind: "TEXT",
      field: UNDERSTANDING,
      quote: "removed timely",
    });
    assert.equal(wordsGone(there, texts), false);
    const passage = passageOf(there, texts, 10);
    assert.deepEqual(passage, {
      before: "…ccess was ",
      words: "removed timely",
      after: ".",
    });
  });
});

describe("drawing the highlights", () => {
  it("cuts overlapping highlights into runs, in the gravest criticality", () => {
    const painted = paintedOf([
      { start: 0, end: 10, noteId: "a", number: 1, criticality: "FOLLOW_UP" },
      { start: 5, end: 15, noteId: "b", number: 2, criticality: "URGENT" },
    ]);
    assert.deepEqual(
      painted.map((run) => [
        run.start,
        run.end,
        run.criticality,
        run.noteIds.join(),
      ]),
      [
        [0, 5, "FOLLOW_UP", "a"],
        [5, 10, "URGENT", "a,b"],
        [10, 15, "URGENT", "b"],
      ],
    );
  });

  it("splits a run of text at its highlights, keeping every character", () => {
    const painted = paintedOf([
      { start: 4, end: 9, noteId: "a", number: 1, criticality: "NORMAL" },
    ]);
    const words = "the quick brown";
    const pieces = piecesOf(words, 0, painted);
    assert.deepEqual(
      pieces.map((piece) => [piece.text, piece.at, piece.painted !== null]),
      [
        ["the ", 0, false],
        ["quick", 4, true],
        [" brown", 9, false],
      ],
    );
    assert.equal(pieces.map((piece) => piece.text).join(""), words);
    // A run that starts later in the field (a run of formatted text).
    const later = piecesOf("ick br", 6, painted);
    assert.deepEqual(
      later.map((piece) => [piece.text, piece.painted !== null]),
      [
        ["ick", true],
        [" br", false],
      ],
    );
    assert.deepEqual(piecesOf("plain", 0, []), [
      { text: "plain", at: 0, painted: null },
    ]);
  });
});

describe("the order of the document", () => {
  it("lists the notes as the sheet draws their places, the words by where they are", () => {
    const context = contextOf(PAPER_FIELDS);
    const texts = fieldTextsOf(PAPER_FIELDS);
    const notes = [
      note(1, { field: CONCLUSION }),
      note(2, { field: attributeKey(ATTR_D, "result") }),
      note(3, { field: attributeKey(ATTR_C, "basis") }),
      note(4, {
        anchor_kind: "TEXT",
        field: UNDERSTANDING,
        quote: "removed timely",
      }),
      note(5, { anchor_kind: "TEXT", field: UNDERSTANDING, quote: "manual" }),
      note(6, { anchor_kind: "WORKPAPER", field: "" }),
      note(7, { field: walkthroughKey(2, 4) }),
      note(8, {
        anchor_kind: "TEXT",
        field: UNDERSTANDING,
        quote: "gone words",
      }),
      note(9, { field: UNDERSTANDING }),
      note(10, { field: "control.risk" }),
      note(11, { field: "procedures.1" }),
    ];
    const ordered = documentOrder(notes, context, positionsOf(notes, texts));
    // Rewritten (docs/design-workpaper.md, section 3.10; product owner, 16 November 2026:
    // procedures first, the understanding as their result). Old: no note on a procedure,
    // and the understanding ranked inside section 1, after the control's facts. New: a
    // note on procedure 1 (11) comes after the control's risk (10) and before every note
    // on the understanding (9, 5, 4, 8), which is section 3, then the walkthrough (7).
    assert.deepEqual(
      ordered.map((item) => item.number),
      [6, 10, 11, 9, 5, 4, 8, 7, 3, 2, 1],
    );
  });
});

describe("filters", () => {
  const notes = [
    note(1, { criticality: "URGENT", status: "OPEN" }),
    note(2, {
      criticality: "NORMAL",
      status: "RESPONDED",
      owner: { id: SAM, name: "Sam" },
    }),
    note(3, {
      criticality: "FOLLOW_UP",
      status: "CLEARED",
      field: attributeKey(ATTR_C, "basis"),
    }),
    note(4, {
      criticality: "NORMAL",
      status: "DISMISSED",
      raised_by: { id: DANA, name: "Dana" },
      anchor_kind: "TEXT",
      quote: "Removed timely",
      field: CONCLUSION,
    }),
    note(5, {
      criticality: "FOLLOW_UP",
      events: [
        {
          id: uuid(700),
          kind: "REPLIED",
          by: { id: DANA, name: "Dana" },
          at: "x",
          text: "Corrected the 10:28 time",
          data: {},
        },
      ],
    }),
  ];

  it("narrows by status, criticality, owner, section, raised-by and search", () => {
    const numbers = (filters: Partial<typeof NO_FILTERS>) =>
      filterNotes(notes, { ...NO_FILTERS, ...filters }).map(
        (item) => item.number,
      );
    assert.deepEqual(numbers({}), [1, 2, 3, 4, 5]);
    assert.deepEqual(numbers(STARTING_FILTERS), [1, 2, 5]);
    assert.deepEqual(numbers({ criticalities: ["NORMAL"] }), [2, 4]);
    assert.deepEqual(numbers({ owner: SAM }), [2]);
    assert.deepEqual(numbers({ raisedBy: DANA }), [4]);
    // Renumbered (docs/design-workpaper.md, section 3.10; product owner, 16 November
    // 2026: procedures first, the understanding as their result). Old: { section: 4 }
    // found the attribute's note. New: Attributes tested is section 5.
    assert.deepEqual(numbers({ section: 5 }), [3]);
    // Rewritten (docs/design-workpaper.md, section 3.9). Old: { section: 7 } found the
    // note on the conclusion. New: the Conclusion is section 6, and 7 is the unnumbered
    // "Tickmarks and evidence", where no note of these is.
    // Rewritten again (section 3.10). Old: { section: 6 } the conclusion's note, 7
    // "Tickmarks and evidence". New: the Conclusion is 7 and "Tickmarks and evidence" 8;
    // section 6 (the reports) has none of these notes.
    assert.deepEqual(numbers({ section: 7 }), [4]);
    assert.deepEqual(numbers({ section: 8 }), []);
    assert.deepEqual(numbers({ section: 6 }), []);
    // The search reads the note's text, its replies and its highlighted words.
    assert.deepEqual(numbers({ search: "  removed   TIMELY " }), [4]);
    assert.deepEqual(numbers({ search: "10:28" }), [5]);
    assert.deepEqual(numbers({ search: "number 2" }), [2]);
    assert.equal(searchHit(notes[0] as ReviewNote, ""), true);
    assert.equal(isFiltered(NO_FILTERS), false);
    assert.equal(isFiltered({ ...NO_FILTERS, search: "  " }), false);
    assert.equal(isFiltered(STARTING_FILTERS), true);
  });

  it("counts each choice with the other filters as they are", () => {
    const filters = { ...NO_FILTERS, criticalities: ["NORMAL" as const] };
    const statuses = choiceCounts(notes, filters, "statuses");
    assert.equal(statuses.get("RESPONDED"), 1);
    assert.equal(statuses.get("DISMISSED"), 1);
    assert.equal(statuses.get("OPEN"), undefined);
    // Its own filter is left out of its counts.
    const criticalities = choiceCounts(notes, filters, "criticalities");
    assert.equal(criticalities.get("URGENT"), 1);
    assert.equal(criticalities.get("NORMAL"), 2);
    // Renumbered (section 3.10). Old: .get("1") was 3, the notes on the understanding
    // being in section 1. New: they are in section 3, the understanding's own, and none
    // is in 1.
    assert.equal(choiceCounts(notes, NO_FILTERS, "section").get("3"), 3);
    assert.equal(
      choiceCounts(notes, NO_FILTERS, "section").get("1"),
      undefined,
    );
  });

  it("keeps the session's filters, reading back only what it knows", () => {
    assert.deepEqual(
      parseFilters({
        statuses: ["OPEN", "WHATEVER"],
        criticalities: ["URGENT"],
        owner: DANA,
        section: 4,
        raisedBy: "x",
        search: "abc",
      }),
      {
        statuses: ["OPEN"],
        criticalities: ["URGENT"],
        owner: DANA,
        section: 4,
        raisedBy: null,
        search: "abc",
      },
    );
    assert.equal(parseFilters("x"), null);
    assert.equal(parseFilters({ section: 99 })?.section, null);
  });

  // Rewritten. Old: the rail's four one-press chips (Open, Urgent, Mine, This section),
  // each a filter of its own with its count (RailChips, chipCount). New: one switch, Open
  // · Mine · Resolved, each with its count (tabCount), and a filter menu (Urgent only,
  // Mine, This section, an owner) and a search over it (RailView). Product owner, 16
  // November 2026: notes rail, inbox (option 3).
  it("gives the rail's switch, its filters and its search, each tab with its count", () => {
    const viewer = RILEY;
    const numbers = (list: readonly ReviewNote[]) =>
      list.map((item) => item.number);
    // Open: open and responded to, in the order given.
    assert.deepEqual(
      numbers(railNotes(notes, RAIL_START, viewer, null)),
      [1, 2, 5],
    );
    // Resolved: cleared and dismissed.
    assert.deepEqual(
      numbers(
        railNotes(notes, { ...RAIL_START, tab: "resolved" }, viewer, null),
      ),
      [3, 4],
    );
    // Mine: open, and the person owns it or raised it; nobody's without a session.
    assert.deepEqual(
      numbers(railNotes(notes, { ...RAIL_START, tab: "mine" }, SAM, null)),
      [2],
    );
    assert.equal(
      railNotes(notes, { ...RAIL_START, tab: "mine" }, null, null).length,
      0,
    );
    assert.ok(isMine(notes[0] as ReviewNote, RILEY));
    assert.ok(!isMine(notes[0] as ReviewNote, SAM));
    assert.ok(!isMine(notes[0] as ReviewNote, null));
    // The menu's filters narrow any tab: Urgent only, Mine, This section, an owner.
    assert.deepEqual(
      numbers(railNotes(notes, { ...RAIL_START, urgent: true }, viewer, null)),
      [1],
    );
    assert.deepEqual(
      numbers(
        railNotes(
          notes,
          { ...RAIL_START, tab: "resolved", mine: true },
          viewer,
          null,
        ),
      ),
      [3],
    );
    assert.deepEqual(
      numbers(
        // Renumbered (section 3.10). Old: 4. New: 5, the attribute's section now.
        railNotes(
          notes,
          { ...RAIL_START, tab: "resolved", section: true },
          viewer,
          5,
        ),
      ),
      [3],
    );
    // This section with no section known lists nothing.
    assert.equal(
      railNotes(notes, { ...RAIL_START, section: true }, viewer, null).length,
      0,
    );
    assert.deepEqual(
      numbers(railNotes(notes, { ...RAIL_START, owner: SAM }, viewer, null)),
      [2],
    );
    // The search: the note, its replies, its highlighted words.
    assert.deepEqual(
      numbers(
        railNotes(notes, { ...RAIL_START, search: "10:28" }, viewer, null),
      ),
      [5],
    );
    // Each tab's count, with the filters as they are.
    assert.equal(tabCount(notes, RAIL_START, "open", viewer, null), 3);
    assert.equal(tabCount(notes, RAIL_START, "resolved", viewer, null), 2);
    assert.equal(tabCount(notes, RAIL_START, "mine", viewer, null), 3);
    assert.equal(tabCount(notes, RAIL_START, "mine", SAM, null), 1);
    const urgent = { ...RAIL_START, urgent: true };
    assert.equal(tabCount(notes, urgent, "open", viewer, null), 1);
    assert.equal(tabCount(notes, urgent, "resolved", viewer, null), 0);
    // Whether the menu narrows the list (the search apart).
    assert.equal(railFiltered(RAIL_START), false);
    assert.equal(railFiltered({ ...RAIL_START, search: "x" }), false);
    assert.equal(railFiltered(urgent), true);
    assert.equal(railFiltered({ ...RAIL_START, owner: SAM }), true);
  });

  it("groups the rail's notes Urgent, Normal, Follow-up, only those that have some", () => {
    const groups = groupsOf(notes);
    assert.deepEqual(
      groups.map((group) => [
        group.key,
        group.label,
        group.notes.map((item) => item.number),
      ]),
      [
        ["URGENT", "Urgent", [1]],
        ["NORMAL", "Normal", [2, 4]],
        ["FOLLOW_UP", "Follow-up", [3, 5]],
      ],
    );
    assert.deepEqual(
      groupsOf([note(6, { criticality: "FOLLOW_UP" })]).map((g) => g.key),
      ["FOLLOW_UP"],
    );
    // A criticality this page does not know is its own group, last; never Urgent.
    assert.deepEqual(
      groupsOf([note(7, { criticality: "SEVERE" }), note(8)]).map((g) => [
        g.key,
        g.label,
      ]),
      [
        ["NORMAL", "Normal"],
        ["OTHER", "Other"],
      ],
    );
    assert.deepEqual(groupsOf([]), []);
  });
});

describe("the writes", () => {
  const scope = { organizationId: ORG, projectId: PROJECT, workpaperId: PAPER };
  const base = `/organizations/${ORG}/projects/${PROJECT}/workpapers/${PAPER}/review-notes`;

  it("posts a raise on highlighted words exactly as selected", () => {
    const text = "  Timely is a conclusion.  ";
    const fields = noteFields(scope, {
      intent: "raise",
      anchorKind: "TEXT",
      field: UNDERSTANDING,
      anchor: {
        quote: " removed timely",
        prefix: "was",
        suffix: ".",
        occurrence: 0,
      },
      workpaperVersion: 4,
      text,
      criticality: "URGENT",
      ownerId: DANA,
    });
    const write = reviewNoteWrite(fields);
    assert.ok(!("error" in write));
    assert.equal(write.path, base);
    assert.deepEqual(write.body, {
      anchor_kind: "TEXT",
      field: UNDERSTANDING,
      workpaper_version: 4,
      text: "Timely is a conclusion.",
      criticality: "URGENT",
      owner_id: DANA,
      // The words are never trimmed or collapsed.
      quote: " removed timely",
      prefix: "was",
      suffix: ".",
      occurrence: 0,
    });
  });

  it("posts a raise on a field and on the workpaper with no words", () => {
    const field = reviewNoteWrite(
      noteFields(scope, {
        intent: "raise",
        anchorKind: "FIELD",
        field: walkthroughKey(2, 4),
        anchor: null,
        workpaperVersion: 1,
        text: "Is this the right time?",
        criticality: "NORMAL",
        ownerId: DANA,
      }),
    );
    assert.ok(!("error" in field));
    assert.equal(field.body.field, "walkthrough.2.4");
    assert.equal("quote" in field.body, false);
    const whole = reviewNoteWrite(
      noteFields(scope, {
        intent: "raise",
        anchorKind: "WORKPAPER",
        field: "ignored",
        anchor: null,
        workpaperVersion: 1,
        text: "The whole thing needs a look.",
        criticality: "FOLLOW_UP",
        ownerId: DANA,
      }),
    );
    assert.ok(!("error" in whole));
    assert.equal(whole.body.field, "");
  });

  it("refuses what the server would", () => {
    const good = {
      organization_id: ORG,
      project_id: PROJECT,
      workpaper_id: PAPER,
      intent: "raise",
      anchor_kind: "TEXT",
      field: UNDERSTANDING,
      quote: "words",
      prefix: "",
      suffix: "",
      occurrence: 0,
      workpaper_version: 1,
      text: "Long enough text.",
      criticality: "URGENT",
      owner_id: DANA,
    };
    assert.ok(!("error" in reviewNoteWrite(good)));
    for (const over of [
      { organization_id: "x" },
      { workpaper_id: undefined },
      { intent: "delete" },
      { anchor_kind: "PAGE" },
      { field: "bad key!" },
      { quote: "" },
      { quote: "q".repeat(501) },
      { prefix: "p".repeat(61) },
      { suffix: 5 },
      { occurrence: -1 },
      { occurrence: 1.5 },
      { workpaper_version: 0 },
      { text: "too short" },
      { text: "t".repeat(2001) },
      { criticality: "CRITICAL" },
      { owner_id: "dana" },
    ]) {
      assert.ok(
        "error" in reviewNoteWrite({ ...good, ...over }),
        JSON.stringify(over),
      );
    }
    // Words on a field note, or a field on a note on the workpaper, are refused.
    assert.ok("error" in reviewNoteWrite({ ...good, anchor_kind: "FIELD" }));
    assert.ok(
      "error" in
        reviewNoteWrite({
          ...good,
          anchor_kind: "WORKPAPER",
          quote: undefined,
          prefix: undefined,
          suffix: undefined,
          occurrence: undefined,
        }),
    );
  });

  it("makes each act's path and body", () => {
    const id = uuid(101);
    const act = (fields: Record<string, unknown>) =>
      reviewNoteWrite({
        organization_id: ORG,
        project_id: PROJECT,
        workpaper_id: PAPER,
        note_id: id,
        version: 3,
        ...fields,
      });
    assert.deepEqual(
      act({ intent: "reply", text: " Fixed. ", responds: true }),
      {
        intent: "reply",
        path: `${base}/${id}/reply`,
        body: { text: "Fixed.", responds: true, version: 3 },
      },
    );
    assert.deepEqual(act({ intent: "reply", text: "ok", responds: "yes" }), {
      intent: "reply",
      path: `${base}/${id}/reply`,
      body: { text: "ok", responds: false, version: 3 },
    });
    assert.deepEqual(act({ intent: "clear" }), {
      intent: "clear",
      path: `${base}/${id}/clear`,
      body: { version: 3 },
    });
    assert.deepEqual(act({ intent: "reopen", text: "Not yet." }), {
      intent: "reopen",
      path: `${base}/${id}/reopen`,
      body: { text: "Not yet.", version: 3 },
    });
    assert.deepEqual(act({ intent: "dismiss", reason: "Raised in error." }), {
      intent: "dismiss",
      path: `${base}/${id}/dismiss`,
      body: { reason: "Raised in error.", version: 3 },
    });
    assert.deepEqual(act({ intent: "criticality", criticality: "FOLLOW_UP" }), {
      intent: "criticality",
      path: `${base}/${id}/criticality`,
      body: { criticality: "FOLLOW_UP", version: 3 },
    });
    assert.deepEqual(act({ intent: "owner", owner_id: SAM }), {
      intent: "owner",
      path: `${base}/${id}/owner`,
      body: { owner_id: SAM, version: 3 },
    });
    for (const fields of [
      { intent: "reply", text: "   " },
      { intent: "reopen", text: "" },
      { intent: "dismiss", reason: "short" },
      { intent: "dismiss", reason: "r".repeat(501) },
      { intent: "criticality", criticality: "HIGH" },
      { intent: "owner", owner_id: "x" },
      { intent: "clear", version: 0 },
      { intent: "clear", note_id: "x" },
    ]) {
      assert.ok("error" in act(fields), JSON.stringify(fields));
    }
  });

  it("reads only a workpaper the query names", () => {
    assert.equal(
      notesReadPath(
        new URLSearchParams({
          organization: ORG,
          project: PROJECT,
          workpaper: PAPER,
        }),
      ),
      base,
    );
    assert.equal(
      notesReadPath(
        new URLSearchParams({
          organization: ORG,
          project: PROJECT,
          workpaper: "../x",
        }),
      ),
      null,
    );
  });

  it("says what is wrong with a note, a reply or a reason before it is sent", () => {
    assert.equal(
      noteTextProblem("short"),
      "Write the note in at least 10 characters.",
    );
    assert.equal(noteTextProblem("  ten chars!  "), null);
    assert.equal(
      noteTextProblem("x".repeat(2001)),
      "The note can be at most 2000 characters.",
    );
    // Counted in characters, as the server counts them.
    assert.equal(noteTextProblem("😀".repeat(2000)), null);
    assert.equal(replyProblem("  "), "Write the reply.");
    assert.equal(
      reasonProblem("too short"),
      "Give the reason in at least 10 characters.",
    );
  });
});

describe("what the person is told", () => {
  it("says each refusal in a sentence", () => {
    assert.equal(notesProblem(200), null);
    assert.match(notesProblem(0) ?? "", /could not be reached/);
    assert.match(notesProblem(401) ?? "", /Sign in again/);
    assert.equal(
      notesProblem(
        403,
        "only the note's resolution owner or the workpaper's preparer responds to it",
      ),
      "Only the note's resolution owner or the workpaper's preparer responds to it.",
    );
    assert.match(notesProblem(403) ?? "", /cannot do this/);
    assert.match(notesProblem(404) ?? "", /no longer here/);
    assert.equal(
      notesProblem(409, STALE),
      "The note changed since you read it. It is shown as it now stands: check it, then try again.",
    );
    assert.equal(
      notesProblem(409, "the note is cleared; reopen it first"),
      "The note is cleared; reopen it first.",
    );
    assert.equal(
      notesProblem(422, "write the note in at least 10 characters"),
      "Write the note in at least 10 characters.",
    );
    assert.match(notesProblem(422) ?? "", /Check what you wrote/);
    assert.match(notesProblem(500) ?? "", /did not reach the server/);
  });

  it("gives the reviewer's step its line and its link", () => {
    assert.equal(
      openLine({
        open: 2,
        responded: 1,
        cleared: 4,
        dismissed: 0,
        urgentOpen: 1,
      }),
      "3 review notes open · 1 urgent",
    );
    assert.equal(
      openLine({
        open: 1,
        responded: 0,
        cleared: 0,
        dismissed: 0,
        urgentOpen: 0,
      }),
      "1 review note open",
    );
    assert.equal(
      openLine({
        open: 0,
        responded: 0,
        cleared: 1,
        dismissed: 0,
        urgentOpen: 0,
      }),
      "No review note is open",
    );
    assert.equal(
      notesHref("/?step=designassessment#di-conclusion"),
      "/?step=designassessment#review-notes",
    );
  });
});

describe("the note's card (product owner, 16 November 2026: note card B)", () => {
  const event = (n: number, kind: string, text: string, data = {}) => ({
    id: uuid(700 + n),
    kind,
    by: { id: DANA, name: "Dana Lee" },
    at: `2026-11-15T15:0${n}:00Z`,
    text,
    data,
  });
  const threaded = () =>
    note(1, {
      events: [
        event(0, "RAISED", ""),
        event(1, "CRITICALITY", "", { from: "NORMAL", to: "URGENT" }),
        event(2, "RESPONDED", "The HRIS Security Owner.", { from: "OPEN" }),
        event(3, "OWNER", "", { from: DANA, to: RILEY, to_name: "Riley Park" }),
        event(4, "REPLIED", "Thanks, that reads well now."),
        event(5, "CLEARED", "", { from: "RESPONDED", to: "CLEARED" }),
        event(6, "REOPENED", "The dates still disagree."),
        event(7, "DISMISSED", "Not triggered is the right result."),
        event(8, "REPLIED", "   "),
        event(9, "SOMETHING_NEW", "From a later server."),
      ],
    });

  it("shows in the thread only the words people wrote, in order", () => {
    const shown = threadEvents(threaded());
    assert.deepEqual(
      shown.map((item) => item.kind),
      ["RESPONDED", "REPLIED", "REOPENED", "DISMISSED"],
    );
    assert.deepEqual(
      shown.map((item) => item.text),
      [
        "The HRIS Security Owner.",
        "Thanks, that reads well now.",
        "The dates still disagree.",
        "Not triggered is the right result.",
      ],
    );
    // The criticality, owner and clearing events stay on the note (nothing is lost).
    assert.equal(threaded().events.length, 10);
    assert.deepEqual(threadEvents(note(2)), []);
    // The reply count on a note's line is these replies.
    assert.equal(replyCount(threaded()), 4);
    assert.equal(replyCount(note(2)), 0);
  });

  it("says what a reply was after its time", () => {
    assert.deepEqual(threadEvents(threaded()).map(threadTag), [
      "responded",
      "",
      "reopened",
      "dismissed",
    ]);
  });

  // Rewritten. Old: the card's quiet second line, "#2 · <where> · owner Dana Lee"
  // (cardLine). New: the open note's quiet line, "<where> · <author>" (whereLine); the
  // owner is in the line's accessible name and in Change owner. Product owner, 16
  // November 2026: notes rail, inbox (option 3).
  it("writes the open note's quiet line: where and who raised it; never the highlighted words", () => {
    const words = note(2, {
      anchor_kind: "TEXT",
      field: attributeKey(ATTR_C, "result"),
      quote: "10/01 10:18 AM",
    });
    const context = { ...contextOf(PAPER_FIELDS) };
    const line = whereLine(words, context);
    assert.equal(line, `${whereWords(words, context)} · Riley Park`);
    assert.ok(!line.includes("10/01 10:18 AM"));
    assert.equal(
      whereLine(note(3, { anchor_kind: "WORKPAPER", field: "" })),
      "The workpaper as a whole · Riley Park",
    );
  });

  it("gives an open note its bold first line: its first sentence where short, else its first words", () => {
    assert.equal(
      headLine(
        "This is a test review note. Is the approval dated before the grant?",
      ),
      "This is a test review note.",
    );
    assert.equal(
      headLine("Who approves access?  On Workday."),
      "Who approves access?",
    );
    // A point inside a word does not end the sentence.
    assert.equal(
      headLine("Version 4.2 shows 10:28"),
      "Version 4.2 shows 10:28",
    );
    assert.equal(headLine("  two\n lines  "), "two lines");
    const long = `${"word ".repeat(30)}end.`;
    assert.equal(headLine(long), firstWords(long, 72));
    assert.ok([...headLine(long)].length <= 73);
  });

  it("gives a note's line its time today, its date otherwise", () => {
    const now = Date.parse("2026-11-16T15:00:00Z");
    const plain = (words: string) => words.replace(/\s/g, " ");
    assert.equal(
      plain(timeLabel("2026-11-16T07:14:00Z", now, "UTC")),
      "7:14 AM",
    );
    assert.equal(timeLabel("2026-11-15T14:04:00Z", now, "UTC"), "Nov 15");
    assert.equal(timeLabel("2025-11-15T14:04:00Z", now, "UTC"), "Nov 15, 2025");
    // The day is the person's: 23:30 on the 15th in UTC is the 16th in Manila.
    assert.equal(
      plain(timeLabel("2026-11-15T23:30:00Z", now, "Asia/Manila")),
      "7:30 AM",
    );
    assert.equal(timeLabel("not a time", now, "UTC"), "not a time");
  });

  it("folds a resolved note to its first words, cut at a word", () => {
    assert.equal(firstWords("Date format in step 3"), "Date format in step 3");
    assert.equal(
      firstWords(
        "Does the 1 business day run from the HR effective date or from the date HR enters it?",
        40,
      ),
      "Does the 1 business day run from the HR…",
    );
    assert.equal(firstWords("  two\n lines  "), "two lines");
    assert.ok([...firstWords("x".repeat(300))].length <= 57);
    assert.equal(closedWord(note(1, { status: "CLEARED" })), "resolved");
    assert.equal(closedWord(note(1, { status: "DISMISSED" })), "dismissed");
    assert.equal(closedWord(note(1)), "");
    assert.equal(closedWord(note(1, { status: "WITHDRAWN" })), "");
  });

  it("sends the reply box as the response only where the person may respond to an open note", () => {
    assert.equal(replyMode(note(1)), "respond");
    assert.equal(replyMode(note(1, { status: "RESPONDED" })), "reply");
    assert.equal(
      replyMode(note(1, { can: { ...CAN_ALL, respond: false } })),
      "reply",
    );
    assert.equal(
      replyMode(note(1, { can: { ...CAN_ALL, reply: false } })),
      "respond",
    );
    assert.equal(
      replyMode(
        note(1, {
          status: "CLEARED",
          can: { ...CAN_ALL, reply: false, respond: false },
        }),
      ),
      null,
    );
    // Anything the server did not say is no.
    assert.equal(replyMode(note(1, { can: {} })), null);
  });

  it("maps keys 1, 2, 3 to Urgent, Normal, Follow-up, and nothing else", () => {
    assert.equal(criticalityForKey("1"), "URGENT");
    assert.equal(criticalityForKey("2"), "NORMAL");
    assert.equal(criticalityForKey("3"), "FOLLOW_UP");
    for (const key of ["0", "4", "u", "Enter", "", "11"]) {
      assert.equal(criticalityForKey(key), null, key);
    }
  });
});

describe("the independent review of 16 November 2026", () => {
  it("10: a write whose answer did not come back is said as maybe saved, never 'nothing was changed'", () => {
    for (const status of [0, 500, 502, 504]) {
      assert.equal(writeInDoubt(status, false), true, String(status));
    }
    // A 200 whose note the page cannot read: it may well be on record.
    assert.equal(writeInDoubt(200, false), true);
    assert.equal(writeInDoubt(200, true), false);
    for (const status of [401, 403, 404, 409, 422]) {
      assert.equal(writeInDoubt(status, false), false, String(status));
    }
    assert.match(WRITE_IN_DOUBT, /may or may not have been saved/);
    assert.match(WRITE_IN_DOUBT, /read again/);
    assert.doesNotMatch(WRITE_IN_DOUBT, /Nothing was (changed|saved)/);
  });

  it("11: a closed note says who cleared or dismissed it, and when; its whole history is there on request", () => {
    const cleared = note(1, {
      status: "CLEARED",
      cleared_by: { id: RILEY, name: "Riley Park" },
      cleared_at: "2026-11-16T14:04:00Z",
      events: [
        {
          id: uuid(601),
          kind: "RAISED",
          by: { id: RILEY, name: "Riley Park" },
          at: "2026-11-15T14:04:00Z",
          text: "",
          data: {},
        },
        {
          id: uuid(602),
          kind: "CRITICALITY",
          by: { id: RILEY, name: "Riley Park" },
          at: "2026-11-16T13:00:00Z",
          text: "",
          data: { from: "URGENT", to: "NORMAL" },
        },
        {
          id: uuid(603),
          kind: "CLEARED",
          by: { id: RILEY, name: "Riley Park" },
          at: "2026-11-16T14:04:00Z",
          text: "",
          data: {},
        },
      ],
    });
    assert.equal(
      closedLine(cleared, "UTC"),
      "Cleared by Riley Park · Nov 16, 2:04 PM",
    );
    const dismissed = note(2, {
      status: "DISMISSED",
      dismissed_by: { id: SAM, name: "Sam Ortiz" },
      dismissed_at: "2026-11-16T09:30:00Z",
    });
    assert.equal(
      closedLine(dismissed, "UTC"),
      "Dismissed by Sam Ortiz · Nov 16, 9:30 AM",
    );
    assert.equal(closedLine(note(3)), "");
    // The thread shows only words; the history shows every row, the downgrade and the
    // clearing included.
    assert.equal(threadEvents(cleared).length, 0);
    const history = historyOf(cleared).map((row) => row.words);
    assert.equal(history.length, 3);
    assert.equal(history[0], "Riley Park raised the note");
    assert.match(history[1] ?? "", /criticality/);
    assert.equal(history[2], "Riley Park cleared the note");
  });

  it("14: words with zero-width or direction characters are anchored and found as the server keeps them", () => {
    const text =
      "Access was re\u200bmoved on 09/30 by the \u202aadministrator\u202c.";
    const start = text.indexOf("Access");
    const end = text.indexOf(" on");
    const anchor = anchorOf(text, start, end);
    assert.ok(anchor !== null);
    // The server's clean_quote leaves the invisible character out of what it keeps.
    assert.equal(anchor.quote, "Access was removed");
    assert.equal(anchor.quote, cleanQuote(text.slice(start, end)));
    assert.equal(anchor.suffix.includes("\u202a"), false);
    // The stored note is found again in the field as it reads, at its own offsets.
    const stored = {
      quote: anchor.quote,
      prefix: anchor.prefix,
      suffix: anchor.suffix,
      occurrence: anchor.occurrence,
    };
    assert.deepEqual(findAnchor(text, stored), { start, end });
    const word = anchorOf(
      text,
      text.indexOf("administrator"),
      text.indexOf("administrator") + "administrator".length,
    );
    assert.ok(word !== null);
    assert.deepEqual(findAnchor(text, word), {
      start: word.start,
      end: word.end,
    });
    // Nothing changes for a text without them.
    assert.equal(cleanQuote("plain words"), "plain words");
  });

  it("16: a selection of more words than a note holds is said, never taken as the field", () => {
    const long = "z".repeat(600);
    assert.equal(anchorOf(long, 0, 501), null);
    assert.equal(selectionTooLong(long, 0, 501), true);
    assert.equal(selectionTooLong(long, 0, 500), false);
    // Space alone is not "too long": it is nothing.
    assert.equal(selectionTooLong("a    b", 1, 5), false);
    assert.equal(
      TOO_LONG_WORDS,
      `Select at most ${NOTE_BOUNDS.quoteMax} characters to note them`,
    );
  });
});
