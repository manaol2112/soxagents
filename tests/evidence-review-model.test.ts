import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { lettersSpan } from "../apps/web/src/design-evidence-model.ts";
import {
  type AssuredRequest,
  assuranceRow,
  CHECKED_IN_CODE,
  CODE_CHECK_WORDS,
  COMPLETENESS_WORDS,
  CONSIDERATIONS_TITLE,
  CONTEXT_THIN,
  FILES_TITLE,
  FOLLOW_UP_TITLE,
  notChecked,
  OUTCOME_WORDS,
  OUTCOMES,
  parseAssurance,
  RESOLVED_TITLE,
  REVIEW_BOUNDS,
  REVIEW_FOR,
  REVIEW_GROUP_WORDS,
  REVIEW_TITLE,
  REVIEW_UNREAD,
  type ReviewView,
  type RowFile,
  reviewView,
  TYPE_TO_CONFIRM,
} from "../apps/web/src/evidence-assurance-model.ts";

// The review of a request's evidence (docs/evidence-assurance.md, section 10; product
// owner, 14 November 2026: the check's result should read like a concise review prepared
// by a capable senior IT auditor, and "the person never has to understand the agents'
// architecture"). The server decides the outcome; the page reads it, cautiously where it
// does not know a value, and words it. Three things it must never do: show "sufficient"
// where what came with it says otherwise, word a potential exception as a conclusion,
// and change what a check of the first engine shows.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C, D, E] = [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)] as const;
const REQUEST = uuid(11);
const [FILE, SECOND, THIRD] = [uuid(31), uuid(32), uuid(33)] as const;
const FINDING = uuid(41);

// The list's letters are its own: the attribute the server codes "C" is the list's "C"
// here, and "Z" where a test gives it another letter.
const lettered = [A, B, C, D, E].map((id, at) => ({
  id,
  letter: "ABCDE".charAt(at),
  text: `Attribute ${at + 1} wording.`,
}));
const ALL = lettered.map((item) => item.letter);
const span = (letters: readonly string[]) => lettersSpan(letters, ALL);

const TICKET: RowFile = { id: FILE, name: "Ticket_4711.pdf" };
const SHEET: RowFile = { id: SECOND, name: "Access_listing.xlsx" };
const MEMO: RowFile = { id: THIRD, name: "Owner_memo.docx" };

const passage = (fileId: string = FILE) => ({
  quote: "approved by the line manager",
  file_id: fileId,
  location: {
    label: "Page 3",
    page: 3,
    sheet: null,
    row: null,
    column: null,
    cell: null,
  },
});

/** One attribute as the API sends it for an engine 2 run: by default satisfied. */
function attribute(over: Record<string, unknown> = {}) {
  return {
    attribute_id: A,
    code: "A",
    expected: true,
    verdict: "SUPPORTED",
    result: "MET",
    shows: "IMPLEMENTATION",
    summary: "The ticket shows line-manager approval before access.",
    passages: [passage()],
    absent: [],
    views: [],
    finding_id: null,
    finding_status: null,
    assessment: "SATISFIED",
    checks: [],
    ...over,
  };
}

const NOT_SHOWN = attribute({
  attribute_id: C,
  code: "C",
  verdict: "ISSUE",
  result: "NOT_MET",
  shows: null,
  summary: "Nothing shows the access was provisioned as approved.",
  passages: [],
  absent: ["The provisioning record."],
  finding_id: FINDING,
  finding_status: "PROPOSED",
  assessment: "NOT_DEMONSTRATED",
});

const DEVIATION = attribute({
  attribute_id: D,
  code: "D",
  verdict: "ISSUE",
  result: "NOT_MET",
  shows: null,
  summary:
    "A check of the records shows it: approved 11 January 2027, performed 10 January 2027.",
  passages: [],
  finding_id: uuid(42),
  finding_status: "PROPOSED",
  assessment: "CONTRADICTED",
  checks: [
    {
      element: "condition",
      test: "NOT_AFTER",
      status: "FAILED",
      sentence:
        "Approved 11 January 2027, performed 10 January 2027: the approval is after.",
    },
  ],
});

const followUp = (over: Record<string, unknown> = {}) => ({
  key: `${C}:pass`,
  attribute_ids: [C],
  codes: ["C"],
  elements: ["pass"],
  missing: "The provisioning record for the request.",
  why: "Without it nothing shows the access granted is the access approved.",
  request:
    "Provide the provisioning record for request 4711, showing the role granted and the date.",
  alternatives: "A system log of the role assignment for the same user.",
  kind: "EVIDENCE",
  priority: "HIGH",
  raised_by: ["ASSESSOR", "REVIEWER"],
  status: "OPEN",
  ...over,
});

/** The review as section 10.7 sends it. */
function review(over: Record<string, unknown> = {}) {
  return {
    overall: "ADDITIONAL_EVIDENCE",
    explanation:
      "1 of 2 requested attributes is supported. C is not demonstrated: the provisioning record is not among the files. 1 follow-up would resolve it.",
    completeness: { state: "COMPLETE", reasons: [] },
    context_thin: false,
    files: [
      {
        file_id: FILE,
        relevance: "RELEVANT",
        source: "SYSTEM_RECORD",
        legibility: "CLEAR",
        report_basis: "NOT_A_REPORT",
        notes: ["The ticket is the request the control acts on."],
      },
    ],
    confirmations: [],
    concerns: [],
    follow_ups: [followUp()],
    follow_ups_more: 0,
    follow_ups_dropped: 1,
    resolved: [],
    considerations: [],
    ...over,
  };
}

/** One request's entry as the API sends it for an engine 2 run. */
function entry(over: Record<string, unknown> = {}) {
  return {
    requirement_id: REQUEST,
    run_id: uuid(62),
    status: "REVIEWED",
    stage: "DONE",
    held: null,
    held_files: [],
    file_ids: [FILE],
    lens: "INSTANCE_RECORD",
    read_in_part: false,
    attributes: [attribute(), NOT_SHOWN],
    out_of_date: [],
    finished_at: "2026-11-14T10:00:00Z",
    note: "",
    engine_version: 2,
    review: review(),
    ...over,
  };
}

function read(over: Record<string, unknown> = {}): AssuredRequest {
  const parsed = parseAssurance({ requests: [entry(over)] });
  const [request] = parsed?.requests ?? [];
  assert.ok(request !== undefined);
  return request;
}

function view(
  over: Record<string, unknown> = {},
  files: RowFile[] = [TICKET],
): ReviewView {
  const shown = reviewView(read(over), lettered, files, span);
  assert.ok(shown !== null);
  return shown;
}

const row = (over: Record<string, unknown> = {}, files: RowFile[] = [TICKET]) =>
  assuranceRow({
    requirementId: REQUEST,
    files,
    assurance: parseAssurance({ requests: [entry(over)] }),
    attributes: lettered,
    span,
  });

describe("parsing the review (section 10.7)", () => {
  it("reads every field of a review as it is sent", () => {
    const request = read({
      review: review({
        overall: "POTENTIAL_EXCEPTION",
        completeness: {
          state: "INCOMPLETE",
          reasons: ["Owner_memo.docx was left out of the check."],
        },
        context_thin: true,
        confirmations: [
          { file_id: FILE, code: "KIND_UNSURE", reason: "Read as a ticket." },
        ],
        concerns: [
          {
            code: "WRONG_SYSTEM",
            sentence: "The listing names SAP ECC, not the control's system.",
            file_ids: [FILE],
          },
        ],
        follow_ups_more: 2,
        follow_ups_dropped: 3,
        resolved: [
          { key: `${B}:pass`, request: "Provide the approval.", codes: ["B"] },
        ],
        considerations: [
          {
            text: "The screenshot shows the current state, not the state at the date of the event.",
            passages: [passage()],
            raised_by: ["REVIEWER"],
          },
        ],
      }),
    });
    assert.equal(request.engineVersion, 2);
    assert.deepEqual(request.review, {
      overall: "POTENTIAL_EXCEPTION",
      explanation:
        "1 of 2 requested attributes is supported. C is not demonstrated: the provisioning record is not among the files. 1 follow-up would resolve it.",
      completeness: {
        state: "INCOMPLETE",
        reasons: ["Owner_memo.docx was left out of the check."],
      },
      contextThin: true,
      files: [
        {
          fileId: FILE,
          relevance: "RELEVANT",
          source: "SYSTEM_RECORD",
          legibility: "CLEAR",
          reportBasis: "NOT_A_REPORT",
          notes: ["The ticket is the request the control acts on."],
        },
      ],
      confirmations: [
        { fileId: FILE, code: "KIND_UNSURE", reason: "Read as a ticket." },
      ],
      concerns: [
        {
          code: "WRONG_SYSTEM",
          sentence: "The listing names SAP ECC, not the control's system.",
          fileIds: [FILE],
        },
      ],
      followUps: [
        {
          key: `${C}:pass`,
          attributeIds: [C],
          codes: ["C"],
          elements: ["pass"],
          missing: "The provisioning record for the request.",
          why: "Without it nothing shows the access granted is the access approved.",
          request:
            "Provide the provisioning record for request 4711, showing the role granted and the date.",
          alternatives:
            "A system log of the role assignment for the same user.",
          kind: "EVIDENCE",
          priority: "HIGH",
          raisedBy: ["ASSESSOR", "REVIEWER"],
          status: "OPEN",
        },
      ],
      followUpsMore: 2,
      followUpsDropped: 3,
      resolved: [
        { key: `${B}:pass`, request: "Provide the approval.", codes: ["B"] },
      ],
      considerations: [
        {
          text: "The screenshot shows the current state, not the state at the date of the event.",
          passages: [
            {
              quote: "approved by the line manager",
              fileId: FILE,
              location: "Page 3",
              page: 3,
            },
          ],
          raisedBy: ["REVIEWER"],
        },
      ],
    });
  });

  it("reads each attribute's assessment and its checks", () => {
    const request = read({ attributes: [attribute(), NOT_SHOWN, DEVIATION] });
    assert.deepEqual(
      request.attributes.map((item) => [item.code, item.assessment]),
      [
        ["A", "SATISFIED"],
        ["C", "NOT_DEMONSTRATED"],
        ["D", "CONTRADICTED"],
      ],
    );
    assert.deepEqual(request.attributes[2]?.checks, [
      {
        element: "condition",
        test: "NOT_AFTER",
        status: "FAILED",
        sentence:
          "Approved 11 January 2027, performed 10 January 2027: the approval is after.",
      },
    ]);
    for (const status of ["PASSED", "FAILED", "FAILED_ONE", "NOT_RUN"]) {
      const [only] = read({
        attributes: [
          attribute({
            checks: [{ element: "e", test: "SAME", status, sentence: "S." }],
          }),
        ],
      }).attributes;
      assert.equal(only?.checks[0]?.status, status);
    }
  });

  it("an engine 1 check has no review, no assessment and no checks, whatever came with it", () => {
    for (const version of [undefined, 1, "2", 3, null]) {
      const request = read({
        engine_version: version,
        attributes: [DEVIATION],
      });
      assert.equal(request.engineVersion, 1, String(version));
      assert.equal(request.review, null);
      assert.equal(request.attributes[0]?.assessment, null);
      assert.deepEqual(request.attributes[0]?.checks, []);
    }
    const legacy = entry();
    const { engine_version: _version, review: _review, ...before } = legacy;
    const [request] = parseAssurance({ requests: [before] })?.requests ?? [];
    assert.equal(request?.engineVersion, 1);
    assert.equal(request?.review, null);
    assert.deepEqual(
      [notChecked(REQUEST).engineVersion, notChecked(REQUEST).review],
      [1, null],
    );
  });

  it("a malformed review is no review: the check then reads as it did", () => {
    for (const bad of [
      null,
      undefined,
      "SUFFICIENT",
      7,
      true,
      [],
      [review()],
    ]) {
      assert.equal(read({ review: bad }).review, null, JSON.stringify(bad));
    }
    assert.equal(
      reviewView(read({ review: [] }), lettered, [TICKET], span),
      null,
    );
    assert.equal(row({ review: "x" })?.check.review, null);
  });

  it("shows nothing of a review before the check finishes, or once it is out of date", () => {
    for (const over of [
      { status: "CHECKING", stage: "VERIFY" },
      { status: "QUEUED" },
      { status: "HELD", held: { code: "CUSTODY", reason: "" } },
      { status: "FAILED" },
      { status: "OUT_OF_DATE", out_of_date: ["A file was added."] },
      { out_of_date: ["The control's understanding changed."] },
      { status: "SOMETHING_NEW" },
    ]) {
      const request = read(over);
      assert.equal(request.review, null, JSON.stringify(over));
      assert.deepEqual(request.attributes, []);
      assert.equal(row(over)?.check.review, null);
    }
  });

  it("falls back to the cautious reading for a value it does not know", () => {
    const request = read({
      review: {
        overall: "APPROVED",
        explanation: 12,
        completeness: { state: "FINE", reasons: "all good" },
        context_thin: "yes",
        files: [
          { file_id: FILE },
          { file_id: SECOND, relevance: "VERY", source: "X", legibility: "?" },
          { file_id: "not-an-id", relevance: "RELEVANT" },
          "a file",
        ],
        confirmations: [{ file_id: FILE, code: "NEW_CODE" }, { code: "X" }],
        concerns: [{ code: "WRONG_SYSTEM" }, "x", { sentence: "Said." }],
        follow_ups: [
          { request: "Ask for it.", kind: "MEMO", priority: "URGENT" },
          { request: "", missing: "" },
          "ask",
          {
            missing: "The log.",
            status: "SENT",
            raised_by: ["OWNER", "REVIEWER"],
          },
        ],
        follow_ups_more: -1,
        follow_ups_dropped: "2",
        resolved: [{ key: "k" }, { request: "Done." }, null],
        considerations: [{ text: "" }, { text: "Seen.", passages: "none" }, 4],
      },
    }).review;
    assert.ok(request !== null);
    // An outcome this page does not know is never "sufficient".
    assert.equal(request.overall, "UNABLE_TO_CONCLUDE");
    assert.equal(request.explanation, "");
    // A completeness it does not know is never "complete".
    assert.deepEqual(request.completeness, {
      state: "INCOMPLETE",
      reasons: [],
    });
    assert.equal(request.contextThin, false);
    assert.deepEqual(request.files, [
      {
        fileId: FILE,
        relevance: "CANNOT_TELL",
        source: "UNKNOWN",
        legibility: "CLEAR",
        reportBasis: "NOT_A_REPORT",
        notes: [],
      },
      {
        fileId: SECOND,
        relevance: "CANNOT_TELL",
        source: "UNKNOWN",
        legibility: "CLEAR",
        reportBasis: "NOT_A_REPORT",
        notes: [],
      },
    ]);
    assert.deepEqual(request.confirmations, [
      { fileId: FILE, code: "OTHER", reason: "" },
    ]);
    assert.deepEqual(request.concerns, [
      { code: "", sentence: "Said.", fileIds: [] },
    ]);
    assert.deepEqual(
      request.followUps.map((item) => [
        item.request,
        item.missing,
        item.kind,
        item.priority,
        item.status,
        item.raisedBy,
      ]),
      [
        ["Ask for it.", "", "EVIDENCE", "MEDIUM", "OPEN", []],
        ["", "The log.", "EVIDENCE", "MEDIUM", "OPEN", ["REVIEWER"]],
      ],
    );
    assert.equal(request.followUpsMore, 0);
    assert.equal(request.followUpsDropped, 0);
    assert.deepEqual(request.resolved, [
      { key: "", request: "Done.", codes: [] },
    ]);
    assert.deepEqual(request.considerations, [
      { text: "Seen.", passages: [], raisedBy: [] },
    ]);
    // An empty object is still a review: every part at its cautious default.
    assert.deepEqual(read({ review: {} }).review, {
      overall: "UNABLE_TO_CONCLUDE",
      explanation: "",
      completeness: { state: "INCOMPLETE", reasons: [] },
      contextThin: false,
      files: [],
      confirmations: [],
      concerns: [],
      followUps: [],
      followUpsMore: 0,
      followUpsDropped: 0,
      resolved: [],
      considerations: [],
    });
  });

  it("never reads an assessment as satisfied unless the attribute's own support stands", () => {
    const assessmentOf = (over: Record<string, unknown>) =>
      read({ attributes: [attribute(over)] }).attributes[0]?.assessment;
    assert.equal(assessmentOf({}), "SATISFIED");
    // Not a value this page knows.
    assert.equal(assessmentOf({ assessment: "PROVEN" }), "INDETERMINATE");
    // Satisfied, on support that came without a passage: not support, so not satisfied.
    assert.equal(assessmentOf({ passages: [] }), "INDETERMINATE");
    // Satisfied beside a verdict that is not support.
    assert.equal(
      assessmentOf({ verdict: "UNSETTLED", result: null }),
      "INDETERMINATE",
    );
    assert.equal(
      assessmentOf({ verdict: "ISSUE", result: "NOT_MET" }),
      "INDETERMINATE",
    );
    // Missing on an attribute the request asks for: open, never passed over.
    assert.equal(assessmentOf({ assessment: null }), "INDETERMINATE");
    assert.equal(assessmentOf({ assessment: undefined }), "INDETERMINATE");
    // Null for an attribute the request does not ask for, as documented.
    assert.equal(assessmentOf({ assessment: null, expected: false }), null);
    // An exception shown beside a file not read stays a person's, and stays said.
    assert.equal(
      assessmentOf({
        verdict: "UNSETTLED",
        result: null,
        assessment: "CONTRADICTED",
      }),
      "CONTRADICTED",
    );
    assert.equal(
      assessmentOf({ assessment: "CONTRADICTED" }),
      "INDETERMINATE",
      "contradicted beside support is not read as either",
    );
    assert.equal(
      assessmentOf({
        verdict: "PARTLY_SUPPORTED",
        result: "SHOWN_IN_PART",
        assessment: "PARTIALLY_SUPPORTED",
      }),
      "PARTIALLY_SUPPORTED",
    );
    assert.equal(
      assessmentOf({
        verdict: "NOT_ADDRESSED",
        result: "NOT_ADDRESSED",
        passages: [],
        assessment: "NOT_DEMONSTRATED",
      }),
      "NOT_DEMONSTRATED",
    );
  });

  it("reads a check whose status it does not know as not run, never as passed", () => {
    const [only] = read({
      attributes: [
        attribute({
          checks: [
            { element: "e", test: "SAME", status: "OK", sentence: "S." },
            { element: "e" },
            "check",
            null,
          ],
        }),
      ],
    }).attributes;
    assert.deepEqual(only?.checks, [
      { element: "e", test: "SAME", status: "NOT_RUN", sentence: "S." },
    ]);
  });

  it("bounds every list: 12 follow-ups, 10 considerations, 60 files, 12 checks an attribute", () => {
    assert.deepEqual(REVIEW_BOUNDS, {
      followUps: 12,
      considerations: 10,
      files: 60,
      checks: 12,
    });
    const many = <T>(n: number, make: (at: number) => T) =>
      Array.from({ length: n }, (_, at) => make(at));
    const request = read({
      attributes: [
        attribute({
          checks: many(40, (at) => ({
            element: `e${at}`,
            test: "SAME",
            status: "PASSED",
            sentence: `Check ${at}.`,
          })),
        }),
      ],
      review: review({
        follow_ups: many(30, (at) =>
          followUp({ key: `k${at}`, request: `Ask ${at}.` }),
        ),
        follow_ups_more: 4,
        considerations: many(30, (at) => ({
          text: `Note ${at}.`,
          passages: many(20, () => passage()),
        })),
        files: many(200, (at) => ({ file_id: uuid(1000 + at) })),
        resolved: many(30, (at) => ({ key: `r${at}`, request: `Was ${at}.` })),
        concerns: many(30, (at) => ({ code: "X", sentence: `Concern ${at}.` })),
        completeness: {
          state: "INCOMPLETE",
          reasons: many(30, (at) => `Reason ${at}.`),
        },
      }),
    });
    assert.equal(request.attributes[0]?.checks.length, 12);
    assert.equal(request.review?.followUps.length, 12);
    // What the bound cut is still counted: 4 the server did not list, 18 this page cut.
    assert.equal(request.review?.followUpsMore, 22);
    assert.equal(request.review?.considerations.length, 10);
    assert.equal(request.review?.considerations[0]?.passages.length, 4);
    assert.equal(request.review?.files.length, 60);
    assert.equal(request.review?.resolved.length, 12);
    assert.equal(request.review?.concerns.length, 12);
    assert.equal(request.review?.completeness.reasons.length, 6);
    // Long text is cut, never trusted.
    const long = read({
      review: review({
        explanation: "x".repeat(5000),
        follow_ups: [followUp({ request: "y".repeat(5000) })],
      }),
    }).review;
    assert.equal(long?.explanation.length, 600);
    assert.equal(long?.followUps[0]?.request.length, 600);
  });

  it("keeps one follow-up per key, and one note per file", () => {
    const request = read({
      review: review({
        follow_ups: [
          followUp(),
          followUp({ request: "The same ask, sent twice." }),
          followUp({ key: "", request: "No key." }),
          followUp({ key: "", request: "No key either." }),
        ],
        files: [
          { file_id: FILE, relevance: "NOT_RELEVANT" },
          { file_id: FILE, relevance: "RELEVANT" },
        ],
      }),
    }).review;
    assert.deepEqual(
      request?.followUps.map((item) => item.request),
      [
        "Provide the provisioning record for request 4711, showing the role granted and the date.",
        "No key.",
        "No key either.",
      ],
    );
    assert.deepEqual(
      request?.files.map((file) => file.relevance),
      ["NOT_RELEVANT"],
    );
  });
});

describe("the review as the row shows it", () => {
  it("words each outcome with a mark and a tone, never colour alone", () => {
    assert.deepEqual(OUTCOME_WORDS, {
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
    });
    const cases: Record<string, Record<string, unknown>> = {
      SUFFICIENT: {
        attributes: [attribute()],
        review: review({ overall: "SUFFICIENT", follow_ups: [] }),
      },
      ADDITIONAL_EVIDENCE: {},
      CLARIFICATION: {
        review: review({
          overall: "CLARIFICATION",
          follow_ups: [followUp({ kind: "CLARIFICATION" })],
        }),
      },
      POTENTIAL_EXCEPTION: {
        attributes: [attribute(), DEVIATION],
        review: review({ overall: "POTENTIAL_EXCEPTION", follow_ups: [] }),
      },
      UNABLE_TO_CONCLUDE: {
        review: review({ overall: "UNABLE_TO_CONCLUDE", follow_ups: [] }),
      },
    };
    for (const outcome of OUTCOMES) {
      const shown = view(cases[outcome]);
      assert.equal(shown.state, outcome);
      assert.equal(shown.label, OUTCOME_WORDS[outcome].label);
      assert.equal(shown.icon, OUTCOME_WORDS[outcome].icon);
      assert.equal(shown.tone, OUTCOME_WORDS[outcome].tone);
      assert.notEqual(shown.explanation, "");
    }
  });

  it("leads with the server's explanation, and has a sentence of its own where none came", () => {
    assert.equal(
      view().explanation,
      "1 of 2 requested attributes is supported. C is not demonstrated: the provisioning record is not among the files. 1 follow-up would resolve it.",
    );
    for (const outcome of OUTCOMES) {
      const shown = view({
        attributes: [attribute()],
        review: review({ overall: outcome, explanation: "", follow_ups: [] }),
      });
      assert.match(shown.explanation, /^[A-Z].*\.$/, outcome);
    }
  });

  it("groups the letters the request asks for: satisfied, open, potential exception", () => {
    assert.deepEqual(REVIEW_GROUP_WORDS, {
      SATISFIED: { label: "Satisfied", icon: "check", tone: "success" },
      OPEN: { label: "Open", icon: "minusCircle", tone: "warning" },
      EXCEPTION: { label: "Potential exception", icon: "risk", tone: "danger" },
    });
    const shown = view({
      attributes: [
        DEVIATION,
        NOT_SHOWN,
        attribute({ attribute_id: B, code: "B" }),
        attribute(),
        // Not asked for by the request: in no group.
        attribute({
          attribute_id: E,
          code: "E",
          expected: false,
          verdict: "NOT_ADDRESSED",
          result: "NOT_ADDRESSED",
          passages: [],
          assessment: null,
        }),
      ],
    });
    assert.deepEqual(
      shown.groups.map((group) => [group.key, group.label, group.letters]),
      [
        ["SATISFIED", "Satisfied", ["A", "B"]],
        ["OPEN", "Open", ["C"]],
        ["EXCEPTION", "Potential exception", ["D"]],
      ],
    );
    assert.equal(
      shown.countsLine,
      "Satisfied A, B · Open C · Potential exception D",
    );
    // Every assessment that is neither satisfied nor contradicted is open.
    const open = view({
      attributes: [
        attribute({
          verdict: "PARTLY_SUPPORTED",
          result: "SHOWN_IN_PART",
          assessment: "PARTIALLY_SUPPORTED",
        }),
        NOT_SHOWN,
        attribute({
          attribute_id: B,
          code: "B",
          verdict: "UNSETTLED",
          result: null,
          assessment: "INDETERMINATE",
        }),
      ],
    });
    assert.equal(open.countsLine, "Open A, B, C");
    // A request that asks for none has no line.
    assert.equal(view({ attributes: [] }).countsLine, "");
    assert.deepEqual(view({ attributes: [] }).groups, []);
  });

  it("maps an attribute to the list's own letter by its id, and to its code where the list has none", () => {
    const relettered = [
      { id: C, letter: "Z", text: "" },
      { id: A, letter: "Y", text: "" },
    ];
    const shown = reviewView(
      read({
        attributes: [
          attribute(),
          NOT_SHOWN,
          attribute({ attribute_id: uuid(9), code: "Q" }),
        ],
        review: review({
          follow_ups: [
            followUp(),
            followUp({ key: "k2", attribute_ids: [], codes: ["C"] }),
          ],
          resolved: [{ key: "r", request: "Was asked.", codes: ["A", "Q"] }],
        }),
      }),
      relettered,
      [TICKET],
      (letters) => letters.join(" and "),
    );
    assert.equal(shown?.countsLine, "Satisfied Y, Q · Open Z");
    assert.deepEqual(
      shown?.followUps.map((item) => [item.letters, item.serves]),
      [
        [["Z"], "For attribute Z"],
        [["Z"], "For attribute Z"],
      ],
    );
    assert.deepEqual(shown?.resolved[0]?.letters, ["Y", "Q"]);
  });

  it("says how complete the evidence is, in words with its reasons, only where it is not", () => {
    assert.deepEqual(COMPLETENESS_WORDS, {
      INCOMPLETE: "Evidence incomplete",
      PARTLY_UNREADABLE: "Partly unreadable",
      RELIABILITY_UNRESOLVED: "Reliability to resolve",
    });
    assert.equal(view().completeness, null);
    for (const [state, label] of Object.entries(COMPLETENESS_WORDS)) {
      const said = view({
        review: review({
          completeness: { state, reasons: ["Owner_memo.docx was left out"] },
        }),
      }).completeness;
      assert.deepEqual(said, {
        label,
        reasons: ["Owner_memo.docx was left out."],
      });
      // Where the server sent no sentence, the page has one of its own.
      const unsaid = view({
        review: review({ completeness: { state, reasons: [] } }),
      }).completeness;
      assert.equal(unsaid?.label, label);
      assert.equal(unsaid?.reasons.length, 1);
      assert.match(unsaid?.reasons[0] ?? "", /^[A-Z].*\.$/);
    }
    // Custody passing is never called reliability.
    assert.equal(
      /custody/i.test(JSON.stringify(Object.values(COMPLETENESS_WORDS))),
      false,
    );
  });

  it("lists each follow-up by its request, with its kind, priority and letters, and details on request", () => {
    const shown = view({
      attributes: [
        attribute(),
        NOT_SHOWN,
        attribute({
          attribute_id: B,
          code: "B",
          verdict: "UNSETTLED",
          result: null,
          assessment: "INDETERMINATE",
        }),
      ],
      review: review({
        follow_ups: [
          followUp(),
          followUp({
            key: `${B}:condition`,
            attribute_ids: [C, B],
            codes: ["C", "B"],
            request: "Confirm who approved request 4711.",
            missing: "",
            why: "",
            alternatives: "",
            kind: "CLARIFICATION",
            priority: "LOW",
            raised_by: ["REVIEWER"],
          }),
          followUp({
            key: "k3",
            priority: "MEDIUM",
            request: "",
            missing: "The change log.",
          }),
        ],
      }),
    });
    assert.deepEqual(shown.followUps, [
      {
        key: `${C}:pass`,
        request:
          "Provide the provisioning record for request 4711, showing the role granted and the date.",
        kind: "Evidence",
        priority: "High priority",
        letters: ["C"],
        serves: "For attribute C",
        missing: "The provisioning record for the request.",
        why: "Without it nothing shows the access granted is the access approved.",
        alternatives: "A system log of the role assignment for the same user.",
      },
      {
        key: `${B}:condition`,
        request: "Confirm who approved request 4711.",
        kind: "Clarification",
        priority: "Low priority",
        letters: ["B", "C"],
        serves: "For attributes B and C",
        missing: "",
        why: "",
        alternatives: "",
      },
      {
        // Where the server named only what is missing, that is the line, said once.
        key: "k3",
        request: "The change log.",
        kind: "Evidence",
        priority: "Medium priority",
        letters: ["C"],
        serves: "For attribute C",
        missing: "",
        why: "Without it nothing shows the access granted is the access approved.",
        alternatives: "A system log of the role assignment for the same user.",
      },
    ]);
    // Whether one reading or both raised it is not shown.
    assert.equal(
      /raised|reading|ASSESSOR|REVIEWER/i.test(JSON.stringify(shown.followUps)),
      false,
    );
  });

  it("says how many more follow-ups there are, and which the new evidence resolved", () => {
    assert.equal(view().more, "");
    assert.deepEqual(view().resolved, []);
    assert.equal(
      view({ review: review({ follow_ups_more: 1 }) }).more,
      "1 more follow-up is not listed here.",
    );
    assert.equal(
      view({ review: review({ follow_ups_more: 3 }) }).more,
      "3 more follow-ups are not listed here.",
    );
    assert.equal(RESOLVED_TITLE, "Resolved by the new evidence");
    const shown = view({
      review: review({
        follow_ups: [
          followUp(),
          // One the server marks resolved is listed with the resolved, not asked again.
          followUp({
            key: "old",
            status: "RESOLVED",
            request: "Provide the ticket.",
          }),
        ],
        resolved: [
          {
            key: `${A}:condition`,
            request: "Provide the approval.",
            codes: ["A"],
          },
        ],
      }),
    });
    assert.deepEqual(
      shown.followUps.map((item) => item.key),
      [`${C}:pass`],
    );
    assert.deepEqual(shown.resolved, [
      {
        key: `done-${A}:condition`,
        request: "Provide the approval.",
        letters: ["A"],
      },
      { key: "done-old", request: "Provide the ticket.", letters: ["C"] },
    ]);
  });

  it("sufficient evidence shows no follow-up section", () => {
    const shown = view({
      attributes: [attribute(), attribute({ attribute_id: B, code: "B" })],
      review: review({
        overall: "SUFFICIENT",
        explanation: "2 of 2 requested attributes are supported.",
        follow_ups: [],
        resolved: [
          { key: "r", request: "Provide the approval.", codes: ["B"] },
        ],
      }),
    });
    assert.equal(shown.label, "Sufficient evidence");
    assert.equal(shown.tone, "success");
    assert.equal(
      shown.explanation,
      "2 of 2 requested attributes are supported.",
    );
    assert.deepEqual(shown.followUps, []);
    assert.equal(shown.more, "");
    assert.equal(shown.countsLine, "Satisfied A, B");
    // What the new evidence resolved is still said.
    assert.equal(shown.resolved.length, 1);
  });

  it("never shows sufficient where what came with it says otherwise", () => {
    const contradicted: Array<[string, Record<string, unknown>]> = [
      [
        "an attribute that is not satisfied",
        { review: review({ overall: "SUFFICIENT", follow_ups: [] }) },
      ],
      [
        "an open follow-up",
        {
          attributes: [attribute()],
          review: review({ overall: "SUFFICIENT" }),
        },
      ],
      [
        "follow-ups not listed",
        {
          attributes: [attribute()],
          review: review({
            overall: "SUFFICIENT",
            follow_ups: [],
            follow_ups_more: 1,
          }),
        },
      ],
      [
        "support still to corroborate",
        {
          attributes: [attribute()],
          review: review({
            overall: "SUFFICIENT",
            follow_ups: [],
            completeness: { state: "RELIABILITY_UNRESOLVED", reasons: [] },
          }),
        },
      ],
      [
        "support this page could not take as it stands",
        {
          attributes: [attribute({ passages: [] })],
          review: review({ overall: "SUFFICIENT", follow_ups: [] }),
        },
      ],
      [
        "no attribute asked for",
        {
          attributes: [],
          review: review({ overall: "SUFFICIENT", follow_ups: [] }),
        },
      ],
    ];
    for (const [name, over] of contradicted) {
      const shown = view(over);
      assert.equal(shown.state, "UNABLE_TO_CONCLUDE", name);
      assert.equal(shown.label, "Unable to conclude yet", name);
      assert.equal(shown.tone, "neutral", name);
      assert.equal(shown.explanation, REVIEW_UNREAD, name);
    }
    // Its follow-ups are still shown: nothing is hidden by the contradiction.
    assert.equal(
      view({
        attributes: [attribute()],
        review: review({ overall: "SUFFICIENT" }),
      }).followUps.length,
      1,
    );
    // Sufficient beside incomplete evidence is the server's to say (section 10.6).
    assert.equal(
      view({
        attributes: [attribute()],
        review: review({
          overall: "SUFFICIENT",
          follow_ups: [],
          completeness: {
            state: "INCOMPLETE",
            reasons: ["One file left out."],
          },
        }),
      }).state,
      "SUFFICIENT",
    );
  });

  it("a potential exception is never worded as a conclusion or a deficiency", () => {
    const shown = view({
      attributes: [attribute(), DEVIATION],
      review: review({
        overall: "POTENTIAL_EXCEPTION",
        explanation: "",
        follow_ups: [],
      }),
    });
    assert.equal(shown.label, "Potential exception to investigate");
    assert.equal(shown.countsLine, "Satisfied A · Potential exception D");
    const words = JSON.stringify([
      shown.label,
      shown.explanation,
      shown.groups.map((group) => group.label),
      OUTCOME_WORDS.POTENTIAL_EXCEPTION,
      REVIEW_GROUP_WORDS.EXCEPTION,
      REVIEW_TITLE,
      REVIEW_FOR,
    ]);
    assert.equal(
      /deficien|ineffective|not effective|control fail|failed control|concluded|conclusion|violation|\bbreach|exception (?:found|confirmed|noted|identified)/i.test(
        words,
      ),
      false,
      words,
    );
    assert.match(shown.label, /^Potential /);
    assert.match(shown.explanation, /may show/);
    // The whole review is headed as a proposal.
    assert.equal(REVIEW_TITLE, "Proposed assessment");
    assert.equal(REVIEW_FOR, "for your review");
  });

  it("lists considerations with their passages, opening in the file as an attribute's do", () => {
    assert.equal(CONSIDERATIONS_TITLE, "Additional considerations");
    assert.deepEqual(view().considerations, []);
    const over = {
      file_ids: [FILE, SECOND],
      review: review({
        considerations: [
          {
            text: "The screenshot shows the current state, not the state at the date of the event",
            passages: [
              passage(),
              passage(SECOND),
              passage(uuid(99)),
              { quote: "no file named" },
            ],
            raised_by: ["REVIEWER"],
          },
          { text: "The report shows no parameters.", passages: [] },
        ],
      }),
    };
    const shown = view(over, [TICKET, SHEET]);
    assert.deepEqual(shown.considerations, [
      {
        key: "note-0",
        text: "The screenshot shows the current state, not the state at the date of the event.",
        passages: [
          {
            quote: "approved by the line manager",
            fileId: FILE,
            location: "Page 3",
            page: 3,
            fileLabel: "Ticket_4711.pdf",
            opens: true,
          },
          {
            quote: "approved by the line manager",
            fileId: SECOND,
            location: "Page 3",
            page: 3,
            fileLabel: "Access_listing.xlsx",
            opens: true,
          },
          {
            quote: "approved by the line manager",
            fileId: uuid(99),
            location: "Page 3",
            page: 3,
            fileLabel: "A file no longer on this request",
            opens: false,
          },
          {
            quote: "no file named",
            fileId: null,
            location: "",
            page: null,
            fileLabel: "The file is not named",
            opens: false,
          },
        ],
      },
      { key: "note-1", text: "The report shows no parameters.", passages: [] },
    ]);
    // An attribute's passage is shown the same way.
    const line = row(over, [TICKET, SHEET])?.check.attributes.find(
      (each) => each.letter === "A",
    );
    assert.deepEqual(line?.passages[0], shown.considerations[0]?.passages[0]);
  });

  it("says something of a file only where there is something to say", () => {
    assert.equal(FILES_TITLE, "About the files");
    // A relevant, clear record of a system: nothing to say, whatever note came with it.
    assert.deepEqual(view().files, []);
    const shown = view(
      {
        file_ids: [FILE, SECOND, THIRD],
        review: review({
          files: [
            {
              file_id: FILE,
              relevance: "RELEVANT",
              source: "SYSTEM_RECORD",
              legibility: "CLEAR",
              report_basis: "SHOWN",
              notes: ["The ticket is the request."],
            },
            {
              file_id: SECOND,
              relevance: "PARTLY_RELEVANT",
              source: "MANAGEMENT_PREPARED",
              legibility: "PARTLY_UNREADABLE",
              report_basis: "NOT_SHOWN",
              notes: ["Columns F to H are cut off"],
            },
            {
              file_id: THIRD,
              relevance: "NOT_RELEVANT",
              source: "DOCUMENT",
              legibility: "CLEAR",
              report_basis: "NOT_A_REPORT",
              notes: [],
            },
            {
              file_id: uuid(98),
              relevance: "CANNOT_TELL",
              source: "UNKNOWN",
              legibility: "UNREADABLE",
              report_basis: "PARTLY_SHOWN",
            },
          ],
          confirmations: [{ file_id: THIRD, code: "KIND_UNSURE", reason: "" }],
        }),
      },
      [TICKET, SHEET, MEMO],
    );
    assert.deepEqual(shown.files, [
      {
        fileId: SECOND,
        name: "Access_listing.xlsx",
        notes: [
          "Part of it could not be read.",
          "It was prepared by a person, not taken from a system's own record.",
          "It is a report that does not show its source, run date or parameters.",
          "Columns F to H are cut off.",
        ],
      },
      {
        fileId: THIRD,
        name: "Owner_memo.docx",
        notes: [
          "It does not appear relevant to this request.",
          TYPE_TO_CONFIRM,
        ],
      },
      {
        fileId: uuid(98),
        name: "A file no longer on this request",
        notes: [
          "Whether it is relevant to this request could not be told.",
          "It could not be read.",
          "Its source is not known.",
          "It is a report that shows only part of its source, run date and parameters.",
        ],
      },
    ]);
    // A file to confirm that the readings said nothing else of is still listed.
    assert.deepEqual(
      view({
        review: review({
          files: [],
          confirmations: [{ file_id: FILE, code: "KIND_UNSURE", reason: "" }],
        }),
      }).files,
      [{ fileId: FILE, name: "Ticket_4711.pdf", notes: [TYPE_TO_CONFIRM] }],
    );
  });

  it("says what the check found on the files' own facts, naming the files", () => {
    assert.deepEqual(view().concerns, []);
    const shown = view(
      {
        file_ids: [FILE, SECOND],
        review: review({
          concerns: [
            {
              code: "DIFFERENT_SUBJECT",
              sentence: "The files name different users for one instance",
              file_ids: [FILE, SECOND, uuid(97)],
            },
            {
              code: "OUTSIDE_PERIOD",
              sentence: "A date is outside the audit period.",
              file_ids: [],
            },
          ],
        }),
      },
      [TICKET, SHEET],
    );
    assert.deepEqual(shown.concerns, [
      {
        key: "concern-0",
        text: "The files name different users for one instance.",
        files: "Ticket_4711.pdf, Access_listing.xlsx",
      },
      {
        key: "concern-1",
        text: "A date is outside the audit period.",
        files: "",
      },
    ]);
  });

  it("says once, quietly, where the control's understanding is thin", () => {
    assert.equal(view().contextThin, null);
    assert.equal(
      view({ review: review({ context_thin: true }) }).contextThin,
      CONTEXT_THIN,
    );
    assert.match(CONTEXT_THIN, /^No fact of this control's understanding/);
  });
});

describe("the review on the request's row", () => {
  it("is on the check of a finished engine 2 run, and on no other", () => {
    assert.equal(row()?.check.review?.label, "Additional evidence needed");
    assert.equal(row({ engine_version: 1 })?.check.review, null);
    assert.equal(row({ engine_version: undefined })?.check.review, null);
    assert.equal(row({ review: null })?.check.review, null);
    assert.equal(row({ status: "CHECKING" })?.check.review, null);
    assert.deepEqual(row({ status: "CHECKING" })?.check.confirm, []);
  });

  it("an engine 1 row reads exactly as it did, whatever engine 2 fields come with it", () => {
    const {
      engine_version: _version,
      review: _review,
      ...before
    } = entry({
      attributes: [attribute(), NOT_SHOWN, DEVIATION].map(
        ({ assessment: _assessment, checks: _checks, ...rest }) => rest,
      ),
    });
    const plain = assuranceRow({
      requirementId: REQUEST,
      files: [TICKET],
      assurance: parseAssurance({ requests: [before] }),
      attributes: lettered,
      span,
    });
    const withFields = row({
      engine_version: 1,
      attributes: [attribute(), NOT_SHOWN, DEVIATION],
    });
    assert.deepEqual(withFields, plain);
    assert.equal(plain?.check.review, null);
    assert.deepEqual(plain?.check.confirm, []);
    assert.ok(
      plain?.check.attributes.every((line) => line.checks.length === 0),
    );
  });

  it("changes nothing of the row's own attribute list, states or line", () => {
    const one = row({
      engine_version: 1,
      attributes: [attribute(), NOT_SHOWN, DEVIATION],
    });
    const two = row({ attributes: [attribute(), NOT_SHOWN, DEVIATION] });
    assert.deepEqual(two?.states, one?.states);
    assert.equal(two?.fact, one?.fact);
    assert.equal(two?.check.line, one?.check.line);
    assert.deepEqual(two?.implementedIds, one?.implementedIds);
    assert.deepEqual(two?.elementFacts, one?.elementFacts);
    assert.deepEqual(
      two?.check.attributes.map(({ checks: _checks, ...line }) => line),
      one?.check.attributes.map(({ checks: _checks, ...line }) => line),
    );
  });

  it("the note beside Accept does not depend on the review", () => {
    const attributes = [attribute(), NOT_SHOWN, DEVIATION];
    const one = row({ engine_version: 1, attributes });
    assert.equal(
      one?.acceptNote,
      "Accepting marks attribute A as evidenced. Both readings found an issue on C and D. You can still accept; accepting does not settle these.",
    );
    for (const over of [
      {},
      { review: null },
      { review: review({ overall: "SUFFICIENT", follow_ups: [] }) },
      { review: review({ overall: "POTENTIAL_EXCEPTION" }) },
      {
        review: review({
          completeness: { state: "RELIABILITY_UNRESOLVED", reasons: [] },
          follow_ups_more: 4,
        }),
      },
    ]) {
      assert.equal(row({ attributes, ...over })?.acceptNote, one?.acceptNote);
    }
  });

  it("lists an opened attribute's checks, each sentence with pass or fail in words and a mark", () => {
    assert.equal(CHECKED_IN_CODE, "Checked in code:");
    assert.deepEqual(CODE_CHECK_WORDS, {
      PASSED: { label: "Passed", icon: "check", tone: "success" },
      FAILED: { label: "Failed", icon: "x", tone: "danger" },
      FAILED_ONE: {
        label: "Failed on one reading's values",
        icon: "help",
        tone: "warning",
      },
      NOT_RUN: { label: "Not run", icon: "minus", tone: "neutral" },
    });
    const line = row({
      attributes: [
        attribute({
          checks: [
            {
              element: "condition",
              test: "NOT_AFTER",
              status: "PASSED",
              sentence:
                "Approved 9 January 2027, performed 10 January 2027: the approval is before",
            },
            {
              element: "condition",
              test: "SAME",
              status: "FAILED_ONE",
              sentence: "The approver differs in one reading.",
            },
            {
              element: "pass",
              test: "IN_PERIOD",
              status: "NOT_RUN",
              sentence: "",
            },
          ],
        }),
        DEVIATION,
      ],
    })?.check.attributes;
    assert.deepEqual(line?.find((each) => each.letter === "A")?.checks, [
      {
        key: "condition:NOT_AFTER:0",
        sentence:
          "Approved 9 January 2027, performed 10 January 2027: the approval is before.",
        result: "Passed",
        icon: "check",
        tone: "success",
      },
      {
        key: "condition:SAME:1",
        sentence: "The approver differs in one reading.",
        result: "Failed on one reading's values",
        icon: "help",
        tone: "warning",
      },
      {
        key: "pass:IN_PERIOD:2",
        sentence: "A comparison of the values the records state.",
        result: "Not run",
        icon: "minus",
        tone: "neutral",
      },
    ]);
    assert.deepEqual(
      line
        ?.find((each) => each.letter === "D")
        ?.checks.map((item) => item.result),
      ["Failed"],
    );
  });

  it("a file read with its type not confirmed carries the row's own Confirm the file's type, once", () => {
    const confirmations = [
      { file_id: FILE, code: "KIND_UNSURE", reason: "" },
      {
        file_id: SECOND,
        code: "KIND_UNSURE",
        reason: "It reads as a user listing",
      },
      // Not a file of the row: nothing to confirm here.
      { file_id: uuid(96), code: "KIND_UNSURE", reason: "" },
    ];
    const check = row(
      { file_ids: [FILE, SECOND], review: review({ confirmations }) },
      [TICKET, SHEET],
    )?.check;
    assert.deepEqual(check?.confirm, [
      {
        fileId: FILE,
        line: "Ticket_4711.pdf: Its type is not confirmed, so it was read as the type it appears to be.",
        action: {
          kind: "CONFIRM_TYPE",
          label: "Confirm the file's type",
          fileId: FILE,
        },
      },
      {
        fileId: SECOND,
        line: "Access_listing.xlsx: It reads as a user listing.",
        action: {
          kind: "CONFIRM_TYPE",
          label: "Confirm the file's type",
          fileId: SECOND,
        },
      },
    ]);
    // A file left out for the same reason already carries the action: not a second one.
    const both = row(
      {
        file_ids: [FILE],
        held_files: [{ file_id: SECOND, code: "KIND_UNSURE", reason: "" }],
        review: review({ confirmations }),
      },
      [TICKET, SHEET],
    )?.check;
    const actions = [...(both?.leftOut ?? []), ...(both?.confirm ?? [])].filter(
      (item) => item.action?.kind === "CONFIRM_TYPE",
    );
    assert.deepEqual(
      actions.map((item) => item.fileId),
      [SECOND, FILE],
    );
    // The count of files left out, and the note beside Accept, are of files left out only.
    assert.equal(check?.leftOut.length, 0);
    // A code this page does not know confirms nothing, and says only what the server said.
    const other = row({
      review: review({
        confirmations: [{ file_id: FILE, code: "NEW", reason: "" }],
      }),
    })?.check;
    assert.deepEqual(other?.confirm, []);
  });
});

describe("plain words on the review", () => {
  const full = view(
    {
      file_ids: [FILE, SECOND],
      attributes: [attribute(), NOT_SHOWN, DEVIATION],
      review: review({
        overall: "POTENTIAL_EXCEPTION",
        completeness: { state: "RELIABILITY_UNRESOLVED", reasons: [] },
        context_thin: true,
        files: [
          {
            file_id: FILE,
            relevance: "CANNOT_TELL",
            source: "UNKNOWN",
            legibility: "UNREADABLE",
            report_basis: "NOT_SHOWN",
          },
          {
            file_id: SECOND,
            relevance: "NOT_RELEVANT",
            source: "MANAGEMENT_PREPARED",
            legibility: "PARTLY_UNREADABLE",
            report_basis: "PARTLY_SHOWN",
          },
        ],
        confirmations: [{ file_id: FILE, code: "KIND_UNSURE", reason: "" }],
        concerns: [
          {
            code: "WRONG_SYSTEM",
            sentence: "Another system is named.",
            file_ids: [FILE],
          },
        ],
        follow_ups: [
          followUp(),
          followUp({ key: "k2", kind: "CLARIFICATION", priority: "LOW" }),
        ],
        follow_ups_more: 2,
        resolved: [
          { key: "r", request: "Provide the approval.", codes: ["A"] },
        ],
        considerations: [
          { text: "Seen.", passages: [passage()], raised_by: ["ASSESSOR"] },
        ],
      }),
    },
    [TICKET, SHEET],
  );
  const shown = JSON.stringify([
    full,
    row({ attributes: [attribute(), DEVIATION] })?.check.attributes.map(
      (line) => line.checks,
    ),
    row({
      review: review({
        confirmations: [{ file_id: FILE, code: "KIND_UNSURE", reason: "" }],
      }),
    })?.check.confirm,
    Object.values(OUTCOME_WORDS).map((words) => words.label),
    Object.values(COMPLETENESS_WORDS),
    Object.values(REVIEW_GROUP_WORDS).map((words) => words.label),
    Object.values(CODE_CHECK_WORDS).map((words) => words.label),
    [
      REVIEW_TITLE,
      REVIEW_FOR,
      FOLLOW_UP_TITLE,
      RESOLVED_TITLE,
      CONSIDERATIONS_TITLE,
      FILES_TITLE,
      CHECKED_IN_CODE,
      CONTEXT_THIN,
      REVIEW_UNREAD,
      TYPE_TO_CONFIRM,
    ],
  ])
    // The states, kinds and keys the component switches on are not text on screen.
    .replace(/"(state|key|tone|icon|fileId)":"[^"]*"/g, "")
    .replace(/"action":\{[^}]*\}/g, "");

  it("never shows an internal code", () => {
    for (const code of [
      "SUFFICIENT",
      "ADDITIONAL_EVIDENCE",
      "CLARIFICATION",
      "POTENTIAL_EXCEPTION",
      "UNABLE_TO_CONCLUDE",
      "SATISFIED",
      "PARTIALLY_SUPPORTED",
      "CONTRADICTED",
      "NOT_DEMONSTRATED",
      "INDETERMINATE",
      "INCOMPLETE",
      "PARTLY_UNREADABLE",
      "RELIABILITY_UNRESOLVED",
      "MANAGEMENT_PREPARED",
      "SYSTEM_RECORD",
      "CANNOT_TELL",
      "NOT_RELEVANT",
      "NOT_SHOWN",
      "NOT_A_REPORT",
      "KIND_UNSURE",
      "WRONG_SYSTEM",
      "NOT_AFTER",
      "FAILED_ONE",
      "NOT_RUN",
      "PASSED",
      "EVIDENCE",
      "HIGH",
      "LOW",
      "OPEN",
      "ASSESSOR",
      "REVIEWER",
      "EXCEPTION",
    ]) {
      assert.ok(!shown.includes(code), code);
    }
  });

  it("uses no word of how the check is built, and says the organization", () => {
    assert.equal(
      /\bengine|\bagents?\b|assessor|reviewer|reconcil|deterministic|\bmodels?\b|\bprompts?\b|\bLLM\b|\bAI\b|pipeline|\bJSON\b/i.test(
        shown,
      ),
      false,
    );
    assert.equal(/\bclients?\b/i.test(shown), false);
  });
});

describe("the screen's own files, for the review", () => {
  const list = readFileSync("apps/web/src/design-evidence.tsx", "utf8");
  const css = readFileSync("apps/web/app/design-evidence.css", "utf8");
  const wizard = readFileSync("apps/web/src/evidence-wizard.tsx", "utf8");
  const wizardCss = readFileSync("apps/web/app/evidence-wizard.css", "utf8");
  const model = readFileSync(
    "apps/web/src/evidence-assurance-model.ts",
    "utf8",
  );
  /** A component's source: from its declaration to the next top-level one. */
  const component = (source: string, name: string) => {
    const from = source.indexOf(`\nfunction ${name}(`);
    assert.ok(from >= 0, name);
    const next = source.slice(from + 1).search(/\n(?:function |const [A-Z_]+)/);
    return source.slice(from, next < 0 ? undefined : from + 1 + next);
  };

  it("renders the review only where the check has one: a finished engine 2 run", () => {
    assert.match(
      list,
      /\{check\.review !== null \? \(\s*<CheckReview ids=\{ids\} review=\{check\.review\} files=\{files\} \/>\s*\) : null\}/,
    );
    assert.equal(list.match(/<CheckReview\b/g)?.length, 1);
    // Above the attribute list, inside the finished check's block.
    const reviewed = list.slice(
      list.indexOf('<div className="de-check is-reviewed">'),
    );
    assert.ok(
      reviewed.indexOf("<CheckReview") <
        reviewed.indexOf('<ul className="de-attrs">'),
    );
    // The model gives a review to engine 2 alone.
    assert.match(
      model,
      /review:\s*status === "REVIEWED" && engineVersion === 2\s*\? parseReview\(value\.review, only\)\s*: null,/,
    );
    assert.match(
      model,
      /const engineVersion = value\.engine_version === 2 \? 2 : 1;/,
    );
  });

  it("the review approves and decides nothing: no action but Copy and opening a passage", () => {
    const review =
      component(list, "CheckReview") + component(list, "FollowUpItem");
    for (const forbidden of [
      /accept\(/,
      /sufficiency/,
      /intent:/,
      /fetch\(/,
      /findingsAction/,
      /action\.run/,
      /onAct\b/,
      /router\./,
      /<form\b/,
      />\s*Accept/,
      /Approve|Decide|Conclude|Dismiss/,
    ]) {
      assert.equal(forbidden.test(review), false, String(forbidden));
    }
    assert.equal(review.match(/<button\b/g)?.length, 1);
    assert.match(review, /className="btn btn-ghost btn-sm de-copy"/);
    // It is headed as a proposal, in the model's words.
    assert.match(review, /\{REVIEW_TITLE\}/);
    assert.match(review, /\{REVIEW_FOR\}/);
  });

  it("keeps Accept and the findings' decisions where they are", () => {
    assert.match(
      list,
      /\{canAct && asking === null && row\.canAccept \? \(\s*<div className="de-accept">/,
    );
    assert.match(
      list,
      /\{assured !== null && assured\.acceptNote !== "" \? \(\s*<p className="de-accept-note">\{assured\.acceptNote\}<\/p>\s*\) : null\}/,
    );
    assert.match(list, /onClick=\{\(\) => void accept\(\)\}/);
    assert.equal(list.match(/void accept\(\)/g)?.length, 1);
    assert.match(list, /sufficiency: "ACCEPTED"/);
    assert.match(list, /<FindingRecords\s+findings=\{\[finding\]\}/);
    // The note beside Accept is built from the attributes alone.
    const note = model.slice(model.indexOf("export function acceptNote("));
    // (Its standing "REVIEWED" is the check's status, not the review.)
    assert.equal(
      /\breview\b|ReviewView|followUps|\.overall|assessment/.test(
        note.slice(0, note.indexOf("\n}\n")),
      ),
      false,
    );
  });

  it("copies a follow-up's request and says so politely, with no new dependency", () => {
    const item = component(list, "FollowUpItem");
    assert.match(item, /navigator\.clipboard\.writeText\(item\.request\)/);
    assert.match(item, /role="status"/);
    assert.match(item, /\? "Copied"/);
    // Where copying does not work, it says how to recover.
    assert.match(
      item,
      /Could not copy\. Select the request's text and copy it\./,
    );
    assert.match(item, /catch \{\s*setCopied\("failed"\);/);
    assert.equal(
      /from "(?!\.|react|next)/.test(list.replace(/from "react"/g, "")),
      false,
    );
  });

  it("uses the row's one Confirm the file's type for a file read with its type not confirmed", () => {
    assert.match(list, /\{fileLines\(check\.confirm\)\}/);
    assert.match(list, /const leftOut = fileLines\(check\.leftOut\);/);
    assert.equal(list.includes("Confirm the file's type"), false);
    assert.equal(model.match(/label: "Confirm the file's type"/g)?.length, 1);
  });

  it("shows an attribute's checks under Checked in code, and a consideration's passage as an attribute's", () => {
    const attribute = component(list, "AttributeCheck");
    assert.match(attribute, /line\.checks\.length > 0/);
    assert.match(attribute, /\{CHECKED_IN_CODE\}/);
    assert.match(attribute, /className=\{`de-state tone-\$\{item\.tone\}`\}/);
    assert.equal(list.match(/<PassageLine\b/g)?.length, 2);
    assert.match(attribute, /<PassageLine\b/);
    assert.match(component(list, "CheckReview"), /<PassageLine\b/);
    assert.match(component(list, "PassageLine"), /label="Open in the file"/);
  });

  it("folds considerations and the files by default, and opens within the motion budget", () => {
    const review = component(list, "CheckReview");
    assert.equal(/<details[^>]*\bopen\b/.test(review), false);
    assert.match(review, /\{CONSIDERATIONS_TITLE\}/);
    assert.match(review, /\{FILES_TITLE\}/);
    assert.match(review, /\{FOLLOW_UP_TITLE\}/);
    assert.match(review, /\{RESOLVED_TITLE\}/);
    assert.match(css, /\.de-fold-body \{[^}]*animation: tar-open 200ms ease;/);
    assert.match(
      css,
      /\.de-fold > summary \{[^}]*transition: color 120ms ease;/,
    );
    const reduced = css.slice(
      css.lastIndexOf("@media (prefers-reduced-motion"),
    );
    assert.match(reduced, /\.de-fold-body \{\s*animation: none;/);
    assert.match(reduced, /\.de-fold > summary \{\s*transition: none;/);
    // A fold's summary and Copy can be reached and seen by keyboard.
    assert.match(
      css,
      /\.de-fold > summary:focus-visible \{[^}]*outline: 2px solid var\(--accent\);/,
    );
    assert.match(css, /\.de-fold > summary \{[^}]*min-height: 24px;/);
    // "Copy" and "Copied" take the same room.
    assert.match(css, /button\.de-copy \{[^}]*min-width: 5\.5rem;/);
  });

  it("uses the tokens only, and never the accent as text", () => {
    const added = css.slice(
      css.indexOf("/* The review of a request's evidence"),
      css.indexOf("/* Accept, with what accepting marks as evidenced"),
    );
    assert.ok(added.length > 500);
    for (const sheet of [
      added,
      wizardCss.slice(
        wizardCss.indexOf(".wz-review {"),
        wizardCss.indexOf(".wz-ar {"),
      ),
    ]) {
      assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(sheet), false);
      assert.equal(/rgb\(|hsl\(/.test(sheet), false);
      assert.equal(/[^-]color: var\(--accent\)/.test(sheet), false);
      assert.equal(/^\s*color: (?!var\(--)/m.test(sheet), false);
    }
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false);
  });

  it("the wizard's results lead an item with its review, and leave an item without one as it was", () => {
    assert.match(wizard, /\{item\.review !== null \? \(/);
    assert.match(wizard, /<li className="wz-review">/);
    assert.match(wizard, /\{REVIEW_TITLE\}/);
    assert.match(wizard, /\{FOLLOW_UP_TITLE\}/);
    assert.match(wizard, /\{item\.review\.explanation\}/);
    assert.ok(
      wizard.indexOf('<li className="wz-review">') <
        wizard.indexOf("{item.attributes.map((row, at) => ("),
    );
    assert.match(
      wizardCss,
      /\.wz-review \{[^}]*border-left: 3px solid var\(--ai-border\);/,
    );
  });
});
