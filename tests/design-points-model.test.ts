import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CONSIDERED,
  considerationOf,
  consideredLine,
  considerRequest,
  DRAFT_MAX,
  DRAFTED_LABEL,
  decisionsList,
  decisionsWords,
  draftMessage,
  observationsOf,
  POINT_LIMITS,
  type Point,
  placeName,
  placeSection,
  pointAnchor,
  pointField,
  pointRefusal,
  pointRereads,
  pointShown,
  pointsAt,
  pointsOf,
  pointWrite,
  RAISED_SINCE,
  raisedSinceSigned,
  raisedWords,
  reasonProblem,
  SETTLE_WORDS,
  shownAt,
  unsettled,
  withdrawRequest,
  YOUR_DECISION,
} from "../apps/web/src/design-points-model.ts";
import { parseDesignWorkpaper } from "../apps/web/src/design-workpaper-model.ts";
import { signOffProblems } from "../apps/web/src/preparer-signoff-model.ts";

// The points of the D&I workpaper (docs/design-workpaper.md, section 3.9; product owner,
// 16 November 2026: "Is there any way we can present this not part of the actual
// workpaper?", then "Could cause confusion if you say there is still something open?",
// then "Okay proceed" to the prototype brief-proto/place.png, and "Considered, with
// reason"). There is no "Matters for the reviewer": each point is shown at its place, to
// the preparer only, and settled there; a considered point is part of the workpaper; the
// agent's observations become the draft of the message to the reviewer. What must hold:
// the body is read strictly, a point is never lost (an unknown place is the head of
// section 4), an unsettled point is never shown to others or on paper except as raised
// after the preparer signed, and the draft stays within the message's 1,000 characters.
// Synthetic data only.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const KEY_A = "a".repeat(32);
const KEY_B = "b".repeat(32);
const KEY_C = "c".repeat(32);
const KEY_D = "d".repeat(32);
const ATTR = uuid(14);
const FILE_REPORT = uuid(27);
const FILE_PLAIN = uuid(23);
const KNOWN = new Set(["E3", "E7"]);
const ids = { organizationId: uuid(1), projectId: uuid(2), controlId: uuid(3) };

const CONSIDERATION = {
  id: uuid(301),
  by: { id: uuid(31), name: "Dana Lee" },
  at: "2026-11-16T12:00:00Z",
  reason: "Access was removed on time, so the later check did not apply.",
};

const rawPoints = () => [
  {
    key: KEY_A,
    kind: "NOT_CONCLUDED",
    text: "Attribute D is not concluded.",
    refs: ["E7", "E99", "E7"],
    place: {
      at: "ATTRIBUTE",
      attribute_id: ATTR,
      file_id: null,
      requirement_id: null,
    },
    settle: ["TICKMARK", "CONSIDER"],
    considered: null,
  },
  {
    key: KEY_B,
    kind: "COMPLETENESS",
    text: "The screenshot does not show its source, run date or parameters.",
    refs: ["E7"],
    place: {
      at: "FILE",
      attribute_id: null,
      file_id: FILE_REPORT,
      requirement_id: null,
    },
    settle: ["CONSIDER", "RELIABILITY", "RELIABILITY", "DELETE"],
    considered: null,
  },
  {
    key: KEY_C,
    kind: "HELD",
    text: "A file was held out of the check: it could not be read.",
    refs: ["E3"],
    place: {
      at: "FILE",
      attribute_id: null,
      file_id: FILE_PLAIN,
      requirement_id: null,
    },
    settle: ["CONSIDER"],
    considered: CONSIDERATION,
  },
  {
    key: KEY_D,
    kind: "STALE",
    text: "The check of the request is out of date. Check the request again.",
    refs: [],
    place: {
      at: "REQUEST",
      attribute_id: null,
      file_id: null,
      requirement_id: uuid(4),
    },
    settle: ["RERUN", "CONSIDER"],
    considered: null,
  },
];

const PLACES = {
  attributes: [{ id: uuid(11) }, { id: ATTR }],
  reports: [{ ref: "E7" }],
  evidence: [
    { ref: "E3", fileId: FILE_PLAIN },
    { ref: "E7", fileId: FILE_REPORT },
  ],
};

const points = (): Point[] => pointsOf(rawPoints(), KNOWN);

describe("reading the points", () => {
  it("reads each point: key, kind, words, references, place, actions, consideration", () => {
    const read = points();
    assert.equal(read.length, 4);
    assert.deepEqual(read[0], {
      key: KEY_A,
      kind: "NOT_CONCLUDED",
      text: "Attribute D is not concluded.",
      // Once each, and only files the index has.
      refs: ["E7"],
      place: { at: "ATTRIBUTE", attributeId: ATTR },
      settle: ["TICKMARK", "CONSIDER"],
      considered: null,
    });
    // Each known action once, in the server's order, CONSIDER always last.
    assert.deepEqual(read[1]?.settle, ["RELIABILITY", "CONSIDER"]);
    assert.deepEqual(read[1]?.place, { at: "FILE", fileId: FILE_REPORT });
    assert.deepEqual(read[2]?.considered, CONSIDERATION);
    assert.deepEqual(read[3]?.place, {
      at: "REQUEST",
      requirementId: uuid(4),
    });
  });

  it("drops a point it cannot act on, and never loses one it can", () => {
    const read = pointsOf(
      [
        { key: "not-a-key", kind: "FINDING", text: "No key." },
        { key: KEY_A.toUpperCase(), kind: "FINDING", text: "Upper case." },
        { key: KEY_A, kind: "FINDING", text: "" },
        { key: KEY_B, kind: "SOMETHING_NEW", text: "Kept as OTHER." },
        { key: KEY_B, kind: "FINDING", text: "The same key again." },
        {
          key: KEY_C,
          kind: "FINDING",
          text: "A place it cannot read.",
          place: { at: "ATTRIBUTE", attribute_id: "../x" },
        },
        {
          key: KEY_D,
          kind: "FINDING",
          text: "A file that is not an id.",
          place: { at: "FILE", file_id: "x" },
          settle: "RERUN",
        },
        "a point",
        null,
      ],
      KNOWN,
    );
    assert.deepEqual(
      read.map((point) => [point.key, point.kind, point.place, point.settle]),
      [
        [KEY_B, "OTHER", { at: "REQUEST", requirementId: null }, ["CONSIDER"]],
        [
          KEY_C,
          "FINDING",
          { at: "REQUEST", requirementId: null },
          ["CONSIDER"],
        ],
        [
          KEY_D,
          "FINDING",
          { at: "REQUEST", requirementId: null },
          ["CONSIDER"],
        ],
      ],
    );
    assert.deepEqual(pointsOf(undefined, KNOWN), []);
    assert.deepEqual(pointsOf({ points: [] }, KNOWN), []);
    // The page's ceiling sits above what the server assembles.
    const many = pointsOf(
      Array.from({ length: 500 }, (_, index) => ({
        key: index.toString(16).padStart(32, "0"),
        kind: "FINDING",
        text: `Point ${index}`,
      })),
      KNOWN,
    );
    assert.equal(many.length, POINT_LIMITS.points);
  });

  it("reads a consideration only when it is whole", () => {
    assert.deepEqual(considerationOf(CONSIDERATION), CONSIDERATION);
    assert.deepEqual(
      considerationOf({ ...CONSIDERATION, by: { id: uuid(31), name: "" } })?.by,
      { id: uuid(31), name: "a team member" },
    );
    for (const value of [
      null,
      "yes",
      { ...CONSIDERATION, id: "1" },
      { ...CONSIDERATION, by: null },
      { ...CONSIDERATION, by: { id: "x", name: "Dana" } },
      { ...CONSIDERATION, reason: "   " },
    ]) {
      assert.equal(considerationOf(value), null, JSON.stringify(value));
    }
  });

  it("reads the observations in order, once each, at most 20", () => {
    const read = observationsOf(
      [
        { text: "Closed by the admin who granted it.", refs: ["E3", "E9"] },
        { text: "  " },
        { text: "Closed by the admin who granted it.", refs: [] },
        { text: "The report covers 1 to 14 October only." },
        "free text",
      ],
      KNOWN,
    );
    assert.deepEqual(read, [
      { text: "Closed by the admin who granted it.", refs: ["E3"] },
      { text: "The report covers 1 to 14 October only.", refs: [] },
    ]);
    const many = observationsOf(
      Array.from({ length: 30 }, (_, index) => ({ text: `Seen ${index}` })),
      KNOWN,
    );
    assert.equal(many.length, 20);
    assert.equal(many[19]?.text, "Seen 19");
  });

  it("is read into the workpaper with can_settle only as true", () => {
    const sample = JSON.parse(
      readFileSync("tests/fixtures/design-workpaper/sample.json", "utf8"),
    ) as Record<string, unknown>;
    const paper = parseDesignWorkpaper(sample);
    assert.ok(paper !== null);
    assert.equal(paper.points.length, 2);
    assert.equal(unsettled(paper.points).length, 1);
    assert.equal(paper.observations.length, 2);
    for (const value of [true, "true", 1, null, undefined]) {
      const read = parseDesignWorkpaper({ ...sample, can_settle: value });
      assert.equal(read?.canSettle, value === true, String(value));
    }
    // The removed list is not read, whatever the server still sends.
    const old = parseDesignWorkpaper({
      ...sample,
      matters: [{ state: "OPEN", kind: "FINDING", text: "An old matter." }],
    });
    assert.equal(Object.hasOwn(old ?? {}, "matters"), false);
  });
});

describe("where a point is shown", () => {
  it("puts each at its place: attribute row, report row, file line, head of section 4", () => {
    const [a, b, c, d] = points();
    assert.ok(a && b && c && d);
    assert.deepEqual(shownAt(a, PLACES), {
      where: "attribute",
      attributeId: ATTR,
    });
    // A file a section 5 row names: under that row.
    assert.deepEqual(shownAt(b, PLACES), { where: "report", index: 0 });
    // A file no row names: under its line in "Tickmarks and evidence".
    assert.deepEqual(shownAt(c, PLACES), { where: "evidence", ref: "E3" });
    assert.deepEqual(shownAt(d, PLACES), { where: "head" });
    // A row this read does not have: the head of section 4, never nowhere.
    assert.deepEqual(shownAt(a, { ...PLACES, attributes: [] }), {
      where: "head",
    });
    assert.deepEqual(shownAt(b, { ...PLACES, evidence: [] }), {
      where: "head",
    });
    assert.deepEqual(
      [placeName(shownAt(a, PLACES)), placeSection(shownAt(a, PLACES))],
      ["Section 4", 4],
    );
    assert.deepEqual(
      [placeName(shownAt(b, PLACES)), placeSection(shownAt(b, PLACES))],
      ["Section 5", 5],
    );
    assert.deepEqual(
      [placeName(shownAt(c, PLACES)), placeSection(shownAt(c, PLACES))],
      ["Tickmarks and evidence", 7],
    );
    assert.deepEqual(
      pointsAt(points(), PLACES, { where: "head" }).map((item) => item.key),
      [KEY_D],
    );
    assert.deepEqual(
      pointsAt(points(), PLACES, { where: "report", index: 0 }).map(
        (item) => item.key,
      ),
      [KEY_B],
    );
    assert.deepEqual(
      pointsAt(points(), PLACES, { where: "evidence", ref: "E7" }),
      [],
    );
    assert.equal(pointAnchor(KEY_A), `dw-point-${KEY_A}`);
    assert.equal(pointField(KEY_A), `points.${KEY_A}`);
  });
});

describe("who sees a point", () => {
  const unsettledPoint = { considered: null };
  const considered = { considered: CONSIDERATION };

  it("shows an unsettled point to the preparer only, and never on paper", () => {
    const preparer = { canSettle: true, status: "DRAFT" as const };
    const other = { canSettle: false, status: "DRAFT" as const };
    assert.equal(pointShown(unsettledPoint, preparer, false), "decide");
    assert.equal(pointShown(unsettledPoint, other, false), "hidden");
    assert.equal(pointShown(unsettledPoint, preparer, true), "hidden");
  });

  it("shows a point raised after the preparer signed to everyone on screen, as raised", () => {
    const prepared = { canSettle: false, status: "PREPARED" as const };
    assert.equal(pointShown(unsettledPoint, prepared, false), "raised");
    // The print never carries an unsettled point.
    assert.equal(pointShown(unsettledPoint, prepared, true), "hidden");
    assert.equal(raisedSinceSigned(points(), "PREPARED"), 3);
    assert.equal(raisedSinceSigned(points(), "DRAFT"), 0);
    assert.equal(raisedSinceSigned(points(), null), 0);
  });

  it("shows a considered point to everyone, and on paper", () => {
    for (const facts of [
      { canSettle: true, status: "DRAFT" as const },
      { canSettle: false, status: "DRAFT" as const },
      { canSettle: false, status: "PREPARED" as const },
      { canSettle: false, status: null },
    ]) {
      assert.equal(pointShown(considered, facts, false), "considered");
      assert.equal(pointShown(considered, facts, true), "considered");
    }
  });
});

describe("the counts and their words", () => {
  it("counts the decisions before the preparer signs, and lists each with its place", () => {
    assert.equal(unsettled(points()).length, 3);
    assert.equal(decisionsWords(2), "2 decisions before you sign.");
    assert.equal(decisionsWords(1), "1 decision before you sign.");
    assert.equal(decisionsWords(0), "");
    assert.deepEqual(
      decisionsList(points(), PLACES).map((item) => [
        item.key,
        item.place,
        item.anchor,
      ]),
      [
        [KEY_A, "Section 4", pointAnchor(KEY_A)],
        [KEY_B, "Section 5", pointAnchor(KEY_B)],
        [KEY_D, "Section 4", pointAnchor(KEY_D)],
      ],
    );
    // Short words: cut at a word, with an ellipsis where cut.
    const long = pointsOf(
      [{ key: KEY_A, kind: "FINDING", text: `${"word ".repeat(60)}end.` }],
      KNOWN,
    );
    const words = decisionsList(long, PLACES)[0]?.words ?? "";
    assert.ok(words.length <= 91 && words.endsWith("…"), words);
  });

  it("holds the preparer's sign-off while any point is not settled, after the 3.7 needs", () => {
    const ready = {
      status: "DRAFT" as const,
      drafting: false,
      latest: true,
      choice: { kind: "EFFECTIVE" as const },
      unsaved: false,
      behind: false,
    };
    assert.deepEqual(signOffProblems({ ...ready, points: 0 }), []);
    assert.deepEqual(signOffProblems({ ...ready, points: 2 }), [
      "2 decisions before you sign.",
    ]);
    assert.deepEqual(signOffProblems({ ...ready, choice: null, points: 1 }), [
      "Record a conclusion first.",
      "1 decision before you sign.",
    ]);
    // Nothing waits on a prepared workpaper's row.
    assert.deepEqual(
      signOffProblems({ ...ready, status: "PREPARED", points: 2 }),
      [],
    );
  });

  it("tells the reviewer to return it where points were raised since the preparer signed", () => {
    assert.equal(
      raisedWords(1),
      "1 point was raised since the preparer signed: return it to the preparer.",
    );
    assert.equal(
      raisedWords(3),
      "3 points were raised since the preparer signed: return it to the preparer.",
    );
    assert.equal(raisedWords(0), "");
  });

  it("words a considered point as one quiet line", () => {
    assert.equal(
      consideredLine(CONSIDERATION),
      // Old: "16 Nov" (en-GB); new: "Nov 16", the date style of the sign-off on the same
      // page (screenshot check of 3.9, 16 November 2026).
      "Considered by Dana Lee, Nov 16: Access was removed on time, so the later check did not apply.",
    );
    assert.equal(
      consideredLine({ ...CONSIDERATION, at: "" }),
      "Considered by Dana Lee: Access was removed on time, so the later check did not apply.",
    );
  });

  it("never says 'open' or 'the client'", () => {
    const words = [
      YOUR_DECISION,
      RAISED_SINCE,
      CONSIDERED,
      DRAFTED_LABEL,
      ...Object.values(SETTLE_WORDS),
      decisionsWords(2),
      raisedWords(2),
      consideredLine(CONSIDERATION),
      ...[401, 403, 404, 409, 422, 500, 0].flatMap((status) => [
        pointRefusal("consider", status, ""),
        pointRefusal("withdraw", status, ""),
      ]),
    ];
    for (const said of words) {
      assert.equal(/\bopen\b/i.test(said), false, said);
      assert.equal(/the client/i.test(said), false, said);
    }
  });
});

describe("the message drafted from the agent's observations", () => {
  it("is one observation per line", () => {
    assert.equal(
      draftMessage([
        { text: "Closed by the admin who granted it." },
        { text: "  The report covers\n1 to 14 October only.  " },
        { text: "" },
      ]),
      "Closed by the admin who granted it.\nThe report covers 1 to 14 October only.",
    );
    assert.equal(draftMessage([]), "");
  });

  it("stays within the message's 1,000 characters, cut at a whole line", () => {
    const line = "x".repeat(299);
    // Three lines of 299 and their two line breaks: 899. A fourth would make 1,199.
    const draft = draftMessage([
      { text: line },
      { text: line },
      { text: line },
      { text: line },
    ]);
    assert.equal(draft.split("\n").length, 3);
    assert.equal(draft.length, 899);
    assert.equal(DRAFT_MAX, 1000);
    // Exactly at the limit is kept whole.
    const exact = draftMessage([
      { text: "y".repeat(499) },
      { text: "z".repeat(500) },
    ]);
    assert.equal(exact.length, 1000);
    // A line that does not fit ends the draft: nothing after it is taken.
    const stopped = draftMessage([
      { text: "a".repeat(600) },
      { text: "b".repeat(600) },
      { text: "short" },
    ]);
    assert.equal(stopped, "a".repeat(600));
    // A first line longer than the message alone is cut at a word, within it.
    const cut = draftMessage([{ text: `${"word ".repeat(400)}end` }]);
    assert.ok(cut.length <= 1000, String(cut.length));
    assert.ok(cut.endsWith("…"));
  });
});

describe("the writes", () => {
  it("builds the consider and withdraw requests", () => {
    assert.deepEqual(considerRequest(ids, KEY_A, "A reason given.", 5), {
      organization_id: ids.organizationId,
      project_id: ids.projectId,
      control_id: ids.controlId,
      key: KEY_A,
      reason: "A reason given.",
      workpaper_version: 5,
    });
    assert.deepEqual(withdrawRequest(ids, KEY_A, uuid(301), 6), {
      organization_id: ids.organizationId,
      project_id: ids.projectId,
      control_id: ids.controlId,
      key: KEY_A,
      consideration_id: uuid(301),
      workpaper_version: 6,
    });
  });

  it("forwards only what the contract names, to the point's own path", () => {
    const consider = pointWrite(
      "consider",
      considerRequest(ids, KEY_A, "  A reason given.  ", 5),
    );
    assert.deepEqual(consider, {
      intent: "consider",
      path: `/organizations/${ids.organizationId}/projects/${ids.projectId}/design-conclusions/${ids.controlId}/points/${KEY_A}/consider`,
      body: { reason: "A reason given.", workpaper_version: 5 },
    });
    const withdraw = pointWrite(
      "withdraw",
      withdrawRequest(ids, KEY_A, uuid(301), 6),
    );
    assert.deepEqual(withdraw, {
      intent: "withdraw",
      path: `/organizations/${ids.organizationId}/projects/${ids.projectId}/design-conclusions/${ids.controlId}/points/${KEY_A}/withdraw`,
      body: { consideration_id: uuid(301), workpaper_version: 6 },
    });
  });

  it("refuses anything else before the API sees it", () => {
    const good = considerRequest(ids, KEY_A, "A reason given.", 5);
    for (const over of [
      { organization_id: "x" },
      { project_id: 7 },
      { control_id: undefined },
      { key: "../../users" },
      { key: KEY_A.toUpperCase() },
      { workpaper_version: 0 },
      { workpaper_version: 1.5 },
      { workpaper_version: "5" },
      { reason: "too short" },
      { reason: "r".repeat(1001) },
      { reason: "password: hunter2 is the reason" },
      { reason: 42 },
    ]) {
      assert.deepEqual(
        pointWrite("consider", { ...good, ...over }),
        { error: "invalid" },
        JSON.stringify(over),
      );
    }
    assert.deepEqual(
      pointWrite("withdraw", {
        ...withdrawRequest(ids, KEY_A, uuid(301), 6),
        consideration_id: "not-an-id",
      }),
      { error: "invalid" },
    );
    // A reason is 10 to 1,000 characters, counted without the spaces around it.
    assert.equal(reasonProblem("  123456789  ") !== null, true);
    assert.equal(reasonProblem("1234567890"), null);
    assert.equal(reasonProblem("r".repeat(1000)), null);
    assert.notEqual(reasonProblem("r".repeat(1001)), null);
  });

  it("says a refusal in the server's sentence, and reads again where in doubt", () => {
    assert.equal(pointRefusal("consider", 200, ""), "");
    assert.equal(
      pointRefusal(
        "consider",
        409,
        "This point changed; read the workpaper again.",
      ),
      "Not recorded: This point changed; read the workpaper again.",
    );
    assert.equal(
      pointRefusal("withdraw", 409, ""),
      "Not withdrawn: this point changed; read the workpaper again.",
    );
    assert.match(pointRefusal("consider", 0, ""), /may not have been recorded/);
    assert.match(pointRefusal("consider", 422, ""), /10 to 1000 characters/);
    for (const status of [0, 409, 500, 503]) {
      assert.equal(pointRereads(status), true, String(status));
    }
    for (const status of [200, 403, 422]) {
      assert.equal(pointRereads(status), false, String(status));
    }
  });
});
