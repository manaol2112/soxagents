import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  andList,
  CHECK_PROPOSED,
  type CheckDigest,
  calmUnderStatus,
  checkDigest,
  DIGEST_NOTHING,
  DIGEST_TICKMARKED,
  RELIABILITY_KEY,
  STATUS_NOTHING,
  STATUS_OPEN,
  type StatusFacts,
  statusLine,
} from "../apps/web/src/check-digest-model.ts";
import { lettersSpan } from "../apps/web/src/design-evidence-model.ts";
import {
  NOT_RELIED_ON,
  notReliedOnLine,
  parseDesignWorkpaper,
  REPORT_INSPECTED,
  reportInspected,
  tilesOf,
} from "../apps/web/src/design-workpaper-model.ts";
import {
  ASSURANCE_INTENTS,
  assuranceWrite,
  COMPLETENESS_WORDS,
  FILE_NOT_ON_REQUEST,
  type Lettered,
  parseAssurance,
  RELIABILITY_BOUNDS,
  type RequestCheck,
  type RowFile,
  reliabilityProblem,
  requestCheck,
} from "../apps/web/src/evidence-assurance-model.ts";
import {
  RELIABILITY_DECIDE,
  RELIABILITY_ENDING_WORDS,
  RELIABILITY_WORDS,
  reliabilityDraftFrom,
  reliabilityEndingLine,
  reliabilityFields,
  reliabilityHeadline,
  reliabilityOffer,
  reliabilityProblems,
  reliabilityQuiet,
} from "../apps/web/src/file-reliability-model.ts";

// What is left after a person's work, and a person's decision on a file's reliability
// (docs/evidence-assurance.md, section 10.14), on the web. What must hold: the first line
// says what a person's work settled and what is left, in the contract's order, and says
// "Nothing waits on you." only where nothing is left; it never says the evidence is
// sufficient; the server's `file_reliability` is read strictly and its absence leaves the
// page as it was; a file whose reliability is open is an item with "Decide", and once
// decided goes to the quiet line in its own words, never as more shown; only what the
// contract takes is sent; and the workpaper words the decision as the server sends it.
// Every input goes through the real parser and requestCheck, as the screen's does.
// Synthetic data only.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C, D] = [uuid(1), uuid(2), uuid(3), uuid(4)] as const;
const REQUEST = uuid(11);
const [HR, EXPORT, LOG] = [uuid(31), uuid(32), uuid(33)] as const;
const GONE = uuid(39);
const [ORG, PROJECT, CONTROL] = [uuid(51), uuid(52), uuid(53)] as const;
const FILES: RowFile[] = [
  { id: HR, name: "1_hr-termination.png" },
  { id: EXPORT, name: "2_hr-export.xlsx" },
  { id: LOG, name: "06_Workday_Security_Activity_Export.csv" },
];
const LOG_NAME = "06_Workday_Security_Activity_Export.csv";

const lettered: Lettered[] = [A, B, C, D].map((id, at) => ({
  id,
  letter: "ABCD".charAt(at),
  text: `Attribute ${"ABCD".charAt(at)} wording.`,
}));

const passage = () => ({
  quote: "Account Disabled On 09/30/2026",
  file_id: HR,
  location: { label: "Image 1" },
});

function shown(id: string, code: string, over: Record<string, unknown> = {}) {
  return {
    attribute_id: id,
    code,
    expected: true,
    verdict: "SUPPORTED",
    result: "MET",
    shows: "IMPLEMENTATION",
    summary: `The records show attribute ${code}.`,
    passages: [passage()],
    absent: [],
    views: [],
    finding_id: null,
    finding_status: null,
    assessment: "SATISFIED",
    checks: [],
    elements: [
      {
        key: `${code}1`,
        text: `Element of ${code}.`,
        result: "MET",
        absent: [],
        passages: [passage()],
      },
    ],
    ...over,
  };
}

function gap(id: string, code: string, over: Record<string, unknown> = {}) {
  return shown(id, code, {
    verdict: "ISSUE",
    result: "NOT_MET",
    shows: null,
    summary: `Nothing shows attribute ${code}.`,
    passages: [],
    absent: [`The record that shows ${code}.`],
    assessment: "NOT_DEMONSTRATED",
    elements: [],
    ...over,
  });
}

const disposition = (n: number, kind: string) => ({
  id: uuid(900 + n),
  kind,
  reason: "Recorded with a reason long enough.",
  relied_on: kind === "NOT_AVAILABLE" ? "The HR leaver report." : "",
  annotation_id: null,
  recorded_by_name: "Dana Lee",
  recorded_at: "2026-11-14T09:30:00Z",
  version: 1,
});

const QUESTION = `${LOG_NAME} is a report that does not show its source, run date or parameters, so its completeness and accuracy are not established.`;

const decision = (over: Record<string, unknown> = {}) => ({
  id: uuid(800),
  kind: "ESTABLISHED_ON_REVIEW",
  reason: "I watched the export run with the owner on 2 October.",
  relied_on: "The parameters screen and the record count, 212 rows.",
  recorded_by_name: "Dana Lee",
  recorded_at: "2026-11-14T10:00:00Z",
  ...over,
});

const ended = (over: Record<string, unknown> = {}) => ({
  ...decision({ id: uuid(801), kind: "NOT_RELIED_ON", relied_on: "" }),
  ended_at: "2026-11-14T09:50:00Z",
  ended_by_name: "Dana Lee",
  ended_as: "REPLACED",
  ended_reason: "",
  ...over,
});

const reliable = (over: Record<string, unknown> = {}) => ({
  file_id: LOG,
  question: QUESTION,
  decision: null,
  history: [],
  ...over,
});

function review(over: Record<string, unknown> = {}) {
  return {
    overall: "UNABLE_TO_CONCLUDE",
    explanation: "The support rests on a report whose basis is not shown.",
    completeness: {
      state: "RELIABILITY_UNRESOLVED",
      reasons: [QUESTION],
    },
    context_thin: false,
    files: [],
    confirmations: [],
    concerns: [],
    follow_ups: [],
    follow_ups_more: 0,
    follow_ups_dropped: 0,
    resolved: [],
    considerations: [],
    ...over,
  };
}

/** The product owner's case: A and C shown; B and D carry a person's closing tickmark;
 * the security activity export's reliability is not established. */
function entry(over: Record<string, unknown> = {}) {
  return {
    requirement_id: REQUEST,
    run_id: uuid(62),
    status: "REVIEWED",
    stage: "DONE",
    held: null,
    held_files: [],
    file_ids: [HR, EXPORT, LOG],
    lens: "INSTANCE_RECORD",
    read_in_part: false,
    attributes: [
      shown(A, "A"),
      gap(B, "B", { disposition: disposition(1, "NOT_AVAILABLE") }),
      shown(C, "C"),
      gap(D, "D", { disposition: disposition(2, "NOT_APPLICABLE") }),
    ],
    out_of_date: [],
    finished_at: "2026-11-14T10:00:00Z",
    note: "",
    engine_version: 2,
    review: review(),
    file_reliability: [reliable()],
    ...over,
  };
}

const span = (letters: readonly string[]) =>
  lettersSpan(
    letters,
    lettered.map((item) => item.letter),
  );

function check(
  over: Record<string, unknown> = {},
  files: RowFile[] = FILES,
): RequestCheck {
  const [request] = parseAssurance({ requests: [entry(over)] })?.requests ?? [];
  assert.ok(request !== undefined);
  return requestCheck(request, lettered, files, span);
}

function digest(
  over: Record<string, unknown> = {},
  findings: Array<{ id: string; status: string }> = [],
  files: RowFile[] = FILES,
): CheckDigest {
  const made = checkDigest(check(over, files), findings, files);
  assert.ok(made !== null);
  return made;
}

const reliabilityOf = (over: Record<string, unknown>) =>
  parseAssurance({ requests: [entry(over)] })?.requests[0]?.fileReliability ??
  [];

describe("reading the server's file_reliability (section 10.14)", () => {
  it("reads each entry as the contract shapes it", () => {
    const [read] = reliabilityOf({
      file_reliability: [
        reliable({ decision: decision(), history: [ended()] }),
      ],
    });
    assert.deepEqual(read, {
      fileId: LOG,
      question: QUESTION,
      decision: {
        id: uuid(800),
        kind: "ESTABLISHED_ON_REVIEW",
        reason: "I watched the export run with the owner on 2 October.",
        reliedOn: "The parameters screen and the record count, 212 rows.",
        recordedBy: "Dana Lee",
        recordedAt: "2026-11-14T10:00:00Z",
      },
      history: [
        {
          id: uuid(801),
          kind: "NOT_RELIED_ON",
          reason: "I watched the export run with the owner on 2 October.",
          reliedOn: "",
          recordedBy: "Dana Lee",
          recordedAt: "2026-11-14T10:00:00Z",
          endedAt: "2026-11-14T09:50:00Z",
          endedBy: "Dana Lee",
          endedAs: "REPLACED",
          endedReason: "",
        },
      ],
    });
  });

  it("leaves the page as it was where the server sends none, or sends something else", () => {
    for (const value of [undefined, null, "x", {}, [null, 3, "x"]]) {
      const over =
        value === undefined
          ? { file_reliability: undefined }
          : { file_reliability: value };
      assert.deepEqual(reliabilityOf(over), [], String(value));
      assert.deepEqual(check(over).reliability, [], String(value));
    }
    // Before this increment's server: no key at all.
    const { file_reliability: _, ...older } = entry();
    const [request] = parseAssurance({ requests: [older] })?.requests ?? [];
    assert.deepEqual(request?.fileReliability, []);
    // An entry with no file id that is one is not taken.
    assert.deepEqual(
      reliabilityOf({ file_reliability: [{ file_id: "E3" }] }),
      [],
    );
  });

  it("is read only of a finished, current check", () => {
    for (const status of [
      "QUEUED",
      "CHECKING",
      "HELD",
      "FAILED",
      "OUT_OF_DATE",
    ]) {
      assert.deepEqual(reliabilityOf({ status }), [], status);
    }
    assert.deepEqual(
      reliabilityOf({ out_of_date: ["A file was added after the check."] }),
      [],
    );
    // A first-engine run that the server still sends an entry for is read.
    assert.equal(reliabilityOf({ engine_version: 1, review: null }).length, 1);
  });

  it("never takes a decision it cannot read: the file's reliability stays open", () => {
    for (const bad of [
      decision({ kind: "RELIABLE" }),
      decision({ kind: undefined }),
      decision({ id: "800" }),
      decision({ id: null }),
      // Established on review needs what was relied on.
      decision({ relied_on: "" }),
      decision({ relied_on: "   " }),
      "ESTABLISHED_ON_REVIEW",
    ]) {
      const [read] = reliabilityOf({
        file_reliability: [reliable({ decision: bad })],
      });
      assert.equal(read?.decision, null, JSON.stringify(bad));
    }
    // "Not relied on" carries nothing relied on, whatever came with it.
    const [notRelied] = reliabilityOf({
      file_reliability: [
        reliable({
          decision: decision({
            kind: "NOT_RELIED_ON",
            relied_on: "x".repeat(20),
          }),
        }),
      ],
    });
    assert.equal(notRelied?.decision?.reliedOn, "");
  });

  it("keeps every ending, an unknown one only as no longer standing, at most ten, each once", () => {
    const [read] = reliabilityOf({
      file_reliability: [
        reliable({
          history: [
            ended({
              id: uuid(810),
              ended_as: "REOPENED",
              ended_reason: "Wrong file.",
            }),
            ended({
              id: uuid(811),
              ended_as: "FILE_GONE",
              ended_by_name: null,
            }),
            ended({ id: uuid(812), ended_as: "SOMETHING_NEW" }),
            ended({ id: uuid(810) }),
            ...Array.from({ length: 12 }, (_, at) =>
              ended({ id: uuid(820 + at) }),
            ),
          ],
        }),
      ],
    });
    assert.equal(read?.history.length, RELIABILITY_BOUNDS.history);
    assert.deepEqual(
      read?.history.slice(0, 3).map((item) => [item.endedAs, item.endedBy]),
      [
        ["REOPENED", "Dana Lee"],
        ["FILE_GONE", null],
        ["OTHER", "Dana Lee"],
      ],
    );
    assert.equal(
      new Set(read?.history.map((item) => item.id)).size,
      read?.history.length,
    );
  });

  it("reads one entry per file, bounded", () => {
    const many = reliabilityOf({
      file_reliability: [
        reliable(),
        reliable({ question: "Listed twice." }),
        ...Array.from({ length: 70 }, (_, at) =>
          reliable({ file_id: uuid(1000 + at) }),
        ),
      ],
    });
    assert.equal(many.length, RELIABILITY_BOUNDS.files);
    assert.equal(many[0]?.question, QUESTION);
  });

  it("names each file as the row does, in the row's order; one the row no longer holds last, never offered", () => {
    const made = check({
      file_reliability: [
        reliable({ file_id: GONE }),
        reliable(),
        reliable({ file_id: HR, question: "" }),
      ],
    });
    assert.deepEqual(
      made.reliability.map((line) => [line.fileId, line.name, line.inForce]),
      [
        [HR, "1_hr-termination.png", true],
        [LOG, LOG_NAME, true],
        [GONE, FILE_NOT_ON_REQUEST, false],
      ],
    );
    assert.equal(reliabilityOffer(made, { inForce: false }, true), null);
  });
});

describe("the first screen of the owner's case (section 10.14)", () => {
  it("before the decision: the file is an item with the check's sentence and Decide; the caveat is said by it", () => {
    const made = digest();
    const items = made.attention.filter((item) =>
      item.key.startsWith(RELIABILITY_KEY),
    );
    assert.equal(items.length, 1);
    assert.deepEqual(
      [
        items[0]?.kind,
        items[0]?.mark,
        items[0]?.headline,
        items[0]?.context,
        items[0]?.control,
        items[0]?.attributeKey,
      ],
      [
        "FILE",
        "E3",
        `Reliability of ${LOG_NAME} not established`,
        QUESTION,
        { type: "RELIABILITY", fileId: LOG, label: "Decide" },
        null,
      ],
    );
    assert.equal(reliabilityHeadline(LOG_NAME), items[0]?.headline);
    assert.equal(RELIABILITY_DECIDE, "Decide");
    // The completeness caveat is said per file: not again on the quiet line.
    assert.equal(
      made.quiet.some(
        (item) => item.text === COMPLETENESS_WORDS.RELIABILITY_UNRESOLVED,
      ),
      false,
    );
    // Rewritten 2026-11-15 (product owner): the line no longer names tickmarks; it was
    // "Your tickmarks settle B and D. …" and is now what is left alone. A tickmark is the
    // auditor's note; what it settles is still kept off the open list.
    assert.equal(made.status, `${STATUS_OPEN} reliability of ${LOG_NAME}.`);
    // The check's own outcome is kept, as its words.
    assert.equal(made.outcome?.label, "Unable to conclude yet");
    assert.equal(CHECK_PROPOSED, "The check proposed:");
  });

  it("after the decision: the item leaves, the quiet line says it in its own words, nothing waits", () => {
    for (const [kind, words] of [
      ["ESTABLISHED_ON_REVIEW", "E3 reliability established on your review"],
      ["NOT_RELIED_ON", "E3 not relied on"],
    ] as const) {
      const before = digest();
      const made = digest({
        file_reliability: [
          reliable({
            decision: decision({
              kind,
              relied_on:
                kind === "NOT_RELIED_ON" ? "" : "The parameters screen.",
            }),
          }),
        ],
      });
      assert.equal(
        made.attention.some((item) => item.key.startsWith(RELIABILITY_KEY)),
        false,
        kind,
      );
      const quiet = made.quiet.find((item) => item.kind === "RELIABILITY");
      assert.deepEqual(
        [quiet?.text, quiet?.tone, quiet?.fileId, quiet?.attributeKey],
        [words, "neutral", LOG, null],
        kind,
      );
      assert.equal(reliabilityQuiet("E3", LOG_NAME, kind), words);
      assert.equal(
        made.status,
        // Was "Your tickmarks settle B and D, and your decision …" (rewritten 2026-11-15).
        `Your decision settles the reliability of E3. ${STATUS_NOTHING}`,
        kind,
      );
      // Never counted as more shown: the verdict's count of shown is the check's.
      assert.equal(
        made.verdict.startsWith("2 of 4 attributes are shown."),
        true,
        made.verdict,
      );
      assert.equal(
        made.verdict.replace(/ 1 needs your attention\.$/, ""),
        before.verdict.replace(/ 1 needs your attention\.$/, ""),
      );
      assert.deepEqual(
        made.attributes.map((row) => row.status.label),
        before.attributes.map((row) => row.status.label),
      );
      // The check's outcome and caveat are what the check found: unchanged.
      assert.deepEqual(made.outcome, before.outcome);
      assert.deepEqual(made.caveat, before.caveat);
    }
  });

  it("names a file without a reference by its name, and a file no longer on the request with nothing to press", () => {
    const made = digest({
      file_reliability: [reliable({ file_id: GONE, question: "" })],
    });
    const [item] = made.attention.filter((each) =>
      each.key.startsWith(RELIABILITY_KEY),
    );
    assert.deepEqual(
      [item?.mark, item?.headline, item?.context, item?.control],
      [
        "",
        `Reliability of ${FILE_NOT_ON_REQUEST} not established`,
        // No sentence from the check: worded from the file's name alone.
        "",
        { type: "NONE" },
      ],
    );
    assert.match(
      made.status,
      new RegExp(`reliability of ${FILE_NOT_ON_REQUEST}`),
    );
    const decided = digest({
      file_reliability: [
        reliable({
          file_id: GONE,
          decision: decision({ kind: "NOT_RELIED_ON", relied_on: "" }),
        }),
      ],
    });
    assert.equal(
      decided.quiet.find((each) => each.kind === "RELIABILITY")?.text,
      `${FILE_NOT_ON_REQUEST} not relied on`,
    );
  });

  it("keeps the check's own caveat where the server names no file", () => {
    const made = digest({ file_reliability: [] });
    assert.equal(
      made.quiet.some(
        (item) =>
          item.kind === "CAVEAT" &&
          item.text === COMPLETENESS_WORDS.RELIABILITY_UNRESOLVED,
      ),
      true,
    );
    // Was "Your tickmarks settle B and D. …" (rewritten 2026-11-15: tickmarks not named).
    assert.equal(made.status, `${STATUS_OPEN} reliability to resolve.`);
    assert.notEqual(made.status.includes(STATUS_NOTHING), true);
    // Another completeness caveat is never replaced by the files.
    const other = digest({
      review: review({ completeness: { state: "INCOMPLETE", reasons: [] } }),
    });
    assert.equal(
      other.quiet.some((item) => item.text === COMPLETENESS_WORDS.INCOMPLETE),
      true,
    );
  });

  it("drops the calm line only where the status line says it", () => {
    const decided = digest({
      file_reliability: [reliable({ decision: decision() })],
    });
    assert.equal(decided.calm, DIGEST_TICKMARKED);
    assert.equal(calmUnderStatus(decided), "");
    const sufficient = digest({
      attributes: [shown(A, "A"), shown(B, "B"), shown(C, "C"), shown(D, "D")],
      review: review({
        overall: "SUFFICIENT",
        completeness: { state: "COMPLETE", reasons: [] },
      }),
      file_reliability: [],
    });
    assert.equal(sufficient.calm, DIGEST_NOTHING);
    assert.equal(calmUnderStatus(sufficient), "");
    assert.equal(sufficient.status, STATUS_NOTHING);
    // The review's own explanation is kept under the status line.
    const explained = digest({
      attributes: [shown(A, "A"), shown(B, "B"), shown(C, "C"), shown(D, "D")],
      review: review({
        overall: "ADDITIONAL_EVIDENCE",
        explanation: "The HR export was run two days after the termination.",
        completeness: { state: "COMPLETE", reasons: [] },
      }),
      file_reliability: [],
    });
    assert.equal(
      calmUnderStatus(explained),
      "The HR export was run two days after the termination.",
    );
  });
});

describe("the status line (section 10.14, A)", () => {
  const none: StatusFacts = {
    settled: [],
    decided: [],
    exceptions: [],
    findings: [],
    attributes: [],
    files: [],
    others: [],
    caveats: [],
  };
  const facts = (over: Partial<StatusFacts>): StatusFacts => ({
    ...none,
    ...over,
  });

  it("says each part in a few words, in the contract's order", () => {
    assert.equal(
      statusLine(
        facts({
          caveats: ["Read in part", "1 file left out"],
          others: ["type of E6 to confirm"],
          files: ["a.csv", "b.pdf"],
          attributes: ["C"],
          findings: ["A"],
          exceptions: ["B"],
        }),
      ),
      "Still open: exception recorded on B, finding to decide on A, attribute C, reliability of a.csv and b.pdf, type of E6 to confirm, read in part, 1 file left out.",
    );
    assert.equal(
      statusLine(facts({ attributes: ["A", "C", "D"], findings: ["B", "E"] })),
      "Still open: findings to decide on B and E, attributes A, C and D.",
    );
    assert.equal(
      statusLine(facts({ exceptions: ["B", "C"] })),
      "Still open: exceptions recorded on B and C.",
    );
  });

  it("names each attribute once, under the first reason that keeps it", () => {
    assert.equal(
      statusLine(
        facts({
          exceptions: ["B"],
          findings: ["B", "A"],
          attributes: ["A", "B", "C"],
        }),
      ),
      "Still open: exception recorded on B, finding to decide on A, attribute C.",
    );
  });

  it("says what a person's reliability decisions settled first, never a tickmark", () => {
    // Rewritten 2026-11-15 (product owner): the line no longer names tickmarks; it was
    // "Your tickmarks settle B and D. …" and is now what is left alone. A tickmark is the
    // auditor's note; what it settles is still kept off the open list.
    assert.equal(statusLine(facts({ settled: ["B", "D"] })), STATUS_NOTHING);
    assert.equal(
      statusLine(facts({ settled: ["B"], attributes: ["C"] })),
      "Still open: attribute C.",
    );
    assert.equal(
      statusLine(facts({ decided: ["E3"] })),
      `Your decision settles the reliability of E3. ${STATUS_NOTHING}`,
    );
    assert.equal(
      statusLine(facts({ decided: ["E3", "E5"], settled: ["A", "B", "D"] })),
      `Your decisions settle the reliability of E3 and E5. ${STATUS_NOTHING}`,
    );
    assert.equal(statusLine(none), STATUS_NOTHING);
  });

  it("joins as a person says it", () => {
    assert.deepEqual(
      [[], ["A"], ["A", "B"], ["A", "B", "C"], ["A", "", "C"]].map(andList),
      ["", "A", "A and B", "A, B and C", "A and C"],
    );
  });

  it("says 'Nothing waits on you.' only where nothing is left, and never 'sufficient'", () => {
    const parts: Array<[keyof StatusFacts, string[]]> = [
      ["exceptions", ["B"]],
      ["findings", ["A"]],
      ["attributes", ["C"]],
      ["files", ["a.csv"]],
      ["others", ["type of E6 to confirm"]],
      ["caveats", ["Read in part"]],
    ];
    for (let mask = 0; mask < 1 << parts.length; mask += 1) {
      for (const settled of [[], ["D"]]) {
        const chosen = parts.filter((_, at) => (mask & (1 << at)) !== 0);
        const said = statusLine(
          facts({ settled, ...Object.fromEntries(chosen) }),
        );
        assert.equal(said.includes(STATUS_NOTHING), chosen.length === 0, said);
        assert.equal(said.includes(STATUS_OPEN), chosen.length > 0, said);
        assert.equal(/sufficien/i.test(said), false, said);
        // Was: starts with "Your tickmark" where one settles (rewritten 2026-11-15).
        assert.equal(/tickmark/i.test(said), false, said);
        // The order of what is left is the contract's.
        const at = chosen.map(([key, [value]]) =>
          said.indexOf(
            key === "caveats" ? String(value).toLowerCase() : String(value),
          ),
        );
        assert.deepEqual(
          [...at].sort((x, y) => x - y),
          at,
          said,
        );
      }
    }
  });
});

describe("every combination on the first screen (section 10.14, Tests: web)", () => {
  // Each attribute's state, each file's reliability, and each other caveat, through the
  // real parser: the status line and the items agree, and "Nothing waits on you." is
  // never said while anything is left.
  const FINDING = uuid(70);
  const states: Record<string, (id: string, code: string) => unknown> = {
    shown: (id, code) => shown(id, code),
    gap: (id, code) => gap(id, code),
    closed: (id, code) =>
      gap(id, code, {
        disposition: disposition(
          id.length + code.charCodeAt(0),
          "NOT_APPLICABLE",
        ),
      }),
    exception: (id, code) =>
      gap(id, code, {
        disposition: disposition(code.charCodeAt(0), "EXCEPTION"),
      }),
    finding: (id, code) =>
      gap(id, code, {
        finding_id: FINDING,
        finding_status: "PROPOSED",
        disposition: disposition(code.charCodeAt(0) + 50, "NOT_AVAILABLE"),
      }),
  };
  const files = {
    none: [],
    open: [reliable()],
    established: [reliable({ decision: decision() })],
    notRelied: [
      reliable({
        decision: decision({ kind: "NOT_RELIED_ON", relied_on: "" }),
      }),
    ],
  };
  const caveats = {
    none: {},
    readInPart: { read_in_part: true },
    leftOut: { file_ids: [HR, EXPORT] },
  };
  it("holds the invariants over each", () => {
    let combinations = 0;
    for (const [b, makeB] of Object.entries(states)) {
      for (const [d, makeD] of Object.entries(states)) {
        for (const [f, list] of Object.entries(files)) {
          for (const [c, extra] of Object.entries(caveats)) {
            for (const complete of [true, false]) {
              combinations += 1;
              const label = `B ${b}, D ${d}, file ${f}, caveat ${c}, complete ${complete}`;
              const made = digest(
                {
                  attributes: [
                    shown(A, "A"),
                    makeB(B, "B"),
                    shown(C, "C"),
                    makeD(D, "D"),
                  ],
                  review: review(
                    complete
                      ? { completeness: { state: "COMPLETE", reasons: [] } }
                      : {},
                  ),
                  file_reliability: list,
                  ...extra,
                },
                [{ id: FINDING, status: "PROPOSED" }],
              );
              const caveatsLeft = made.quiet.filter(
                (item) => item.kind === "CAVEAT",
              );
              const nothing =
                made.attention.length === 0 && caveatsLeft.length === 0;
              assert.equal(
                made.status.includes(STATUS_NOTHING),
                nothing,
                label,
              );
              assert.equal(made.status.includes(STATUS_OPEN), !nothing, label);
              assert.equal(/sufficien/i.test(made.status), false, label);
              // A tickmark is never named in the line (rewritten 2026-11-15: it was
              // said first, "Your tickmark settles …", where one settled).
              assert.equal(/tickmark/i.test(made.status), false, label);
              // Each attribute item, each open file and each caveat is in the line.
              for (const item of made.attention) {
                if (item.kind === "ATTRIBUTE") {
                  assert.match(
                    made.status,
                    new RegExp(`\\b${item.mark}\\b`),
                    label,
                  );
                }
              }
              if (f === "open") {
                assert.match(made.status, /reliability of 06_Workday/, label);
                assert.equal(
                  made.attention.some((item) =>
                    item.key.startsWith(RELIABILITY_KEY),
                  ),
                  true,
                  label,
                );
              } else {
                assert.equal(
                  made.attention.some((item) =>
                    item.key.startsWith(RELIABILITY_KEY),
                  ),
                  false,
                  label,
                );
              }
              if (f === "established" || f === "notRelied") {
                assert.match(
                  made.status,
                  /your decision settles the reliability of E3|Your decision settles the reliability of E3/,
                  label,
                );
              }
              for (const item of caveatsLeft) {
                assert.ok(
                  made.status.toLowerCase().includes(item.text.toLowerCase()),
                  `${label}: ${item.text}`,
                );
              }
              // An exception is said as one, a finding as one.
              if (b === "exception" || d === "exception") {
                assert.match(made.status, /exceptions? recorded on/, label);
              }
              if (b === "finding" || d === "finding") {
                assert.match(made.status, /findings? to decide on/, label);
              }
              // The reliability caveat is said once: per file where the server names
              // one, as the check's label where it does not.
              const label2 = COMPLETENESS_WORDS.RELIABILITY_UNRESOLVED;
              assert.equal(
                made.quiet.some((item) => item.text === label2),
                !complete && f === "none",
                label,
              );
            }
          }
        }
      }
    }
    assert.equal(combinations, 5 * 5 * 4 * 3 * 2);
  });
});

describe("what is offered and sent (section 10.14, B)", () => {
  const reviewed = { standing: "REVIEWED" } as const;
  it("offers both decisions only to a person who may act, on a finished check, for a file in force", () => {
    assert.deepEqual(reliabilityOffer(reviewed, { inForce: true }, true), {
      kinds: ["ESTABLISHED_ON_REVIEW", "NOT_RELIED_ON"],
    });
    assert.equal(reliabilityOffer(reviewed, { inForce: true }, false), null);
    assert.equal(reliabilityOffer(reviewed, { inForce: false }, true), null);
    for (const standing of [
      "CHECKING",
      "HELD",
      "FAILED",
      "OUT_OF_DATE",
      "NOT_CHECKED",
    ] as const) {
      assert.equal(
        reliabilityOffer({ standing }, { inForce: true }, true),
        null,
        standing,
      );
    }
  });

  it("says each decision in the contract's words, never as shown and never green", () => {
    assert.equal(
      RELIABILITY_WORDS.ESTABLISHED_ON_REVIEW.label,
      "Reliability established on my review",
    );
    assert.equal(RELIABILITY_WORDS.NOT_RELIED_ON.label, "Not relied on");
    for (const words of Object.values(RELIABILITY_WORDS)) {
      assert.equal(words.tone, "neutral");
      assert.equal(/\bshown\b/i.test(words.shown), false);
      assert.ok(words.hint.length > 20);
    }
  });

  it("checks a draft as the form can know it", () => {
    const empty = reliabilityDraftFrom(null);
    assert.deepEqual(empty, { kind: null, reason: "", reliedOn: "" });
    assert.deepEqual(Object.keys(reliabilityProblems(empty)).sort(), [
      "kind",
      "reason",
    ]);
    const established = {
      kind: "ESTABLISHED_ON_REVIEW" as const,
      reason: "Watched it run with the owner.",
      reliedOn: "",
    };
    assert.deepEqual(Object.keys(reliabilityProblems(established)), [
      "reliedOn",
    ]);
    assert.deepEqual(
      reliabilityProblems({ ...established, reliedOn: "too short" }).reliedOn,
      "Say what you relied on in at least 10 characters.",
    );
    assert.deepEqual(
      reliabilityProblems({ ...established, reliedOn: "x".repeat(601) })
        .reliedOn,
      "What you relied on can be at most 600 characters.",
    );
    assert.deepEqual(
      reliabilityProblems({
        ...established,
        reliedOn: "The parameters screen.",
      }),
      {},
    );
    // Not relied on asks for no reliance.
    assert.deepEqual(
      reliabilityProblems({
        kind: "NOT_RELIED_ON",
        reason: "Not needed here at all.",
        reliedOn: "",
      }),
      {},
    );
    assert.equal(
      reliabilityProblems({
        kind: "NOT_RELIED_ON",
        reason: "x".repeat(1001),
        reliedOn: "",
      }).reason,
      "The reason can be at most 1000 characters.",
    );
    // Spaces do not count.
    assert.ok(
      reliabilityProblems({
        kind: "NOT_RELIED_ON",
        reason: "  a    b   ",
        reliedOn: "",
      }).reason,
    );
  });

  it("sends only what each kind takes", () => {
    assert.deepEqual(
      reliabilityFields({
        kind: "ESTABLISHED_ON_REVIEW",
        reason: "  Watched it   run. ",
        reliedOn: " The parameters\nscreen. ",
      }),
      {
        kind: "ESTABLISHED_ON_REVIEW",
        reason: "Watched it run.",
        relied_on: "The parameters screen.",
      },
    );
    assert.deepEqual(
      reliabilityFields({
        kind: "NOT_RELIED_ON",
        reason: "Not needed here.",
        reliedOn: "Left over from a change.",
      }),
      { kind: "NOT_RELIED_ON", reason: "Not needed here." },
    );
    // Change starts from what stands.
    const [read] = reliabilityOf({
      file_reliability: [reliable({ decision: decision() })],
    });
    assert.deepEqual(reliabilityDraftFrom(read?.decision ?? null), {
      kind: "ESTABLISHED_ON_REVIEW",
      reason: "I watched the export run with the owner on 2 October.",
      reliedOn: "The parameters screen and the record count, 212 rows.",
    });
  });

  it("says how each ended", () => {
    assert.deepEqual(RELIABILITY_ENDING_WORDS, {
      REPLACED: "Replaced",
      REOPENED: "Reopened",
      FILE_GONE: "Ended: the file is no longer on the request",
      OTHER: "No longer stands",
    });
    assert.equal(
      reliabilityEndingLine({
        endedAs: "REOPENED",
        endedBy: "Dana Lee",
        endedAt: "2026-11-14T10:00:00Z",
        endedReason: "Recorded on the wrong file.",
      }),
      "Reopened (Dana Lee · Nov 14, 2026): Recorded on the wrong file.",
    );
    assert.equal(
      reliabilityEndingLine({
        endedAs: "FILE_GONE",
        endedBy: null,
        endedAt: "2026-11-14T10:00:00Z",
        endedReason: "",
      }),
      "Ended: the file is no longer on the request (Nov 14, 2026).",
    );
  });
});

describe("the write (assuranceWrite, section 10.14)", () => {
  const ids = {
    organization_id: ORG,
    project_id: PROJECT,
    control_id: CONTROL,
    requirement_id: REQUEST,
  };
  const path = `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/evidence-assurance/${REQUEST}/files/${LOG}/reliability`;
  const send = (fields: Record<string, unknown>) =>
    assuranceWrite({
      ...ids,
      intent: "file-reliability",
      file_id: LOG,
      ...fields,
    });

  it("takes the two new intents", () => {
    assert.ok(ASSURANCE_INTENTS.includes("file-reliability"));
    assert.ok(ASSURANCE_INTENTS.includes("reopen-file-reliability"));
  });

  it("records each kind with the body the contract shapes", () => {
    assert.deepEqual(
      send({
        kind: "ESTABLISHED_ON_REVIEW",
        reason: "  I watched the export run. ",
        relied_on: "The parameters screen.",
        replaces: null,
        annotation_id: uuid(5),
        attribute_id: A,
      }),
      {
        path,
        body: {
          kind: "ESTABLISHED_ON_REVIEW",
          reason: "I watched the export run.",
          relied_on: "The parameters screen.",
          replaces: null,
        },
      },
    );
    assert.deepEqual(
      send({
        kind: "NOT_RELIED_ON",
        reason: "Not needed here.",
        replaces: uuid(800),
      }),
      {
        path,
        body: {
          kind: "NOT_RELIED_ON",
          reason: "Not needed here.",
          replaces: uuid(800),
        },
      },
    );
  });

  it("sends nothing it does not take", () => {
    const fine = {
      kind: "NOT_RELIED_ON",
      reason: "Not needed here.",
      replaces: null,
    };
    for (const bad of [
      { ...fine, kind: "RELIABLE" },
      { ...fine, reason: "short" },
      { ...fine, reason: "x".repeat(1001) },
      { ...fine, reason: 12 },
      // replaces is always said, as the id seen or null.
      { kind: fine.kind, reason: fine.reason },
      { ...fine, replaces: "E3" },
      // Not relied on carries no reliance.
      { ...fine, relied_on: "The parameters screen." },
      // Established needs what was relied on, 10 to 600.
      { ...fine, kind: "ESTABLISHED_ON_REVIEW" },
      { ...fine, kind: "ESTABLISHED_ON_REVIEW", relied_on: "too short" },
      { ...fine, kind: "ESTABLISHED_ON_REVIEW", relied_on: "x".repeat(601) },
      { ...fine, kind: "ESTABLISHED_ON_REVIEW", relied_on: 5 },
    ]) {
      assert.deepEqual(send(bad), { error: "invalid" }, JSON.stringify(bad));
    }
    assert.deepEqual(
      assuranceWrite({
        ...ids,
        intent: "file-reliability",
        file_id: "E3",
        ...fine,
      }),
      { error: "invalid" },
    );
    assert.deepEqual(
      assuranceWrite({ ...ids, intent: "file-reliability", ...fine }),
      { error: "invalid" },
    );
    assert.deepEqual(
      assuranceWrite({
        ...ids,
        requirement_id: "x",
        intent: "file-reliability",
        file_id: LOG,
        ...fine,
      }),
      { error: "invalid" },
    );
  });

  it("reopens the decision the person saw, by its id, with a reason", () => {
    assert.deepEqual(
      assuranceWrite({
        ...ids,
        intent: "reopen-file-reliability",
        file_id: LOG,
        id: uuid(800),
        reason: " Recorded on the wrong file. ",
        version: 1,
      }),
      {
        path: `${path}/reopen`,
        body: { id: uuid(800), reason: "Recorded on the wrong file." },
      },
    );
    for (const bad of [
      { id: uuid(800), reason: "short" },
      { id: "800", reason: "Recorded on the wrong file." },
      { reason: "Recorded on the wrong file." },
      { id: uuid(800) },
    ]) {
      assert.deepEqual(
        assuranceWrite({
          ...ids,
          intent: "reopen-file-reliability",
          file_id: LOG,
          ...bad,
        }),
        { error: "invalid" },
        JSON.stringify(bad),
      );
    }
  });

  it("says a refusal in the server's own sentence, and confirms only a 200", () => {
    assert.equal(reliabilityProblem(200), null);
    assert.equal(
      reliabilityProblem(
        409,
        "A decision was recorded on this file since the page loaded, so refresh and try again",
      ),
      "A decision was recorded on this file since the page loaded, so refresh and try again.",
    );
    for (const status of [0, 403, 404, 409, 422, 500]) {
      const said = reliabilityProblem(status);
      assert.equal(said?.endsWith(".") ?? false, true, String(status));
      assert.equal(/the client/i.test(said ?? ""), false);
    }
  });
});

describe("the workpaper (section 10.14), as the server words it", () => {
  // The server writes the sentences (design_workpaper.py: not_relied_sentence,
  // established_sentence); the page shows them as sent, beside the legend's mark.
  const ESTABLISHED =
    "Reliability established on review by Dana Lee on 14 November 2026. Relied on: The parameters screen and the record count, 212 rows.";
  const NOT_RELIED =
    "Not relied on, recorded by Dana Lee on 14 November 2026. Reason: The conclusion rests on the HR record.";
  const paper = (
    evidence: Record<string, unknown>,
    report: Record<string, unknown>,
    procedures: string[] = [],
  ) =>
    parseDesignWorkpaper({
      control: { id: CONTROL, ref: "ITGC-AC-07", title: "Leaver access" },
      evidence: [
        {
          ref: "E3",
          file_id: LOG,
          file_name: LOG_NAME,
          kind: "report",
          kind_words: "Report",
          requirement_id: REQUEST,
          requirement_title: "One leaver",
          annotations: 0,
          reviewed: 0,
          left_out: null,
          image: false,
          ...evidence,
        },
      ],
      attributes: [
        {
          id: A,
          code: "A",
          text: "Access removed",
          state: "SHOWN",
          tickmark: "NONE",
          refs: [],
          marks: {},
        },
      ],
      reports: [
        {
          ref: "E3",
          report: "Security activity export",
          source: "Workday",
          procedure: "",
          ...report,
        },
      ],
      procedures,
      tickmarks: [
        {
          mark: "INSPECTED",
          symbol: "◊",
          meaning: "Report parameters inspected.",
        },
      ],
    });

  it("words a report whose reliability a person established: ◊ Report parameters inspected, with the server's sentence", () => {
    const made = paper({}, { mark: "INSPECTED", established: ESTABLISHED }, [
      "Established the reliability of 1 report on review, as recorded.",
    ]);
    assert.ok(made !== null);
    const [report] = made.reports;
    assert.ok(report !== undefined);
    assert.deepEqual(reportInspected(made, report), {
      symbol: "◊",
      words: REPORT_INSPECTED,
      said: ESTABLISHED,
    });
    assert.equal(REPORT_INSPECTED, "Report parameters inspected");
    // The procedure line is the server's, as sent.
    assert.deepEqual(made.procedures, [
      "Established the reliability of 1 report on review, as recorded.",
    ]);
    // The mark without its sentence, or a sentence without the mark, says nothing.
    for (const half of [
      { mark: "INSPECTED", established: "" },
      { mark: null, established: ESTABLISHED },
      { mark: "AGREED", established: ESTABLISHED },
    ]) {
      const odd = paper({}, half);
      assert.equal(
        reportInspected(odd ?? { tickmarks: [] }, odd?.reports[0] ?? {}),
        null,
        JSON.stringify(half),
      );
    }
  });

  it("says a file not relied on in the evidence index, in the server's words", () => {
    const made = paper({ not_relied_on: NOT_RELIED }, {});
    assert.ok(made !== null);
    const [entryOf] = made.evidence;
    assert.ok(entryOf !== undefined);
    assert.equal(notReliedOnLine(entryOf), NOT_RELIED);
    assert.equal(NOT_RELIED_ON, "Not relied on");
    assert.equal(reportInspected(made, made.reports[0] ?? {}), null);
  });

  it("reads nothing where the server sends nothing, and never counts it as more shown", () => {
    const plain = paper({}, {});
    const decided = paper(
      { not_relied_on: NOT_RELIED },
      { mark: "INSPECTED", established: ESTABLISHED },
    );
    assert.ok(plain !== null && decided !== null);
    assert.equal("notReliedOn" in (plain.evidence[0] ?? {}), false);
    assert.equal("inspected" in (plain.reports[0] ?? {}), false);
    assert.equal(notReliedOnLine(plain.evidence[0] ?? {}), "");
    assert.equal(
      notReliedOnLine(paper({ not_relied_on: null }, {})?.evidence[0] ?? {}),
      "",
    );
    assert.deepEqual(tilesOf(decided), tilesOf(plain));
    assert.deepEqual(decided.attributes, plain.attributes);
  });
});
