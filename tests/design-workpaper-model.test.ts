import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ATTRIBUTE_STATES,
  ATTRIBUTE_WITHOUT_TEXT,
  CONCLUSION_ANCHOR,
  choiceFactsOf,
  conclusionHref,
  conclusionOf,
  type DesignWorkpaper,
  deficiencyWanted,
  designWorkpaperPath,
  designWorkpaperQuery,
  EXCEPTIONS_NOTED,
  editableSections,
  evidenceLine,
  evidenceTitle,
  foldStartsOpen,
  headerOf,
  isSigned,
  keyed,
  LIMITS,
  loadProblem,
  MARK_WORDS,
  matrixOf,
  matterWords,
  NO_EXCEPTIONS_NOTED,
  openMatters,
  PROPOSED_BY_AGENT,
  PROPOSED_REVIEW,
  paragraphs,
  parseDesignWorkpaper,
  previewUrl,
  RESULT_WORDS,
  recordedLine,
  recordKey,
  refChip,
  refChips,
  rememberedView,
  rememberView,
  resultBoxes,
  SHOWN_BY_WORDS,
  sectionKeyFor,
  staleProblem,
  startingSelection,
  stateOf,
  statusOf,
  strayLine,
  TIMELINE_ACROSS_MOST,
  tickmarkLegend,
  tickmarkOf,
  tilesOf,
  timelineOf,
  uncited,
  VIEW_KEY,
  VIEWS,
  viewForKey,
  viewFrom,
  walkthroughHeaders,
  walkthroughIsDated,
  withoutCheck,
} from "../apps/web/src/design-workpaper-model.ts";

// The D&I workpaper in three views (docs/design-workpaper.md; product owner, 14 November
// 2026: "I wanted a professional audit workpaper", then "Can you build all three so the
// user would have three options?"). The server assembles what the views are built from;
// the web reads its answer cautiously and arranges it. Three things the model must never
// do: word a proposed conclusion as signed, hand a view something it cannot draw, and
// decide anything the server did not say.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ORG, PROJECT, CONTROL] = [uuid(1), uuid(2), uuid(3)] as const;

/** The synthetic sample the three prototypes were drawn from, as the API sends it. */
const sample = (): Record<string, unknown> =>
  JSON.parse(
    readFileSync("tests/fixtures/design-workpaper/sample.json", "utf8"),
  ) as Record<string, unknown>;

/** The sample with some fields replaced. */
const sent = (over: Record<string, unknown> = {}) => ({ ...sample(), ...over });

function parsed(over: Record<string, unknown> = {}): DesignWorkpaper {
  const paper = parseDesignWorkpaper(sent(over));
  assert.ok(paper !== null);
  return paper;
}

const raw = <T>(value: unknown): T => value as T;

/** The sample as a draft, as the server sends one: nothing is proposed until the
 * workpaper is prepared. */
const DRAFT = {
  workpaper: {
    ...raw<object>(sample().workpaper),
    status: "DRAFT",
    prepared_by: null,
    prepared_at: null,
  },
  review: { status: "NOT_READY", proposed: null, out_of_date: [] },
  conclusion: {
    ...raw<object>(sample().conclusion),
    proposed: null,
    words: "Not concluded yet",
  },
};

/** The real answer of the server's assembly for a synthetic control (a draft, two text
 * files, an exception): the second fixture. */
const serverSample = (): unknown =>
  JSON.parse(
    readFileSync("tests/fixtures/design-workpaper/server-sample.json", "utf8"),
  );
const attributesOf = () =>
  raw<Array<Record<string, unknown>>>(sample().attributes);

describe("reading the server's answer", () => {
  it("reads the whole contract", () => {
    const paper = parsed();
    assert.deepEqual(paper.control, {
      id: CONTROL,
      ref: "ITGC-AC-02",
      title: "Timely Removal of Terminated User Access",
      system: "Workday",
      engagement: "SOX FY2027",
      area: "IT general controls",
    });
    assert.deepEqual(paper.workpaper, {
      id: uuid(7),
      reference: "ITGC-AC-02-WORK-TOD",
      status: "PREPARED",
      drafting: false,
      version: 4,
      shownVersion: 1,
      currentVersion: 1,
      preparedBy: "Dana Lee",
      preparedAt: "2026-11-14T09:30:00Z",
    });
    assert.equal(paper.review.status, "TO_SIGN");
    assert.equal(paper.evidence.length, 7);
    assert.deepEqual(paper.evidence[2], {
      ref: "E3",
      fileId: uuid(23),
      fileName: "3_ex-b-account-disabled.png",
      kind: "walkthrough",
      kindWords: "Walkthrough evidence",
      requirementId: uuid(4),
      requirementTitle: "One leaver traced from termination to disablement",
      annotations: 7,
      reviewed: 2,
      leftOut: null,
      image: true,
    });
    assert.equal(paper.walkthrough.steps.length, 7);
    assert.deepEqual(paper.walkthrough.steps[1]?.refs, ["E1", "E2", "E6"]);
    assert.equal(paper.attributes.length, 4);
    assert.deepEqual(paper.attributes[2]?.refs[1], {
      ref: "E3",
      annotationIds: [uuid(103), uuid(105)],
      numbers: [3, 5],
    });
    assert.deepEqual(paper.attributes[2]?.marks, {
      E1: "IDENTIFIES",
      E2: "IDENTIFIES",
      E3: "SHOWS",
      E4: "SHOWS",
      E5: "SHOWS",
      E6: "IDENTIFIES",
    });
    assert.equal(paper.reports.length, 1);
    assert.equal(paper.matters.length, 3);
    assert.equal(paper.tickmarks.length, 4);
    assert.equal(paper.conclusion.signed, false);
    assert.equal(paper.canEdit, true);
  });

  it("is not an answer without a control to show it for", () => {
    for (const value of [
      null,
      undefined,
      "",
      [],
      42,
      {},
      { control: null },
      { control: { id: "ITGC-AC-02" } },
      sent({ control: { ref: "ITGC-AC-02" } }),
    ]) {
      assert.equal(parseDesignWorkpaper(value), null);
    }
  });

  it("reads a control with no workpaper yet, and everything else stays readable", () => {
    const paper = parsed({ workpaper: null });
    assert.equal(paper.workpaper, null);
    assert.equal(paper.evidence.length, 7);
    assert.deepEqual(statusOf(paper), {
      words: "No workpaper yet",
      tone: "neutral",
    });
    // A workpaper that is not a record with an id is none.
    assert.equal(parsed({ workpaper: { status: "DRAFT" } }).workpaper, null);
    assert.equal(parsed({ workpaper: "ITGC" }).workpaper, null);
  });

  it("never fails on what is missing: every list is empty and every sentence is ''", () => {
    const paper = parseDesignWorkpaper({ control: { id: CONTROL } });
    assert.ok(paper !== null);
    assert.equal(paper.workpaper, null);
    assert.equal(paper.review.status, "OTHER");
    assert.deepEqual(
      [
        paper.facts,
        paper.procedures,
        paper.evidence,
        paper.walkthrough.steps,
        paper.walkthrough.columns,
        paper.attributes,
        paper.reports,
        paper.matters,
        paper.tickmarks,
        paper.review.outOfDate,
      ],
      [[], [], [], [], [], [], [], [], [], []],
    );
    assert.equal(paper.risk, "");
    assert.equal(paper.conclusion.signed, false);
    assert.equal(paper.canEdit, false);
    // And each view's model still builds from it.
    assert.equal(matrixOf(paper).rows.length, 0);
    assert.equal(tilesOf(paper).length, 5);
    assert.deepEqual(timelineOf(paper.walkthrough), []);
    assert.equal(conclusionOf(paper).headline, "Not concluded yet");
    assert.equal(startingSelection(paper), null);
    assert.equal(headerOf(paper).rows.length, 4);
  });

  it("keeps a value it does not know as OTHER, in the server's own words", () => {
    const [first, ...rest] = attributesOf();
    const paper = parsed({
      attributes: [
        {
          ...first,
          state: "WAIVED",
          state_words: "Waived by the lead",
          tickmark: "REPERFORMED",
          marks: { E3: "CORROBORATES", E4: "SHOWS", E99: "SHOWS", E5: 7 },
        },
        ...rest,
      ],
      workpaper: { ...raw<object>(sample().workpaper), status: "ARCHIVED" },
      review: { status: "ESCALATED" },
    });
    const attribute = paper.attributes[0];
    assert.ok(attribute !== undefined);
    assert.equal(attribute.state, "OTHER");
    assert.deepEqual(stateOf(attribute), {
      words: "Waived by the lead",
      tone: "neutral",
    });
    // A tickmark this page does not know is no tickmark.
    assert.equal(attribute.tickmark, "NONE");
    assert.deepEqual(tickmarkOf(paper, "REPERFORMED"), {
      symbol: "",
      meaning: "No tickmark",
    });
    // An unknown mark is kept and worded neutrally; a file the index does not have, or a
    // mark that is not a word, is dropped.
    assert.deepEqual(attribute.marks, { E3: "OTHER", E4: "SHOWS" });
    assert.equal(matrixOf(paper).rows[0]?.cells[2]?.word, "Referenced");
    assert.equal(paper.workpaper?.status, "OTHER");
    assert.equal(statusOf(paper).words, "Status not stated");
    assert.equal(paper.review.status, "OTHER");
    // A state with no words from the server falls back to this page's own.
    assert.equal(
      stateOf({ state: "OTHER", stateWords: "" }).words,
      "Not stated",
    );
    assert.equal(
      stateOf({ state: "SHOWN_IN_PART", stateWords: "" }).words,
      "Shown in part",
    );
  });

  it("drops what a view could not draw or open", () => {
    const evidence = raw<Array<Record<string, unknown>>>(sample().evidence);
    const paper = parsed({
      evidence: [
        evidence[0],
        { ...evidence[1], file_id: "../../etc/passwd" },
        { ...evidence[2], ref: "X3" },
        { ...evidence[3], ref: "E1" },
        { ...evidence[4], requirement_id: "not-an-id" },
        "E6",
        null,
      ],
      matters: [
        { state: "OPEN", kind: "FINDING", text: "", refs: ["E1"] },
        {
          state: "WAITING",
          kind: "FINDING",
          text: "Kept.",
          refs: ["E1", "E2"],
        },
      ],
      reports: [
        { ref: "E7", report: "Sign-ons" },
        { ref: "E1", report: "" },
      ],
      tickmarks: [{ mark: "AGREED", symbol: "", meaning: "No symbol" }],
    });
    // One entry per reference, each with a file to open; a file whose request is not an
    // id is kept, and opens without annotations.
    assert.deepEqual(
      paper.evidence.map((entry) => [entry.ref, entry.requirementId]),
      [
        ["E1", uuid(4)],
        ["E5", null],
      ],
    );
    // References to files that are not in the index go.
    assert.deepEqual(paper.walkthrough.steps[1]?.refs, ["E1"]);
    assert.deepEqual(
      paper.attributes[0]?.refs.map((ref) => ref.ref),
      ["E5"],
    );
    assert.deepEqual(paper.attributes[0]?.marks, {
      E5: "SHOWS",
      E1: "IDENTIFIES",
    });
    // A matter with no words goes; a state this page does not know waits on a person
    // (only an exact NOTED is noted).
    assert.deepEqual(paper.matters, [
      { state: "OPEN", kind: "FINDING", text: "Kept.", refs: ["E1"] },
    ]);
    assert.deepEqual(paper.reports, [
      { ref: "", report: "Sign-ons", source: "", procedure: "" },
    ]);
    assert.deepEqual(paper.tickmarks, []);
  });

  it("is signed only when the server says so in as many words", () => {
    for (const signed of ["true", 1, "yes", null, undefined, {}]) {
      const paper = parsed({
        conclusion: { ...raw<object>(sample().conclusion), signed },
      });
      assert.equal(paper.conclusion.signed, false);
    }
    assert.equal(parsed({ can_edit: "true" }).canEdit, false);
    assert.equal(
      parsed({ workpaper: { ...raw<object>(sample().workpaper), drafting: 1 } })
        .workpaper?.drafting,
      false,
    );
  });

  it("numbers a walkthrough row that has no number, and drops an empty row", () => {
    const paper = parsed({
      walkthrough: {
        columns: ["Step", "Who", "Evidence inspected", "Result"],
        steps: [
          { step: "First", who: "HR" },
          { number: "2", step: "", evidence: "", result: "" },
          { number: 9, step: "Third", refs: "E1" },
        ],
      },
    });
    assert.deepEqual(
      paper.walkthrough.steps.map((step) => [
        step.number,
        step.step,
        step.refs,
      ]),
      [
        [1, "First", []],
        [9, "Third", []],
      ],
    );
  });
});

describe("the server's own answer (the second fixture)", () => {
  const paper = () => {
    const read = parseDesignWorkpaper(serverSample());
    assert.ok(read !== null);
    return read;
  };

  it("reads a draft with two text files and an exception", () => {
    const read = paper();
    assert.equal(read.control.ref, "ITGC-AC-01");
    assert.equal(read.workpaper?.status, "DRAFT");
    assert.equal(read.review.status, "NOT_READY");
    assert.deepEqual(
      read.evidence.map((entry) => [
        entry.ref,
        entry.fileName,
        entry.kindWords,
        entry.image,
        entry.annotations,
      ]),
      [
        ["E1", "ticket REQ-1041.txt", "Walkthrough evidence", false, 2],
        ["E2", "sap change log.txt", "Change history or audit log", false, 1],
      ],
    );
    assert.deepEqual(
      read.attributes.map((item) => [item.code, item.state, item.tickmark]),
      [
        ["A", "SHOWN", "COMPARED"],
        ["B", "EXCEPTION", "EXCEPTION"],
        ["C", "SHOWN", "AGREED"],
        ["D", "SHOWN", "AGREED"],
        ["E", "SHOWN", "AGREED"],
      ],
    );
    assert.deepEqual(read.attributes[1]?.marks, {
      E1: "EXCEPTION",
      E2: "EXCEPTION",
    });
    assert.deepEqual(read.reports, []);
    assert.equal(read.matters.length, 3);
    assert.equal(read.canEdit, true);
  });

  it("words it as a draft: nothing proposed, nothing signed, everything editable", () => {
    const read = paper();
    const conclusion = conclusionOf(read);
    assert.equal(conclusion.headline, "Not concluded yet");
    assert.equal(
      conclusion.standing,
      "The conclusion is proposed once the workpaper is prepared",
    );
    assert.equal(conclusion.signed, false);
    assert.equal(statusOf(read).words, "Draft for the preparer");
    assert.equal(editableSections(read).size, 5);
    assert.deepEqual(
      tilesOf(read).map((item) => [item.key, item.value, item.note]),
      [
        [
          "conclusion",
          "Not concluded yet",
          "The conclusion is proposed once the workpaper is prepared",
        ],
        ["attributes", "4 of 5 shown", "The rest are exceptions"],
        ["exceptions", "1 exception", "Attribute B"],
        ["matters", "2 open", read.matters[0]?.text],
        ["files", "2 files", "0 of 3 annotations reviewed"],
      ],
    );
  });

  it("draws its matrix, its tickmarks and its timeline", () => {
    const read = paper();
    const matrix = matrixOf(read);
    assert.deepEqual(
      matrix.rows.map((row) => row.cells.map((cell) => cell.word)),
      [
        ["Shows", "None"],
        ["Exception", "Exception"],
        ["Shows", "None"],
        ["Shows", "None"],
        ["Shows", "None"],
      ],
    );
    assert.deepEqual(
      matrix.key.map((item) => item.mark),
      ["EXCEPTION", "SHOWS"],
    );
    // The legend is the server's, as sent: three marks here, because no procedure of this
    // sample says a report's parameters were inspected (docs/design-workpaper.md, section 2;
    // before the 14 November 2026 review the server always sent INSPECTED as a fourth).
    assert.deepEqual(
      tickmarkLegend(read).map((item) => [item.mark, item.symbol]),
      [
        ["AGREED", "✓"],
        ["COMPARED", "≡"],
        ["EXCEPTION", "✗"],
      ],
    );
    assert.equal(tickmarkOf(read, "EXCEPTION").symbol, "✗");
    // A row's `when` is shown as it is written: never parsed, never reformatted.
    assert.deepEqual(
      timelineOf(read.walkthrough).map((stop) => [stop.head, stop.dated]),
      [
        ["2026-03-03", true],
        ["2026-03-04 09:12", true],
      ],
    );
    assert.deepEqual(
      refChip(read.attributes[0]?.refs[0] ?? "", read.evidence).label,
      "E1 · 2",
    );
  });

  it("cuts nothing the server can send", () => {
    const base = raw<Record<string, unknown>>(serverSample());
    const file = raw<Array<Record<string, unknown>>>(base.evidence)[0];
    const step = raw<{ steps: Array<Record<string, unknown>> }>(
      base.walkthrough,
    ).steps[0];
    const read = parseDesignWorkpaper({
      ...base,
      evidence: Array.from({ length: 60 }, (_, index) => ({
        ...file,
        ref: `E${index + 1}`,
        file_id: uuid(500 + index),
      })),
      walkthrough: {
        columns: ["Step", "Who", "Evidence inspected", "Result"],
        steps: Array.from({ length: 300 }, (_, index) => ({
          ...step,
          number: index + 1,
          when: "",
          refs: [`E${(index % 60) + 1}`],
        })),
      },
      facts: Array.from({ length: 60 }, (_, index) => ({
        label: `Fact ${index + 1}`,
        value: "As stored",
      })),
      matters: Array.from({ length: 12 }, (_, index) => ({
        state: "OPEN",
        kind: "FINDING",
        text: `Matter ${index + 1}`,
        refs: ["E60"],
      })),
      procedures: Array.from(
        { length: 8 },
        (_, index) => `Procedure ${index + 1}.`,
      ),
    });
    assert.ok(read !== null);
    assert.deepEqual(
      [
        read.evidence.length,
        read.walkthrough.steps.length,
        read.facts.length,
        read.matters.length,
        read.procedures.length,
      ],
      [60, 300, 60, 12, 8],
    );
    assert.equal(matrixOf(read).columns.length, 60);
    assert.ok(matrixOf(read).rows.every((row) => row.cells.length === 60));
    // With no time on any row, the timeline is its numbered steps and the document has
    // no When column.
    const stops = timelineOf(read.walkthrough);
    assert.equal(stops.length, 300);
    assert.deepEqual(
      [stops[0]?.head, stops[299]?.head, stops[299]?.dated],
      ["Step 1", "Step 300", false],
    );
    assert.equal(walkthroughIsDated(read.walkthrough), false);
    assert.deepEqual(stops[299]?.refs, ["E60"]);
    // And the page's own ceilings sit above the server's.
    assert.ok(LIMITS.evidence >= 60 && LIMITS.steps >= 300);
    assert.ok(LIMITS.facts >= 60 && LIMITS.matters >= 12);
    assert.ok(LIMITS.procedures >= 8);
    assert.ok(TIMELINE_ACROSS_MOST < 300);
  });
});

describe("the request", () => {
  const scope = { organizationId: ORG, projectId: PROJECT, controlId: CONTROL };

  it("reads the workpaper by the organization, the engagement and the control", () => {
    const query = designWorkpaperQuery(scope);
    assert.equal(
      designWorkpaperPath(new URLSearchParams(query)),
      `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/design-workpaper`,
    );
  });

  it("names no path when an id is not one", () => {
    for (const [key, value] of [
      ["organization", ""],
      ["project", "../x"],
      ["control", `${CONTROL}/../../users`],
      ["control", "1 OR 1=1"],
    ] as const) {
      const params = new URLSearchParams(designWorkpaperQuery(scope));
      params.set(key, value);
      assert.equal(designWorkpaperPath(params), null);
    }
    assert.equal(designWorkpaperPath(new URLSearchParams()), null);
  });

  it("says in a plain sentence why the views did not load, and what to do", () => {
    assert.equal(loadProblem(200), null);
    for (const status of [0, 400, 401, 403, 404, 422, 500, 502, 503]) {
      const sentence = loadProblem(status);
      assert.ok(sentence !== null);
      assert.match(sentence, /^[A-Z].*\.$/);
      assert.ok(
        !/\b(error|status|\d{3}|JSON|undefined|null)\b/i.test(sentence),
      );
    }
    assert.match(loadProblem(403) ?? "", /role cannot read/);
    assert.match(loadProblem(503) ?? "", /try again/);
    assert.notEqual(loadProblem(404), loadProblem(503));
  });

  it("shows a file through the preview's own routes", () => {
    assert.equal(
      previewUrl(scope, uuid(23)),
      `/workspace/evidence-files/${uuid(23)}/preview?organization=${ORG}&project=${PROJECT}`,
    );
    // Changed 14 November 2026 (review of the one viewer, item 4f). Old: readingUrl, the
    // read text's route, was asserted here, though nothing but this test used it. New: it
    // is removed; the viewer builds that route itself (tests/one-evidence-viewer.test.ts).
  });
});

describe("the remembered view", () => {
  it("offers Document, Matrix and Evidence, in that order", () => {
    assert.deepEqual(
      VIEWS.map((view) => [view.key, view.label]),
      [
        ["document", "Document"],
        ["matrix", "Matrix"],
        ["evidence", "Evidence"],
      ],
    );
  });

  it("is the document unless the browser kept another", () => {
    const kept = (value: string | null) => ({
      getItem: (key: string) => (key === VIEW_KEY ? value : null),
    });
    assert.equal(
      rememberedView(() => kept("matrix")),
      "matrix",
    );
    assert.equal(
      rememberedView(() => kept("evidence")),
      "evidence",
    );
    assert.equal(
      rememberedView(() => kept(null)),
      "document",
    );
    assert.equal(
      rememberedView(() => kept("spreadsheet")),
      "document",
    );
    assert.equal(
      rememberedView(() => kept("")),
      "document",
    );
    assert.equal(
      rememberedView(() => null),
      "document",
    );
    assert.equal(
      rememberedView(() => undefined),
      "document",
    );
    for (const value of [null, undefined, 3, {}, "MATRIX", "__proto__"]) {
      assert.equal(viewFrom(value), "document");
    }
  });

  it("survives a browser that refuses its store, reading or writing", () => {
    const refuses = () => {
      throw new Error("The operation is insecure.");
    };
    assert.equal(rememberedView(refuses), "document");
    assert.equal(
      rememberedView(() => ({ getItem: refuses })),
      "document",
    );
    assert.doesNotThrow(() => rememberView(refuses, "matrix"));
    assert.doesNotThrow(() =>
      rememberView(() => ({ setItem: refuses }), "matrix"),
    );
    assert.doesNotThrow(() => rememberView(() => null, "matrix"));
  });

  it("keeps the choice under one key", () => {
    const store = new Map<string, string>();
    rememberView(
      () => ({ setItem: (key, value) => void store.set(key, value) }),
      "evidence",
    );
    assert.deepEqual([...store], [[VIEW_KEY, "evidence"]]);
    assert.equal(
      rememberedView(() => ({ getItem: (key) => store.get(key) ?? null })),
      "evidence",
    );
  });

  it("moves between the tabs by the arrow keys, Home and End, round the ends", () => {
    assert.equal(viewForKey("document", "ArrowRight"), "matrix");
    assert.equal(viewForKey("matrix", "ArrowRight"), "evidence");
    assert.equal(viewForKey("evidence", "ArrowRight"), "document");
    assert.equal(viewForKey("document", "ArrowLeft"), "evidence");
    assert.equal(viewForKey("evidence", "ArrowLeft"), "matrix");
    assert.equal(viewForKey("evidence", "Home"), "document");
    assert.equal(viewForKey("document", "End"), "evidence");
    // A horizontal tab list: Up and Down are the page's own, like every other key.
    for (const key of [
      "ArrowUp",
      "ArrowDown",
      "Enter",
      " ",
      "Tab",
      "a",
      "Escape",
    ]) {
      assert.equal(viewForKey("matrix", key), null);
    }
  });
});

describe("the header, the status and the conclusion", () => {
  it("says who prepared and reviewed it, or Not yet", () => {
    const head = headerOf(parsed(DRAFT));
    assert.equal(head.eyebrow, "SOX FY2027 · IT general controls");
    assert.deepEqual(
      head.rows.map((row) => [row.label, row.value, row.pending]),
      [
        ["W/P reference", "ITGC-AC-02-WORK-TOD", false],
        ["Engagement", "SOX FY2027", false],
        ["Prepared by", "Not yet", true],
        ["Reviewed by", "Not yet", true],
      ],
    );
    assert.deepEqual(head.prepared, { by: null, on: null });
    assert.equal(head.version, "Version 1");
    assert.deepEqual(head.status, {
      words: "Draft for the preparer",
      tone: "warning",
    });
    // Prepared, waiting for the reviewer: the preparer is named, the reviewer is not.
    const waiting = headerOf(parsed());
    assert.equal(waiting.rows[2]?.value, "Dana Lee, Nov 14, 2026");
    assert.equal(waiting.rows[3]?.value, "Not yet");
    assert.deepEqual(waiting.status, {
      words: "Prepared, waiting for sign-off",
      tone: "info",
    });
  });

  it("names the preparer and the reviewer with their dates once they are on record", () => {
    const paper = parsed({
      workpaper: {
        ...raw<object>(sample().workpaper),
        shown_version: 2,
        current_version: 3,
      },
      review: {
        status: "SIGNED_OFF",
        proposed: "EFFECTIVE",
        signed_verdict: "EFFECTIVE",
        signed_by: "Sam Okafor",
        signed_at: "2026-11-15T16:00:00Z",
        out_of_date: [],
      },
      conclusion: { ...raw<object>(sample().conclusion), signed: true },
    });
    const head = headerOf(paper);
    assert.equal(head.rows[2]?.value, "Dana Lee, Nov 14, 2026");
    assert.equal(head.rows[3]?.value, "Sam Okafor, Nov 15, 2026");
    assert.deepEqual(head.reviewed, { by: "Sam Okafor", on: "Nov 15, 2026" });
    assert.equal(head.version, "Version 2 of 3");
    assert.deepEqual(head.status, {
      words: "Prepared and signed off",
      tone: "success",
    });
  });

  it("never names a reviewer for a conclusion that is not signed", () => {
    // A name on the review alone is not a signature: the server says `signed`.
    const paper = parsed({
      review: {
        status: "TO_SIGN",
        proposed: "EFFECTIVE",
        signed_by: "Sam Okafor",
        signed_at: "2026-11-15T16:00:00Z",
      },
    });
    assert.deepEqual(headerOf(paper).reviewed, { by: null, on: null });
    assert.equal(headerOf(paper).rows[3]?.value, "Not yet");
    assert.equal(conclusionOf(paper).signed, false);
  });

  it("words each state of the workpaper, and never a draft as prepared", () => {
    const paperOf = (over: object, review: object = {}) =>
      parsed({
        workpaper: { ...raw<object>(sample().workpaper), ...over },
        review: { ...raw<object>(sample().review), ...review },
      });
    assert.equal(
      statusOf(paperOf({ drafting: true })).words,
      "The agent is drafting",
    );
    assert.equal(
      statusOf(paperOf({ current_version: 0 })).words,
      "Not drafted",
    );
    assert.equal(statusOf(paperOf({})).words, "Prepared, waiting for sign-off");
    assert.equal(
      statusOf(paperOf({ status: "PREPARED" }, { status: "OUT_OF_DATE" }))
        .words,
      "Prepared, sign-off out of date",
    );
    // Signed off on the review alone, with the conclusion not signed: still waiting.
    assert.equal(
      statusOf(paperOf({ status: "PREPARED" }, { status: "SIGNED_OFF" })).words,
      "Prepared, waiting for sign-off",
    );
    for (const review of [
      "SIGNED_OFF",
      "TO_SIGN",
      "OUT_OF_DATE",
      "NOT_READY",
    ]) {
      assert.equal(
        statusOf(paperOf({ status: "DRAFT" }, { status: review })).words,
        "Draft for the preparer",
      );
    }
  });

  it("always words a proposed conclusion as proposed, in the agent's tone", () => {
    const conclusion = conclusionOf(parsed());
    assert.equal(conclusion.signed, false);
    assert.equal(conclusion.proposed, true);
    assert.equal(conclusion.headline, "Proposed: Effective");
    assert.equal(conclusion.standing, PROPOSED_BY_AGENT);
    assert.equal(conclusion.standing, "Proposed by the agent, not signed");
    assert.equal(conclusion.tone, "ai");
    // Whatever the verdict or who wrote it, an unsigned conclusion is never in the tone
    // of something approved, and never says Signed.
    for (const [source, proposed, words] of [
      ["AGENT", "NOT_EFFECTIVE", "Not effective"],
      ["PERSON", "EFFECTIVE", "Effective"],
      ["RECORDS", "EFFECTIVE", ""],
      ["SOMETHING", "EFFECTIVE", "Effective"],
    ] as const) {
      const view = conclusionOf(
        parsed({
          conclusion: {
            text: "A draft.",
            source,
            proposed,
            words,
            signed: false,
          },
          review: { status: "TO_SIGN", proposed },
        }),
      );
      assert.equal(view.signed, false);
      assert.equal(view.tone, "ai");
      assert.match(view.headline, /^Proposed: (Effective|Not effective)$/);
      assert.match(view.standing, /^Proposed.*not signed$/);
    }
    assert.equal(
      conclusionOf(
        parsed({
          conclusion: {
            text: "A draft.",
            source: "PERSON",
            proposed: "EFFECTIVE",
          },
        }),
      ).standing,
      "Proposed by a person, not signed",
    );
    // The verdict's words come from its code where the server sends no words, or only
    // the words of a draft.
    for (const words of ["", "Not concluded yet"]) {
      assert.equal(
        conclusionOf(
          parsed({
            conclusion: { source: "AGENT", proposed: "NOT_EFFECTIVE", words },
          }),
        ).headline,
        "Proposed: Not effective",
      );
    }
  });

  it("reads Not concluded yet on a draft, and never a verdict that is not proposed", () => {
    // What the server sends for a draft: no verdict, and the words "Not concluded yet".
    const draft = conclusionOf(parsed(DRAFT));
    assert.deepEqual(
      [draft.signed, draft.proposed, draft.stale, draft.verdict],
      [false, false, false, ""],
    );
    assert.equal(draft.headline, "Not concluded yet");
    assert.equal(
      draft.standing,
      "The conclusion is proposed once the workpaper is prepared",
    );
    assert.equal(draft.tone, "neutral");
    // The agent's drafted text is still shown; only the verdict waits.
    assert.match(draft.text, /^The control is designed to remove/);
    // Nothing a view shows names a value that is not there.
    for (const conclusion of [
      { text: "", source: "", proposed: null, words: "", signed: false },
      { proposed: null },
      { proposed: undefined, words: null },
      {},
      null,
    ]) {
      const view = conclusionOf(
        parsed({ ...DRAFT, conclusion, review: { status: "NOT_READY" } }),
      );
      const shown = `${view.headline} ${view.standing}`;
      assert.equal(view.headline, "Not concluded yet");
      assert.ok(!/null|undefined|Proposed:|Signed/.test(shown), shown);
    }
    // Prepared, with nothing proposed yet: it does not promise what already happened.
    assert.equal(
      conclusionOf(
        parsed({
          conclusion: { ...raw<object>(sample().conclusion), proposed: null },
          review: { status: "NOT_READY", proposed: null },
        }),
      ).standing,
      "The records propose no verdict yet",
    );
  });

  it("says who signed and when, once the server says it is signed", () => {
    const signed = conclusionOf(
      parsed({
        conclusion: { ...raw<object>(sample().conclusion), signed: true },
        review: {
          status: "SIGNED_OFF",
          signed_verdict: "EFFECTIVE",
          signed_by: "Sam Okafor",
          signed_at: "2026-11-15T16:00:00Z",
          out_of_date: [],
        },
      }),
    );
    assert.equal(signed.headline, "Signed: Effective");
    assert.equal(signed.standing, "Signed by Sam Okafor on Nov 15, 2026");
    assert.equal(signed.tone, "success");
    assert.equal(
      conclusionOf(
        parsed({
          conclusion: {
            words: "Not effective",
            proposed: "NOT_EFFECTIVE",
            signed: true,
          },
          review: { status: "SIGNED_OFF", signed_verdict: "NOT_EFFECTIVE" },
        }),
      ).tone,
      "danger",
    );
  });

  it("shows a sign-off that is out of date as out of date, never as signed", () => {
    // What the server sends: `signed` is false, the old record is still on the review,
    // and it lists why it no longer stands.
    const paper = parsed({
      conclusion: { ...raw<object>(sample().conclusion), signed: false },
      review: {
        status: "OUT_OF_DATE",
        proposed: "EFFECTIVE",
        signed_verdict: "EFFECTIVE",
        signed_by: "Sam Okafor",
        signed_at: "2026-11-15T16:00:00Z",
        out_of_date: ["The workpaper changed after the sign-off."],
      },
    });
    const stale = conclusionOf(paper);
    assert.deepEqual([stale.signed, stale.stale], [false, true]);
    assert.equal(stale.headline, "Proposed: Effective");
    assert.equal(
      stale.standing,
      "The sign-off by Sam Okafor on Nov 15, 2026 is out of date",
    );
    assert.equal(stale.tone, "warning");
    assert.deepEqual(stale.outOfDate, [
      "The workpaper changed after the sign-off.",
    ]);
    // No reviewer on the header or the signature line, and the status says so.
    const head = headerOf(paper);
    assert.deepEqual(head.reviewed, { by: null, on: null });
    assert.deepEqual(
      [head.rows[3]?.value, head.rows[3]?.pending],
      ["Sign-off out of date", true],
    );
    assert.equal(head.status.words, "Prepared, sign-off out of date");
    // The conclusion's tile says the same.
    const tile = tilesOf(paper)[0];
    assert.equal(tile?.value, "Proposed: Effective");
    assert.match(tile?.note ?? "", /is out of date$/);
    // Reopened to a draft, with the old sign-off still on the review.
    const reopened = conclusionOf(
      parsed({
        ...DRAFT,
        review: {
          status: "NOT_READY",
          signed_by: "Sam Okafor",
          signed_verdict: "EFFECTIVE",
          out_of_date: ["The workpaper was reopened."],
        },
      }),
    );
    assert.equal(reopened.headline, "Not concluded yet");
    assert.equal(
      reopened.standing,
      "The sign-off by Sam Okafor is out of date",
    );
    assert.equal(reopened.signed, false);
  });
});

describe("what the page holds even when an answer disagrees with itself", () => {
  const SIGNED = {
    conclusion: { ...raw<object>(sample().conclusion), signed: true },
    review: {
      status: "SIGNED_OFF",
      proposed: "EFFECTIVE",
      signed_verdict: "EFFECTIVE",
      signed_by: "Sam Okafor",
      signed_at: "2026-11-15T16:00:00Z",
      out_of_date: [],
    },
  };

  it("is signed only when signed, signed off, not out of date, on a prepared workpaper", () => {
    assert.equal(isSigned(parsed(SIGNED)), true);
    const not: Array<[string, Record<string, unknown>]> = [
      ["a draft", { ...SIGNED, workpaper: DRAFT.workpaper }],
      ["no workpaper", { ...SIGNED, workpaper: null }],
      [
        "to sign",
        { ...SIGNED, review: { ...SIGNED.review, status: "TO_SIGN" } },
      ],
      [
        "out of date by status",
        { ...SIGNED, review: { ...SIGNED.review, status: "OUT_OF_DATE" } },
      ],
      [
        "out of date by its reasons",
        {
          ...SIGNED,
          review: { ...SIGNED.review, out_of_date: ["The workpaper changed."] },
        },
      ],
      [
        "not ready",
        { ...SIGNED, review: { ...SIGNED.review, status: "NOT_READY" } },
      ],
      [
        "an unknown status",
        { ...SIGNED, review: { ...SIGNED.review, status: "DONE" } },
      ],
      [
        "not said to be signed",
        { ...SIGNED, conclusion: { ...SIGNED.conclusion, signed: false } },
      ],
      [
        "a workpaper of unknown status",
        {
          ...SIGNED,
          workpaper: { ...raw<object>(sample().workpaper), status: "ARCHIVED" },
        },
      ],
    ];
    for (const [name, over] of not) {
      const paper = parsed(over);
      assert.equal(isSigned(paper), false, name);
      // The three places that could say "signed" all agree, and no reviewer is named.
      const conclusion = conclusionOf(paper);
      const head = headerOf(paper);
      assert.equal(conclusion.signed, false, name);
      assert.ok(!/^Signed/.test(conclusion.headline), `${name}: headline`);
      assert.ok(!/^Signed/.test(conclusion.standing), `${name}: standing`);
      assert.notEqual(conclusion.tone, "success", name);
      assert.deepEqual(head.reviewed, { by: null, on: null }, name);
      assert.ok(!head.rows[3]?.value.includes("Sam Okafor"), name);
      assert.ok(!/signed off/.test(statusOf(paper).words), name);
      assert.ok(!/^Signed/.test(tilesOf(paper)[0]?.value ?? ""), name);
    }
    // And where it is signed, all three say so.
    const signed = parsed(SIGNED);
    assert.equal(conclusionOf(signed).signed, true);
    assert.equal(headerOf(signed).reviewed.by, "Sam Okafor");
    assert.equal(statusOf(signed).words, "Prepared and signed off");
    // The model has one rule for it, read by all three.
    const model = readFileSync(
      "apps/web/src/design-workpaper-model.ts",
      "utf8",
    );
    assert.equal(model.match(/conclusion\.signed\b(?! ===)/g)?.length, 1);
    assert.ok((model.match(/isSigned\(paper\)/g)?.length ?? 0) >= 4);
  });

  it("words a signed verdict from the sign-off, in the page's own words", () => {
    // The answer's words say one thing and the signed verdict another: the sign-off's
    // code is what was signed.
    const disagreeing = conclusionOf(
      parsed({
        conclusion: {
          ...SIGNED.conclusion,
          words: "Effective",
          proposed: "EFFECTIVE",
        },
        review: { ...SIGNED.review, signed_verdict: "NOT_EFFECTIVE" },
      }),
    );
    assert.equal(disagreeing.headline, "Signed: Not effective");
    assert.equal(disagreeing.tone, "danger");
    assert.equal(
      conclusionOf(
        parsed({
          conclusion: { ...SIGNED.conclusion, words: "Not effective" },
          review: SIGNED.review,
        }),
      ).headline,
      "Signed: Effective",
    );
    // A code this page does not know: the answer's words stand in, in a neutral tone.
    const unknown = conclusionOf(
      parsed({
        conclusion: {
          ...SIGNED.conclusion,
          words: "Effective with exceptions",
        },
        review: { ...SIGNED.review, signed_verdict: "QUALIFIED" },
      }),
    );
    assert.equal(unknown.headline, "Signed: Effective with exceptions");
    assert.equal(unknown.tone, "neutral");
    // No verdict on the sign-off: what was proposed, in the page's words.
    assert.equal(
      conclusionOf(
        parsed({
          conclusion: { ...SIGNED.conclusion, words: "anything" },
          review: { ...SIGNED.review, signed_verdict: null },
        }),
      ).headline,
      "Signed: Effective",
    );
    // A proposal is worded the same way.
    assert.equal(
      conclusionOf(
        parsed({
          conclusion: {
            ...raw<object>(sample().conclusion),
            proposed: "NOT_EFFECTIVE",
            words: "Effective",
          },
        }),
      ).headline,
      "Proposed: Not effective",
    );
  });

  it("words a known state itself, and an unknown one never as a known state", () => {
    // Whatever words come beside a state this page knows, the page's own are shown.
    // Rewritten 15 November 2026 (product owner): the Result reads as a workpaper says
    // it. Old: "Exception shown" and "Shown". New: "Exceptions noted" and "No exceptions
    // noted". The other states keep their words, and "No exceptions noted" is still said
    // of SHOWN alone.
    for (const [state, words, tone] of [
      ["EXCEPTION", "Exceptions noted", "danger"],
      ["SHOWN", "No exceptions noted", "success"],
      ["SHOWN_IN_PART", "Shown in part", "warning"],
      ["NOT_SHOWN", "Not shown", "warning"],
      ["NOT_CONCLUDED", "Not concluded", "info"],
      ["NOT_TESTED", "Not tested yet", "neutral"],
    ] as const) {
      for (const stateWords of [
        "",
        "Shown",
        "No exceptions noted",
        "Effective",
        "All good",
      ]) {
        assert.deepEqual(stateOf({ state, stateWords }), { words, tone });
      }
    }
    // An unknown state in the server's words, unless they are a known state's.
    assert.deepEqual(
      stateOf({ state: "OTHER", stateWords: "Waived by the lead" }),
      {
        words: "Waived by the lead",
        tone: "neutral",
      },
    );
    for (const stateWords of [
      "Shown",
      "shown",
      " SHOWN ",
      "Shown in part",
      "Exception shown",
      "No exceptions noted",
      "no exceptions noted",
      "Exceptions noted",
      "Exception recorded by the auditor",
      "",
    ]) {
      assert.deepEqual(stateOf({ state: "OTHER", stateWords }), {
        words: "Not stated",
        tone: "neutral",
      });
    }
    // An unknown state said to be "Shown" is not counted as shown.
    const [first, ...rest] = attributesOf();
    const paper = parsed({
      attributes: [
        { ...first, state: "VERIFIED", state_words: "Shown" },
        ...rest,
      ],
    });
    assert.equal(paper.attributes[0]?.state, "OTHER");
    const tile = tilesOf(paper).find((item) => item.key === "attributes");
    assert.equal(tile?.value, "2 of 4 shown");
    assert.equal(tile?.tone, "neutral");
    assert.equal(matrixOf(paper).rows[0]?.state.words, "Not stated");
    // "No exceptions noted" is said of SHOWN alone, and "Exceptions noted" only of an
    // exception: never of what was not shown, not tested, or settled by a person.
    for (const state of [...ATTRIBUTE_STATES, "OTHER"] as const) {
      const { words } = stateOf({ state, stateWords: "No exceptions noted" });
      assert.equal(words === NO_EXCEPTIONS_NOTED, state === "SHOWN", state);
      assert.equal(
        words === EXCEPTIONS_NOTED,
        state === "EXCEPTION" || state === "EXCEPTION_RECORDED",
        state,
      );
    }
  });

  it("gives an attribute no tickmark its state does not earn", () => {
    const [first, ...rest] = attributesOf();
    const tickmarkOn = (state: string, tickmark: unknown) =>
      parsed({ attributes: [{ ...first, state, tickmark }, ...rest] })
        .attributes[0]?.tickmark;
    for (const state of [
      "EXCEPTION",
      "SHOWN_IN_PART",
      "NOT_SHOWN",
      "NOT_CONCLUDED",
      "NOT_TESTED",
      "WAIVED",
    ]) {
      assert.equal(tickmarkOn(state, "AGREED"), "NONE", state);
      assert.equal(tickmarkOn(state, "COMPARED"), "NONE", state);
    }
    assert.equal(tickmarkOn("SHOWN", "AGREED"), "AGREED");
    assert.equal(tickmarkOn("SHOWN", "COMPARED"), "COMPARED");
    assert.equal(tickmarkOn("EXCEPTION", "EXCEPTION"), "EXCEPTION");
    for (const state of ["SHOWN", "NOT_CONCLUDED", "WAIVED"]) {
      assert.equal(tickmarkOn(state, "EXCEPTION"), "NONE", state);
    }
    for (const mark of [
      "INSPECTED",
      "REPERFORMED",
      "",
      null,
      7,
      "constructor",
    ]) {
      assert.equal(tickmarkOn("SHOWN", mark), "NONE");
    }
    // No tickmark is empty before the legend is read: a legend cannot give it a symbol.
    const paper = parsed({
      tickmarks: [
        { mark: "NONE", symbol: "✓", meaning: "Agreed." },
        {
          mark: "INSPECTED",
          symbol: "◊",
          meaning: "Report parameters inspected.",
        },
        { mark: "AGREED", symbol: "✓", meaning: "Agreed to the record." },
      ],
    });
    for (const mark of ["NONE", "INSPECTED", "OTHER", "", "toString"]) {
      assert.deepEqual(tickmarkOf(paper, mark), {
        symbol: "",
        meaning: "No tickmark",
      });
    }
    assert.deepEqual(tickmarkOf(paper, "AGREED"), {
      symbol: "✓",
      meaning: "Agreed to the record.",
    });
    // The legend itself is the server's, as sent (INSPECTED only when it sends it).
    assert.equal(tickmarkLegend(paper).length, 3);
  });

  it("treats a matter as open unless the server says exactly NOTED", () => {
    const states = (state: unknown) =>
      parsed({ matters: [{ state, kind: "FINDING", text: "A matter." }] })
        .matters[0]?.state;
    assert.equal(states("NOTED"), "NOTED");
    for (const state of [
      "OPEN",
      "noted",
      "Noted",
      "CLOSED",
      "RESOLVED",
      "",
      null,
      undefined,
      0,
    ]) {
      assert.equal(states(state), "OPEN", String(state));
    }
    assert.deepEqual(matterWords({ state: "OPEN", kind: "COMPLETENESS" }), {
      state: "Open",
      tone: "warning",
      kind: "Completeness or reliability",
    });
    // The line under a verdict counts what is open.
    assert.deepEqual(openMatters(parsed()), {
      count: 1,
      words: "1 matter open for the reviewer",
    });
    assert.equal(
      openMatters(
        parsed({
          matters: [
            { state: "OPEN", kind: "FINDING", text: "One." },
            { state: "SOMETHING", kind: "FILE", text: "Two." },
            { state: "NOTED", kind: "NOTE", text: "Three." },
          ],
        }),
      ).words,
      "2 matters open for the reviewer",
    );
    assert.deepEqual(openMatters(parsed({ matters: [] })), {
      count: 0,
      words: "No matter is open",
    });
  });

  it("keeps an attribute and an exception the answer names badly", () => {
    const [first, second, ...rest] = attributesOf();
    const paper = parsed({
      attributes: [
        { ...first, text: "", code: "" },
        {
          ...second,
          state: "EXCEPTION",
          marks: {
            E3: "SHOWS",
            E9: "EXCEPTION",
            E42: "EXCEPTION",
            E77: "SHOWS",
          },
        },
        ...rest,
      ],
      evidence: raw<Array<Record<string, unknown>>>(sample().evidence).map(
        (entry, index) =>
          index === 0 ? { ...entry, annotations: 2, reviewed: 9 } : entry,
      ),
    });
    // An attribute with an id is a row even with no wording, and is known by its place.
    assert.equal(paper.attributes.length, 4);
    assert.equal(paper.attributes[0]?.text, ATTRIBUTE_WITHOUT_TEXT);
    assert.equal(paper.attributes[0]?.text, "Attribute text not stated");
    assert.equal(paper.attributes[0]?.code, "1");
    assert.equal(paper.attributes[1]?.code, "B");
    // An exception on a file the index does not list is said on the row.
    assert.deepEqual(paper.attributes[1]?.marks, { E3: "SHOWS" });
    assert.equal(paper.attributes[1]?.strayExceptions, 2);
    assert.equal(
      strayLine({ strayExceptions: 1 }),
      "Exception on a file not listed",
    );
    assert.equal(
      matrixOf(paper).rows[1]?.stray,
      "Exceptions on 2 files not listed",
    );
    assert.equal(matrixOf(paper).rows[0]?.stray, "");
    assert.equal(strayLine({ strayExceptions: 0 }), "");
    // Never more reviewed than there are.
    assert.deepEqual(
      [paper.evidence[0]?.annotations, paper.evidence[0]?.reviewed],
      [2, 2],
    );
    // Rows whose numbers repeat are numbered by their place.
    const walked = parsed({
      walkthrough: {
        columns: [],
        steps: [
          { number: 1, step: "First" },
          { number: 1, step: "Second" },
          { number: 4, step: "Third" },
        ],
      },
    });
    assert.deepEqual(
      walked.walkthrough.steps.map((step) => step.number),
      [1, 2, 3],
    );
  });

  it("never looks a word up on what an object inherits", () => {
    const hostile = [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
      "valueOf",
    ];
    for (const key of hostile) {
      const [first, ...rest] = attributesOf();
      const paper = parsed({
        conclusion: {
          text: "A draft.",
          source: key,
          proposed: key,
          words: "",
          signed: false,
        },
        review: { status: key, proposed: key, signed_verdict: key },
        matters: [{ state: key, kind: key, text: "A matter.", refs: [key] }],
        attributes: [
          {
            ...first,
            state: key,
            state_words: "",
            tickmark: key,
            marks: { [key]: "SHOWS", E3: key },
            refs: [{ ref: key, annotation_ids: [key], numbers: [1] }],
          },
          ...rest,
        ],
        tickmarks: [{ mark: key, symbol: "✓", meaning: "Hostile." }],
      });
      const conclusion = conclusionOf(paper);
      const matter = paper.matters[0];
      assert.ok(matter !== undefined);
      const shown = [
        conclusion.headline,
        conclusion.standing,
        conclusion.verdict,
        statusOf(paper).words,
        matterWords(matter).kind,
        matterWords(matter).state,
        stateOf(paper.attributes[0] ?? { state: "OTHER", stateWords: "" })
          .words,
        tickmarkOf(paper, key).symbol,
        tickmarkOf(paper, key).meaning,
        ...tilesOf(paper).flatMap((item) => [item.value, item.note]),
        ...(matrixOf(paper).rows[0]?.cells.map((cell) => cell.word) ?? []),
        ...headerOf(paper).rows.map((row) => row.value),
      ];
      for (const value of shown) {
        assert.equal(typeof value, "string", key);
        assert.ok(
          !/function|\[object|native code/.test(value),
          `${key}: ${value}`,
        );
      }
      // A code that is no verdict proposes nothing.
      assert.equal(conclusion.headline, "Not concluded yet", key);
      assert.equal(conclusion.standing.includes(key), false, key);
      assert.equal(matterWords(matter).kind, "", key);
      assert.equal(tickmarkOf(paper, key).symbol, "", key);
      assert.equal(paper.attributes[0]?.tickmark, "NONE", key);
      assert.deepEqual(paper.attributes[0]?.marks, { E3: "OTHER" }, key);
    }
    const model = readFileSync(
      "apps/web/src/design-workpaper-model.ts",
      "utf8",
    );
    // Every table of words keyed by something the server sends is read through `own`.
    for (const table of [
      "VERDICT_WORDS",
      "SOURCE_WORDS",
      "MATTER_KINDS",
      "TICKMARK_FALLBACK",
    ]) {
      assert.ok(!model.includes(`${table}[`), table);
      assert.ok(model.includes(`own(${table},`), table);
    }
    assert.match(model, /Object\.hasOwn\(record, key\)/);
    assert.ok(!/\.marks\[/.test(model));
  });

  it("says a paper it could not read again may be out of date, and is not printed", () => {
    const sentence = staleProblem(loadProblem(503) ?? "");
    assert.match(sentence, /^What is shown could not be refreshed/);
    assert.match(sentence, /may be out of date/);
    assert.match(sentence, /cannot be printed yet/);
    assert.match(sentence, /try again\.$/);
  });
});

describe("the matrix", () => {
  it("has a row for each attribute and a cell for each file, every cell with a word", () => {
    const matrix = matrixOf(parsed());
    assert.deepEqual(
      matrix.columns.map((entry) => entry.ref),
      ["E1", "E2", "E3", "E4", "E5", "E6", "E7"],
    );
    assert.deepEqual(
      matrix.rows.map((row) => [
        row.code,
        row.cells.map((cell) => cell.symbol || "-").join(""),
      ]),
      [
        ["A", "●-✓✓✓--"],
        ["B", "--✓✓✓--"],
        ["C", "●●✓✓✓●-"],
        ["D", "------◊"],
      ],
    );
    for (const row of matrix.rows) {
      assert.equal(row.cells.length, 7);
      for (const cell of row.cells) {
        assert.ok(cell.word !== "", `${row.code} ${cell.ref}`);
        assert.equal(cell.mark === null, cell.word === "None");
      }
    }
    assert.deepEqual(
      matrix.rows[2]?.cells.map((cell) => cell.word),
      [
        "Identifies",
        "Identifies",
        "Shows",
        "Shows",
        "Shows",
        "Identifies",
        "None",
      ],
    );
    assert.deepEqual(matrix.rows[3]?.state, {
      words: "Not concluded",
      tone: "info",
    });
  });

  it("opens a mark on the first annotation the attribute cites in that file", () => {
    const matrix = matrixOf(parsed());
    const c = matrix.rows[2];
    assert.equal(c?.cells[2]?.annotationId, uuid(103));
    // A file the attribute marks but cites no annotation in opens on the file.
    assert.equal(c?.cells[1]?.annotationId, null);
    assert.equal(c?.cells[6]?.annotationId, null);
    assert.equal(matrix.rows[0]?.cells[2]?.annotationId, uuid(104));
  });

  it("lists in its key only the marks in use, strongest first", () => {
    assert.deepEqual(
      matrixOf(parsed()).key.map((item) => [item.mark, item.symbol]),
      [
        ["SHOWS", "✓"],
        ["IDENTIFIES", "●"],
        ["SOURCE", "◊"],
      ],
    );
    const [first, ...rest] = attributesOf();
    const withException = matrixOf(
      parsed({
        attributes: [
          { ...first, state: "EXCEPTION", marks: { E3: "EXCEPTION" } },
          ...rest,
        ],
      }),
    );
    assert.equal(withException.key[0]?.mark, "EXCEPTION");
    assert.equal(withException.rows[0]?.cells[2]?.word, "Exception");
    assert.equal(withException.rows[0]?.cells[2]?.tone, "danger");
    // Every mark has a symbol and a word of its own: never colour alone.
    const symbols = Object.values(MARK_WORDS).map((mark) => mark.symbol);
    assert.equal(new Set(symbols).size, symbols.length);
    for (const mark of Object.values(MARK_WORDS)) {
      assert.ok(mark.symbol !== "" && mark.word !== "" && mark.meaning !== "");
    }
  });

  it("says when no current check covers the attributes", () => {
    assert.equal(withoutCheck(parsed()), false);
    const untested = parsed({
      attributes: attributesOf().map((attribute) => ({
        ...attribute,
        state: "NOT_TESTED",
        marks: {},
        refs: [],
      })),
    });
    assert.equal(withoutCheck(untested), true);
    assert.equal(withoutCheck(parsed({ attributes: [] })), false);
    // The grid is still drawn: every cell says None.
    assert.ok(
      matrixOf(untested).rows.every((row) =>
        row.cells.every((cell) => cell.word === "None"),
      ),
    );
    assert.deepEqual(matrixOf(untested).key, []);
  });
});

describe("the tiles", () => {
  const tile = (paper: DesignWorkpaper, key: string) => {
    const found = tilesOf(paper).find((item) => item.key === key);
    assert.ok(found !== undefined, key);
    return found;
  };

  it("counts what the server sent: the conclusion, attributes, exceptions, matters, files", () => {
    const paper = parsed();
    assert.deepEqual(
      tilesOf(paper).map((item) => [item.key, item.value, item.note]),
      [
        [
          "conclusion",
          "Proposed: Effective",
          "Proposed by the agent, not signed",
        ],
        ["attributes", "3 of 4 shown", "1 not concluded"],
        ["exceptions", "None shown", "No current check shows one"],
        [
          "matters",
          "1 open",
          raw<Array<{ text: string }>>(sample().matters)[0]?.text,
        ],
        ["files", "7 files", "2 of 19 annotations reviewed"],
      ],
    );
    assert.equal(tile(paper, "conclusion").tone, "ai");
    assert.equal(tile(paper, "matters").tone, "warning");
    // A draft: the tile reads naturally, with no verdict.
    assert.deepEqual(
      [
        tile(parsed(DRAFT), "conclusion").value,
        tile(parsed(DRAFT), "conclusion").note,
        tile(parsed(DRAFT), "conclusion").tone,
      ],
      [
        "Not concluded yet",
        "The conclusion is proposed once the workpaper is prepared",
        "neutral",
      ],
    );
  });

  it("reads Signed on the conclusion's tile only once it is signed", () => {
    const signed = parsed({
      conclusion: { ...raw<object>(sample().conclusion), signed: true },
      review: { status: "SIGNED_OFF", signed_by: "Sam Okafor" },
    });
    assert.equal(tile(signed, "conclusion").value, "Signed: Effective");
    assert.equal(tile(signed, "conclusion").note, "Signed by Sam Okafor");
  });

  it("names the exceptions and what is left out", () => {
    const [a, b, c, d] = attributesOf();
    const evidence = raw<Array<Record<string, unknown>>>(sample().evidence);
    const paper = parsed({
      attributes: [
        { ...a, state: "EXCEPTION", state_words: "Exception shown" },
        b,
        { ...c, state: "EXCEPTION", state_words: "Exception shown" },
        { ...d, state: "NOT_TESTED", state_words: "Not tested yet" },
      ],
      matters: [{ state: "NOTED", kind: "NOTE", text: "Noted only." }],
      evidence: evidence.map((entry, index) =>
        index === 1
          ? {
              ...entry,
              left_out: "The file could not be read.",
              annotations: 0,
            }
          : { ...entry, annotations: 0, reviewed: 0 },
      ),
    });
    assert.deepEqual(
      [tile(paper, "exceptions").value, tile(paper, "exceptions").note],
      ["2 exceptions", "Attributes A and C"],
    );
    assert.equal(tile(paper, "exceptions").tone, "danger");
    assert.deepEqual(
      [tile(paper, "attributes").value, tile(paper, "attributes").note],
      ["1 of 4 shown", "1 not tested yet"],
    );
    assert.deepEqual(
      [tile(paper, "matters").value, tile(paper, "matters").note],
      ["None open", "1 noted"],
    );
    assert.deepEqual(
      [tile(paper, "files").value, tile(paper, "files").note],
      ["7 files", "No annotations yet, 1 left out of the check"],
    );
    assert.equal(tile(paper, "files").tone, "warning");
  });

  it("says so where there are no attributes and no files", () => {
    const bare = parsed({ attributes: [], evidence: [], matters: [] });
    assert.equal(tile(bare, "attributes").value, "None approved");
    assert.equal(tile(bare, "files").value, "No files yet");
    assert.equal(tile(bare, "matters").note, "Nothing waits on a person");
    const one = parsed({
      evidence: [raw<unknown[]>(sample().evidence)[0]],
    });
    assert.equal(tile(one, "files").value, "1 file");
  });
});

describe("the walkthrough as a timeline", () => {
  it("heads each stop with the time its row states, in the server's order", () => {
    const paper = parsed();
    const stops = timelineOf(paper.walkthrough);
    assert.equal(stops.length, 7);
    assert.deepEqual(
      stops
        .slice(0, 2)
        .map((stop) => [stop.number, stop.head, stop.dated, stop.who]),
      [
        [1, "09/24/2026 10:12 AM", true, "L. Moreno, HR"],
        [2, "09/25/2026 9:41 AM", true, "K. Cho; Workday"],
      ],
    );
    assert.deepEqual(stops[1]?.refs, ["E1", "E2", "E6"]);
    assert.equal(walkthroughIsDated(paper.walkthrough), true);
  });

  it("heads a stop with its step number where its row states no time, never sorted", () => {
    const paper = parsed({
      walkthrough: {
        columns: [],
        steps: [
          { number: 2, when: "", step: "Second in the list", who: "" },
          { number: 1, when: "", step: "", evidence: "Only the evidence" },
        ],
      },
    });
    assert.deepEqual(
      timelineOf(paper.walkthrough).map((stop) => [
        stop.number,
        stop.head,
        stop.dated,
        stop.text,
        stop.evidence,
      ]),
      [
        [2, "Step 2", false, "Second in the list", ""],
        [1, "Step 1", false, "Only the evidence", ""],
      ],
    );
    assert.equal(walkthroughIsDated(paper.walkthrough), false);
  });

  it("keeps the columns the section was drafted with, a When column apart", () => {
    assert.deepEqual(
      walkthroughHeaders(["Step", "Who", "Evidence inspected", "Result"]),
      {
        step: "Step",
        who: "Who",
        evidence: "Evidence inspected",
        result: "Result",
      },
    );
    assert.deepEqual(
      walkthroughHeaders([
        "When",
        "Activity",
        "Performer",
        "Inspected",
        "Outcome",
      ]),
      {
        step: "Activity",
        who: "Performer",
        evidence: "Inspected",
        result: "Outcome",
      },
    );
    // Any other shape reads under the standard template's headers.
    for (const columns of [[], ["Step"], ["a", "b", "c", "d", "e", "f"]]) {
      assert.equal(walkthroughHeaders(columns).evidence, "Evidence inspected");
    }
  });
});

describe("references, tickmarks and matters in words", () => {
  it("writes a reference as a chip, with the annotations it names", () => {
    const paper = parsed();
    const reference = paper.attributes[2]?.refs[1];
    assert.ok(reference !== undefined);
    const chip = refChip(reference, paper.evidence);
    assert.equal(chip.label, "E3 · 3 5");
    assert.equal(
      chip.name,
      "E3, 3_ex-b-account-disabled.png, annotations 3 and 5",
    );
    assert.equal(
      chip.title,
      "3_ex-b-account-disabled.png · Walkthrough evidence",
    );
    assert.equal(chip.entry?.fileId, uuid(23));
    // It opens on the first annotation it names.
    assert.equal(chip.annotationId, uuid(103));
    const plain = refChip("E7", paper.evidence);
    assert.deepEqual(
      [plain.label, plain.name, plain.annotationId],
      ["E7", "E7, 7_ex-e-signons-report.png", null],
    );
    assert.equal(
      refChip(
        { ref: "E3", annotationIds: [uuid(104)], numbers: [4] },
        paper.evidence,
      ).name,
      "E3, 3_ex-b-account-disabled.png, annotation 4",
    );
    assert.deepEqual(
      refChips(["E1", "E2"], paper.evidence).map((item) => item.label),
      ["E1", "E2"],
    );
  });

  it("gives a reference the index does not have no file to open", () => {
    const chip = refChip("E42", parsed().evidence);
    assert.deepEqual(
      [chip.label, chip.name, chip.title, chip.entry, chip.annotationId],
      ["E42", "E42", "", null, null],
    );
  });

  it("draws a tickmark from the server's legend, else from the contract's four", () => {
    const paper = parsed();
    assert.equal(tickmarkOf(paper, "AGREED").symbol, "✓");
    assert.equal(tickmarkOf(paper, "COMPARED").symbol, "≡");
    assert.equal(tickmarkOf(paper, "EXCEPTION").symbol, "✗");
    assert.deepEqual(tickmarkOf(paper, "NONE"), {
      symbol: "",
      meaning: "No tickmark",
    });
    assert.equal(tickmarkLegend(paper).length, 4);
    // Without a legend from the server: the marks the attributes use, in words.
    const bare = parsed({ tickmarks: [] });
    assert.deepEqual(
      tickmarkLegend(bare).map((item) => [item.mark, item.symbol]),
      [
        ["AGREED", "✓"],
        ["COMPARED", "≡"],
      ],
    );
    assert.match(tickmarkOf(bare, "COMPARED").meaning, /compared in code/);
  });

  it("words a matter: open waits on a person, the rest is noted", () => {
    assert.deepEqual(matterWords({ state: "OPEN", kind: "FOLLOW_UP" }), {
      state: "Open",
      tone: "warning",
      kind: "Follow-up",
    });
    assert.deepEqual(matterWords({ state: "NOTED", kind: "NOTE" }), {
      state: "Noted",
      tone: "neutral",
      kind: "Note",
    });
    assert.equal(matterWords({ state: "NOTED", kind: "NEW_KIND" }).kind, "");
    for (const kind of ["FINDING", "CONSIDERATION", "UNSETTLED", "FILE"]) {
      assert.ok(matterWords({ state: "OPEN", kind }).kind !== "");
    }
  });

  it("words an evidence file in one line", () => {
    const entry = parsed().evidence[2];
    assert.ok(entry !== undefined);
    assert.equal(
      evidenceLine(entry),
      "Walkthrough evidence · One leaver traced from termination to disablement · 2 of 7 annotations reviewed",
    );
    assert.equal(
      evidenceLine({ ...entry, annotations: 0, requirementTitle: "" }),
      "Walkthrough evidence",
    );
    // A file is named by its file name: the kind is shared by several files.
    assert.equal(evidenceTitle(entry), "3_ex-b-account-disabled.png");
  });

  it("takes the citation marks out of every section's text, and splits its paragraphs", () => {
    assert.equal(
      uncited("Sent on 09/25/2026 [^1]. Due the next day [^12]."),
      "Sent on 09/25/2026. Due the next day.",
    );
    assert.equal(uncited("No marks [here]."), "No marks [here].");
    assert.deepEqual(paragraphs("One [^1].\n\nTwo [^12] and more.\n\n\n"), [
      "One.",
      "Two and more.",
    ]);
    assert.deepEqual(paragraphs(""), []);
    // The answer carries no list of citations, so no view is handed a mark: the
    // understanding, the conclusion, the walkthrough's cells and a preparer's notes.
    const [first, ...rest] = attributesOf();
    const paper = parsed({
      understanding: "It operates daily [^1].\n\nOne instance was walked [^2].",
      conclusion: {
        ...raw<object>(sample().conclusion),
        text: "Effective [^3].",
      },
      walkthrough: {
        columns: [],
        steps: [
          {
            number: 1,
            when: "2026-03-03 [^4]",
            step: "Requested [^5]",
            who: "HR [^6]",
            evidence: "Ticket [^7]",
            result: "Approved [^8]",
          },
        ],
      },
      attributes: [{ ...first, notes: "Agreed with the owner [^9]." }, ...rest],
    });
    assert.equal(
      paper.understanding,
      "It operates daily.\n\nOne instance was walked.",
    );
    assert.equal(paper.conclusion.text, "Effective.");
    assert.deepEqual(paper.walkthrough.steps[0], {
      number: 1,
      when: "2026-03-03",
      step: "Requested",
      who: "HR",
      evidence: "Ticket",
      result: "Approved",
      refs: [],
    });
    assert.equal(paper.attributes[0]?.notes, "Agreed with the owner.");
    assert.ok(!JSON.stringify(parsed()).includes("[^"));
    assert.equal(paragraphs(parsed().understanding).length, 2);
  });

  it("gives two identical sentences different keys", () => {
    assert.deepEqual(
      keyed(["Same.", "Other.", "Same."], (item) => item).map(
        (item) => item.key,
      ),
      ["1:Same.", "2:Other.", "3:Same."],
    );
    // Two facts with one label, and two steps with one number, never share a key.
    const paper = parsed({
      facts: [
        { label: "System", value: "Workday" },
        { label: "System", value: "Okta" },
      ],
    });
    const facts = keyed(paper.facts, (item) => item.label).map(
      (item) => item.key,
    );
    assert.equal(new Set(facts).size, 2);
    const steps = keyed([{ number: 1 }, { number: 1 }, { number: 2 }], (item) =>
      String(item.number),
    ).map((item) => item.key);
    assert.equal(new Set(steps).size, 3);
  });
});

describe("what a person may edit, and where", () => {
  it("offers Edit on a draft the viewer may edit, and on nothing else", () => {
    const all = [
      "understanding",
      "walkthrough",
      "attributes",
      "reports",
      "conclusion",
    ];
    assert.deepEqual([...editableSections(parsed(DRAFT))], all);
    const paperOf = (over: object) =>
      parsed({ workpaper: { ...DRAFT.workpaper, ...over } });
    for (const paper of [
      parsed({ ...DRAFT, can_edit: false }),
      parsed({ workpaper: null }),
      parsed(),
      paperOf({ status: "PREPARED" }),
      paperOf({ drafting: true }),
      paperOf({ current_version: 0, shown_version: 0 }),
      // An earlier version on screen is read, not edited.
      paperOf({ shown_version: 1, current_version: 2 }),
      paperOf({ status: "ARCHIVED" }),
    ]) {
      assert.equal(editableSections(paper).size, 0);
    }
  });

  it("finds the existing editor's own section, for every standard template", () => {
    // The design tab's keys of each standard template, as services/api/
    // ai_workforce_api/workpapers.py defines them (a section's key is its title as a
    // slug: workpaper_fill.section_keys).
    const TEMPLATES: Record<string, string[]> = {
      itgc: [
        "control",
        "understanding-of-the-control",
        "walkthrough-of-one-instance",
        "information-produced-by-the-entity",
        "design-attributes",
        "design-conclusion",
        "sign-off",
      ],
      itac: [
        "control",
        "understanding-of-the-configuration",
        "walkthrough-of-one-instance",
        "reliance-on-it-general-controls",
        "design-attributes",
        "design-conclusion",
        "sign-off",
      ],
      business: [
        "control",
        "process-narrative",
        "walkthrough-of-one-instance",
        "segregation-of-duties",
        "information-produced-by-the-entity",
        "design-attributes",
        "design-conclusion",
        "sign-off",
      ],
      "key-report": [
        "control",
        "report-description",
        "source-data-and-logic",
        "reliance-on-it-general-controls",
        "design-attributes",
        "design-conclusion",
        "sign-off",
      ],
    };
    const found = (template: string) => {
      const keys = TEMPLATES[template] ?? [];
      return {
        understanding: sectionKeyFor("understanding", keys),
        walkthrough: sectionKeyFor("walkthrough", keys),
        attributes: sectionKeyFor("attributes", keys),
        reports: sectionKeyFor("reports", keys),
        conclusion: sectionKeyFor("conclusion", keys),
      };
    };
    assert.deepEqual(found("itgc"), {
      understanding: "understanding-of-the-control",
      walkthrough: "walkthrough-of-one-instance",
      attributes: "design-attributes",
      reports: "information-produced-by-the-entity",
      conclusion: "design-conclusion",
    });
    assert.deepEqual(found("itac"), {
      understanding: "understanding-of-the-configuration",
      walkthrough: "walkthrough-of-one-instance",
      attributes: "design-attributes",
      // No such section in this template: the fold opens at its top.
      reports: null,
      conclusion: "design-conclusion",
    });
    assert.deepEqual(found("business"), {
      understanding: "process-narrative",
      walkthrough: "walkthrough-of-one-instance",
      attributes: "design-attributes",
      reports: "information-produced-by-the-entity",
      conclusion: "design-conclusion",
    });
    assert.deepEqual(found("key-report"), {
      // The key report's understanding is its description: never "the reports".
      understanding: "report-description",
      walkthrough: null,
      attributes: "design-attributes",
      reports: null,
      conclusion: "design-conclusion",
    });
    // Reports are only ever the section the server reads them from.
    assert.equal(
      sectionKeyFor("reports", ["report-description", "design-conclusion"]),
      null,
    );
    assert.equal(sectionKeyFor("reports", ["recipe", "reports"]), null);
    // A firm's own template: by what its key says, where it says it.
    assert.equal(
      sectionKeyFor("walkthrough", ["our-walkthrough-of-the-sample"]),
      "our-walkthrough-of-the-sample",
    );
    assert.equal(
      sectionKeyFor("reports", ["information-produced-by-the-organization"]),
      "information-produced-by-the-organization",
    );
    assert.equal(sectionKeyFor("understanding", ["our-understanding"]), null);
    assert.equal(sectionKeyFor("walkthrough", []), null);
  });

  it("opens the fold while there is no workpaper, a draft runs, or something was just done", () => {
    const paper = { stage: "DESIGN", drafting: false };
    const closed = { papers: [paper], notice: null, viewing: null };
    assert.equal(foldStartsOpen(closed), false);
    assert.equal(foldStartsOpen({ ...closed, papers: [] }), true);
    assert.equal(foldStartsOpen({ ...closed, papers: null }), true);
    assert.equal(
      foldStartsOpen({ ...closed, papers: [{ ...paper, drafting: true }] }),
      true,
    );
    // The testing record does not count: only the D&I one.
    assert.equal(
      foldStartsOpen({
        ...closed,
        papers: [{ stage: "EFFECTIVENESS", drafting: false }],
      }),
      true,
    );
    assert.equal(
      foldStartsOpen({
        ...closed,
        papers: [paper, { stage: "EFFECTIVENESS", drafting: true }],
      }),
      false,
    );
    assert.equal(foldStartsOpen({ ...closed, notice: "wp-saved" }), true);
    assert.equal(
      foldStartsOpen({ ...closed, viewing: { id: "x", version: 1 } }),
      true,
    );
  });

  it("reads the views again when the D&I record changes, and only then", () => {
    const paper = {
      id: uuid(7),
      stage: "DESIGN",
      status: "DRAFT",
      drafting: false,
      version: 3,
      currentVersion: 1,
      shownVersion: 1,
    };
    const key = recordKey([paper]);
    assert.equal(recordKey([{ ...paper }]), key);
    for (const change of [
      { drafting: true },
      { version: 4 },
      { currentVersion: 2 },
      { shownVersion: 2 },
      { status: "PREPARED" },
    ]) {
      assert.notEqual(recordKey([{ ...paper, ...change }]), key);
    }
    // The testing record changing does not read the D&I views again.
    assert.equal(
      recordKey([paper, { ...paper, id: uuid(8), stage: "EFFECTIVENESS" }]),
      key,
    );
    assert.equal(recordKey(null), "");
    assert.equal(recordKey([]), "");
  });
});

describe("the evidence beside the workpaper", () => {
  it("opens on the first file an attribute cites, without opening an annotation", () => {
    assert.deepEqual(startingSelection(parsed()), {
      ref: "E3",
      annotationId: null,
    });
    // With nothing cited yet: the first file of the index.
    assert.deepEqual(
      startingSelection(
        parsed({
          attributes: attributesOf().map((item) => ({ ...item, refs: [] })),
        }),
      ),
      { ref: "E1", annotationId: null },
    );
    assert.equal(startingSelection(parsed({ evidence: [] })), null);
  });

  it("shows the reference a person selected, at the annotation it names", () => {
    const paper = parsed();
    assert.deepEqual(
      startingSelection(paper, { ref: "E5", annotationId: uuid(104) }),
      { ref: "E5", annotationId: uuid(104) },
    );
    // A file that is no longer in the index falls back to the first cited.
    assert.deepEqual(
      startingSelection(paper, { ref: "E99", annotationId: null }),
      { ref: "E3", annotationId: null },
    );
  });
});

// One conclusion, written in D&I Assessment (section 3.5); the preparer concludes and the
// agent proposes (section 3.6; product owner, 15 November 2026). The assembled view gains
// `attributes[].shown_by`, the design and implementation results, and the proposal and
// the preparer's choice on its conclusion part. Read cautiously: a missing field is null,
// and an unknown kind never reads as effective.

describe("the conclusion the preparer records, and the agent's proposal", () => {
  const CHOICE = uuid(60);
  const choice = {
    id: CHOICE,
    kind: "EXCEPTIONS_NOTED",
    basis: null,
    reason: "The late removal was on a holiday; access was not used.",
    proposed_kind: "EXCEPTIONS_NOTED",
    recorded_by: "Dana Lee",
    recorded_at: "2026-11-15T10:00:00Z",
    workpaper_version: 1,
  };
  const draft = {
    workpaper: {
      ...(sample().workpaper as Record<string, unknown>),
      status: "DRAFT",
      prepared_by: null,
      prepared_at: null,
    },
    review: {
      status: "NOT_READY",
      proposed: null,
      signed_verdict: null,
      signed_by: null,
      signed_at: null,
      out_of_date: [],
    },
  };
  const withConclusion = (
    conclusion: Record<string, unknown>,
    over: Record<string, unknown> = {},
  ) =>
    parsed({
      ...draft,
      conclusion: {
        ...(sample().conclusion as Record<string, unknown>),
        proposed: null,
        ...conclusion,
      },
      ...over,
    });

  it("reads the new fields, and nothing it does not know", () => {
    const paper = parsed({
      attributes: attributesOf().map((item, at) => ({
        ...item,
        shown_by: at === 0 ? "IMPLEMENTATION" : at === 1 ? "DESIGN" : "SOMEHOW",
      })),
      design: {
        result: "DESIGNED",
        sentence: "Every attribute is shown.",
        open: [],
      },
      implementation: {
        result: "OPEN",
        sentence: "Attribute D is not yet shown.",
        open: ["D"],
      },
      conclusion: {
        ...(sample().conclusion as Record<string, unknown>),
        proposed_conclusion: "NOT_CONCLUDED",
        proposed_reasons: [
          "Attribute D is not yet shown in the records of an instance.",
        ],
        choice,
      },
    });
    assert.deepEqual(
      paper.attributes.map((item) => item.shownBy),
      ["IMPLEMENTATION", "DESIGN", null, null],
    );
    assert.equal(paper.design?.result, "DESIGNED");
    assert.deepEqual(paper.implementation?.open, ["D"]);
    assert.equal(paper.conclusion.proposedConclusion, "NOT_CONCLUDED");
    assert.equal(paper.conclusion.choice?.kind, "EXCEPTIONS_NOTED");
    // An answer from before section 3.6: every new field is null.
    const old = parsed();
    assert.equal(old.design, null);
    assert.equal(old.implementation, null);
    assert.equal(old.conclusion.proposedConclusion, null);
    assert.deepEqual(old.conclusion.proposedReasons, []);
    assert.equal(old.conclusion.choice, null);
    assert.ok(old.attributes.every((item) => item.shownBy === null));
    // A way of being shown is read only of an attribute that reads "Shown".
    const notShown = parsed({
      attributes: attributesOf().map((item) => ({
        ...item,
        state: "NOT_SHOWN",
        shown_by: "IMPLEMENTATION",
      })),
    });
    assert.ok(notShown.attributes.every((item) => item.shownBy === null));
    // Unknown kinds: never effective, never a choice.
    const odd = withConclusion(
      {
        proposed_conclusion: "EFFECTIVE-ISH",
        choice: { ...choice, kind: "PASS" },
      },
      {
        design: { result: "GREAT", sentence: "", open: [] },
      },
    );
    assert.equal(odd.conclusion.proposedConclusion, null);
    assert.equal(odd.conclusion.choice, null);
    assert.equal(odd.design, null);
  });

  it("words the agent's proposal as a proposal to review, in the agent's tone", () => {
    const view = conclusionOf(
      withConclusion({
        proposed_conclusion: "EXCEPTIONS_NOTED",
        proposed_reasons: ["An exception stands on attribute B."],
      }),
    );
    assert.equal(view.proposed, true);
    assert.equal(view.recorded, false);
    assert.equal(view.signed, false);
    assert.equal(view.kind, "EXCEPTIONS_NOTED");
    assert.equal(view.headline, "Proposed: Exceptions noted");
    assert.equal(view.standing, PROPOSED_REVIEW);
    assert.equal(PROPOSED_REVIEW, "Proposed by the agent · review it");
    assert.equal(view.tone, "ai");
  });

  it("words a recorded conclusion by who recorded it, never as signed or green", () => {
    const view = conclusionOf(
      withConclusion({ proposed_conclusion: "EFFECTIVE", choice }),
    );
    assert.equal(view.recorded, true);
    assert.equal(view.signed, false);
    assert.equal(view.proposed, false);
    assert.equal(view.headline, "Recorded: Exceptions noted");
    assert.match(view.standing, /^Recorded by Dana Lee on /);
    assert.equal(view.tone, "info");
    assert.equal(
      recordedLine({
        id: CHOICE,
        kind: "EFFECTIVE",
        basis: null,
        reason: "",
        proposedKind: null,
        recordedBy: "",
        recordedAt: "",
        workpaperVersion: null,
      }),
      // Nobody named, no date: still who it is, never an empty name.
      "Recorded by the preparer",
    );
    // The tiles say it the same way.
    const tile = tilesOf(withConclusion({ choice })).find(
      (item) => item.key === "conclusion",
    );
    assert.equal(tile?.value, "Recorded: Exceptions noted");
  });

  it("words a signed conclusion by the preparer's words, only while the sign-off stands", () => {
    const signedPaper = parsed({
      review: {
        status: "SIGNED_OFF",
        proposed: "EFFECTIVE",
        signed_verdict: "EFFECTIVE",
        signed_by: "Riley Reviewer",
        signed_at: "2026-11-16T09:00:00Z",
        out_of_date: [],
      },
      conclusion: {
        ...(sample().conclusion as Record<string, unknown>),
        signed: true,
        proposed_conclusion: "EXCEPTIONS_NOTED",
        choice,
      },
    });
    const view = conclusionOf(signedPaper);
    assert.equal(view.signed, true);
    assert.equal(view.headline, "Signed: Exceptions noted");
    assert.match(view.standing, /^Signed by Riley Reviewer on /);
    // Exceptions noted, signed: concluded on, never the green of effective.
    assert.equal(view.tone, "warning");
    const effective = conclusionOf(
      parsed({
        review: {
          status: "SIGNED_OFF",
          proposed: "EFFECTIVE",
          signed_verdict: "EFFECTIVE",
          signed_by: "Riley Reviewer",
          signed_at: "2026-11-16T09:00:00Z",
          out_of_date: [],
        },
        conclusion: {
          ...(sample().conclusion as Record<string, unknown>),
          signed: true,
          choice: { ...choice, kind: "EFFECTIVE" },
        },
      }),
    );
    assert.equal(effective.tone, "success");
    // Out of date: never signed, and says so.
    const stale = conclusionOf(
      parsed({
        review: {
          status: "OUT_OF_DATE",
          proposed: "EFFECTIVE",
          signed_verdict: "EFFECTIVE",
          signed_by: "Riley Reviewer",
          signed_at: "2026-11-16T09:00:00Z",
          out_of_date: ["the preparer's conclusion changed"],
        },
        conclusion: {
          ...(sample().conclusion as Record<string, unknown>),
          signed: false,
          choice,
        },
      }),
    );
    assert.equal(stale.signed, false);
    assert.equal(stale.stale, true);
    assert.match(stale.standing, /is out of date$/);
    assert.equal(stale.tone, "warning");
  });

  it("says the design and the implementation results in the contract's words", () => {
    assert.deepEqual(
      [
        RESULT_WORDS.design.DESIGNED,
        RESULT_WORDS.implementation.IN_PLACE,
        RESULT_WORDS.design.EXCEPTIONS,
        RESULT_WORDS.implementation.OPEN,
      ],
      [
        "Designed to address the risk",
        "In place in the instance walked through",
        "Exceptions noted",
        "Not concluded",
      ],
    );
    const boxes = resultBoxes(
      parsed({
        design: {
          result: "DESIGNED",
          sentence: "Every attribute is shown.",
          open: [],
        },
        implementation: {
          result: "OPEN",
          sentence: "Attributes C and D are not yet shown.",
          open: ["C", "D"],
        },
      }),
    );
    assert.deepEqual(boxes, [
      {
        label: "Design",
        words: "Designed to address the risk",
        sentence: "Every attribute is shown.",
        open: "",
        tone: "info",
      },
      {
        label: "Implementation",
        words: "Not concluded",
        sentence: "Attributes C and D are not yet shown.",
        open: "Not yet shown: C, D",
        tone: "neutral",
      },
    ]);
    // Not sent: not concluded, never settled.
    assert.deepEqual(
      resultBoxes(parsed()).map((box) => box.words),
      ["Not concluded", "Not concluded"],
    );
    // Settled is never the green of a sign-off.
    assert.ok(boxes.every((box) => box.tone !== "success"));
    assert.deepEqual(SHOWN_BY_WORDS, {
      IMPLEMENTATION: "In the instance",
      DESIGN: "As designed",
    });
  });

  it("gives the choice what the records say, and offers the deficiency log where it matters", () => {
    const paper = withConclusion(
      { proposed_conclusion: "EXCEPTIONS_NOTED" },
      {
        attributes: attributesOf().map((item, at) => ({
          ...item,
          state: at === 1 ? "EXCEPTION_RECORDED" : item.state,
        })),
        design: {
          result: "EXCEPTIONS",
          sentence: "An exception stands on attribute B.",
          open: ["D"],
        },
        implementation: {
          result: "EXCEPTIONS",
          sentence: "An exception stands on attribute B.",
          open: ["D"],
        },
      },
    );
    const facts = choiceFactsOf(paper);
    assert.deepEqual(facts, {
      deficiency: false,
      exceptions: ["B"],
      design: "EXCEPTIONS",
      implementation: "EXCEPTIONS",
      implementationOpen: ["D"],
    });
    assert.equal(deficiencyWanted(facts, "EXCEPTIONS_NOTED"), true);
    // A design deficiency stands exactly where the agent proposes not effective.
    const deficient = choiceFactsOf(
      withConclusion({ proposed_conclusion: "NOT_EFFECTIVE" }),
    );
    assert.equal(deficient.deficiency, true);
    // Not effective with no deficiency logged: its sign-off needs one.
    const clean = choiceFactsOf(
      withConclusion(
        { proposed_conclusion: "EFFECTIVE" },
        {
          design: { result: "DESIGNED", sentence: "", open: [] },
          implementation: { result: "IN_PLACE", sentence: "", open: [] },
        },
      ),
    );
    assert.equal(deficiencyWanted(clean, "EFFECTIVE"), false);
    assert.equal(deficiencyWanted(clean, "NOT_EFFECTIVE"), true);
    assert.equal(deficiencyWanted(deficient, "NOT_EFFECTIVE"), false);
  });

  it("links to section 7 by its anchor", () => {
    assert.equal(CONCLUSION_ANCHOR, "di-conclusion");
    assert.equal(
      conclusionHref("/?organization=o&step=designassessment"),
      "/?organization=o&step=designassessment#di-conclusion",
    );
    assert.equal(conclusionHref("/?step=x#other"), "/?step=x#di-conclusion");
  });
});
