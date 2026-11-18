import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ASK_LIMIT,
  ASK_OWNER,
  ASK_UNSAID,
  type AttentionItem,
  absentOf,
  askLines,
  askText,
  attributeStatus,
  CAVEAT_ICON,
  type CheckDigest,
  checkDigest,
  cutAtWord,
  DECIDE,
  DETAILS_AGAINST,
  DETAILS_EXPLANATION,
  DETAILS_READ_IN_PART,
  DETAILS_SEPARATOR,
  DIGEST_NOTHING,
  type DigestExtra,
  type DigestFinding,
  FINDING_TO_DECIDE,
  FINDING_WAITS,
  fileRef,
  filesLeftOut,
  firstSentence,
  GIST_LIMIT,
  GIST_MISSING,
  GIST_NOT_IN_FILES,
  gistLine,
  MISSING,
  NEED_CONFIRM_TITLE,
  NEED_FILE_TITLE,
  NEED_REPLACE_TITLE,
  NEED_UNREAD_TITLE,
  needDetail,
  QUIET_NOT_ASKED,
  QUIET_READ_IN_PART,
  QUIET_SHOWN,
  QUIET_SHOWN_DESIGN,
  SENTENCE_MIN,
  STATUS_IN_PART,
  STATUS_IN_PART_DESIGN,
  STATUS_JUDGMENT,
  STATUS_NOT_ADDRESSED,
  STATUS_NOT_SHOWN,
  STATUS_SHOWN,
  STATUS_SHOWN_DESIGN,
  STATUS_SUPPORTED,
  tickedToStart,
  typesUnconfirmed,
  VERDICT_NO_RESULT,
  verdictAttention,
  verdictDesign,
  verdictInPart,
  verdictShown,
  verdictUnsaid,
} from "../apps/web/src/check-digest-model.ts";
import { lettersSpan } from "../apps/web/src/design-evidence-model.ts";
import {
  type AttributeLine,
  type AttributeState,
  acceptNoteParts,
  assuranceRow,
  COMPLETENESS_WORDS,
  ELEMENT_DEVIATION,
  type Lettered,
  notChecked,
  OUTCOME_WORDS,
  OUTCOMES,
  parseAssurance,
  READINGS_DISAGREE,
  RESULT_UNREAD,
  REVIEW_UNREAD,
  type RequestCheck,
  type RowFile,
  requestCheck,
  STATE_WORDS,
} from "../apps/web/src/evidence-assurance-model.ts";

// The check's result as "Needs attention" (docs/evidence-assurance.md, section 10.12,
// which replaces the layout of 10.11; product owner, 14 November 2026: "I like A. Looks
// good."). The digest arranges what the check's view model already words and decides
// nothing. What it must never do: word the outcome as more than the review's proposal,
// drop a caveat, show an issue or a judgment as shown, leave out that something is
// missing, or count differently from the lists under the counts. Every input here goes
// through the real parser and requestCheck, as the screen's does. Synthetic data only.
//
// Where a test of the first build (10.11) pinned what 10.12 replaces, the old
// expectation, the new one and the contract's section are said with it. Every
// audit-integrity assertion of the first build is kept.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C, D, E] = [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)] as const;
const REQUEST = uuid(11);
const [FILE, SECOND, THIRD] = [uuid(31), uuid(32), uuid(33)] as const;
const [FINDING, SECOND_FINDING] = [uuid(41), uuid(42)] as const;

const lettered: Lettered[] = [A, B, C, D, E].map((id, at) => ({
  id,
  letter: "ABCDE".charAt(at),
  text: `Attribute ${at + 1} wording.`,
}));

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
    summary:
      "The ticket shows line-manager approval before access. It names the approver.",
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

const SHOWN = attribute();

const JUDGMENT = attribute({
  attribute_id: B,
  code: "B",
  verdict: "UNSETTLED",
  result: null,
  shows: null,
  summary: "The readings differ on the quarterly review. One finds a reviewer.",
  passages: [],
  views: [
    { role: "ASSESSOR", result: "MET", reason: "Section 4 sets the review." },
    {
      role: "REVIEWER",
      result: "NOT_MET",
      reason: "Section 4 names no reviewer.",
    },
  ],
  assessment: "INDETERMINATE",
});

const NOT_SHOWN = attribute({
  attribute_id: C,
  code: "C",
  verdict: "ISSUE",
  result: "NOT_MET",
  shows: null,
  summary: "Nothing shows the access was provisioned as approved.",
  passages: [],
  absent: [
    "The provisioning record. It would show the role granted.",
    "The date the role was granted",
    "A sign-off by the system owner",
  ],
  finding_id: FINDING,
  finding_status: "PROPOSED",
  assessment: "NOT_DEMONSTRATED",
});

/** A record shows an exception: nothing is missing, so nothing is named absent. */
const DEVIATION = attribute({
  attribute_id: D,
  code: "D",
  verdict: "ISSUE",
  result: "NOT_MET",
  shows: null,
  summary:
    "A check of the records shows it: approved 11 January 2027, performed 10 January 2027. The approval is late.",
  passages: [],
  finding_id: SECOND_FINDING,
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

const element = (
  key: string,
  text: string,
  result: string | null,
  absent: string | string[] = "",
) => ({
  key,
  text,
  result,
  passages: result === "MET" ? [passage()] : [],
  absent,
});

/** Shown in part by this request: its approval is shown, its timing is left to others. */
const IN_PART = attribute({
  attribute_id: E,
  code: "E",
  verdict: "PARTLY_SUPPORTED",
  result: "SHOWN_IN_PART",
  summary: "This request shows the approval; the timing is for another.",
  assessment: "PARTIALLY_SUPPORTED",
  elements: [
    element("condition", "Access is approved by the line manager", "MET"),
    element("pass", "The approval comes before the grant", "NOT_ADDRESSED"),
  ],
});

/** The request asks for it and its files do not bear on it. */
const NOT_ADDRESSED = attribute({
  attribute_id: E,
  code: "E",
  verdict: "NOT_ADDRESSED",
  result: "NOT_ADDRESSED",
  shows: null,
  summary: "",
  passages: [],
  assessment: "NOT_DEMONSTRATED",
});

/** The request does not ask for it. */
const NOT_ASKED = attribute({
  attribute_id: E,
  code: "E",
  expected: false,
  verdict: "NOT_ADDRESSED",
  result: "NOT_ADDRESSED",
  shows: null,
  summary: "The request does not ask for attribute E.",
  passages: [],
  assessment: null,
});

const followUp = (over: Record<string, unknown> = {}) => ({
  key: "k1",
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
      "1 of 2 requested attributes is supported. C is not demonstrated: the provisioning record is not among the files.",
    completeness: { state: "COMPLETE", reasons: [] },
    context_thin: false,
    files: [],
    confirmations: [],
    concerns: [],
    follow_ups: [followUp()],
    follow_ups_more: 0,
    follow_ups_dropped: 0,
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
    attributes: [SHOWN, NOT_SHOWN],
    out_of_date: [],
    finished_at: "2026-11-14T10:00:00Z",
    note: "",
    engine_version: 2,
    review: review(),
    ...over,
  };
}

/** The check as the screen gets it: the API's answer through the real parser, then
 * requestCheck. */
function check(
  over: Record<string, unknown> = {},
  files: RowFile[] = [TICKET],
  attributes: readonly Lettered[] = lettered,
): RequestCheck {
  const parsed = parseAssurance({ requests: [entry(over)] });
  const [request] = parsed?.requests ?? [];
  assert.ok(request !== undefined);
  const all = attributes.map((item) => item.letter);
  return requestCheck(request, attributes, files, (letters) =>
    lettersSpan(letters, all),
  );
}

function digest(
  over: Record<string, unknown> = {},
  files: RowFile[] = [TICKET],
  findings: readonly DigestFinding[] = [],
  attributes: readonly Lettered[] = lettered,
  extras: readonly DigestExtra[] = [],
): CheckDigest {
  const made = checkDigest(
    check(over, files, attributes),
    findings,
    files,
    extras,
  );
  assert.ok(made !== null);
  return made;
}

/** An engine 1 entry: no review, whatever comes with it. */
const first = (over: Record<string, unknown> = {}) => ({
  engine_version: 1,
  review: null,
  ...over,
});

/** A review that recommends nothing. */
const quietReview = (over: Record<string, unknown> = {}) =>
  review({ follow_ups: [], ...over });

const PROPOSED: DigestFinding[] = [
  { id: FINDING, status: "PROPOSED" },
  { id: SECOND_FINDING, status: "PROPOSED" },
];

const row = (made: CheckDigest, letter: string) => {
  const found = made.attributes.find((item) => item.letter === letter);
  assert.ok(found !== undefined, `row ${letter}`);
  return found;
};

/** The item of an attribute, by its letter. */
const item = (made: CheckDigest, letter: string): AttentionItem => {
  const found = made.attention.find(
    (each) => each.kind === "ATTRIBUTE" && each.mark === letter,
  );
  assert.ok(found !== undefined, `item ${letter}`);
  return found;
};

const marks = (made: CheckDigest) =>
  made.attention.map((each) => `${each.kind} ${each.mark}`.trim());

const quietTexts = (made: CheckDigest) => made.quiet.map((each) => each.text);

/** The screen of the contract's own example: one of four shown, three attributes that
 * need the person's attention. */
const EXAMPLE = {
  attributes: [SHOWN, JUDGMENT, NOT_SHOWN, DEVIATION],
  review: review({
    overall: "POTENTIAL_EXCEPTION",
    completeness: { state: "RELIABILITY_UNRESOLVED", reasons: [] },
    follow_ups: [
      followUp(),
      followUp({ key: "k2", priority: "MEDIUM", request: "Provide the log." }),
      followUp({
        key: "k3",
        kind: "CLARIFICATION",
        priority: "LOW",
        request: "Say who granted the role.",
      }),
      followUp({
        key: "k4",
        attribute_ids: [D],
        codes: ["D"],
        request: "Explain the late approval.",
      }),
    ],
  }),
};

/** Every input the invariants are checked over. */
const INPUTS: Array<[Record<string, unknown>, RowFile[], DigestFinding[]]> = [
  [{}, [TICKET], []],
  [{}, [TICKET], PROPOSED],
  [EXAMPLE, [TICKET], PROPOSED],
  [EXAMPLE, [TICKET, SHEET, MEMO], [{ id: FINDING, status: "ANSWERED" }]],
  [first(), [TICKET], PROPOSED],
  [first({ attributes: [] }), [TICKET], []],
  [first({ read_in_part: true }), [TICKET, SHEET], []],
  [{ attributes: [], review: review({ follow_ups: [] }) }, [TICKET], []],
  [{ attributes: [SHOWN], review: review() }, [TICKET], []],
  [
    {
      attributes: [
        { ...SHOWN, shows: null },
        { ...JUDGMENT, pending: "FILE_NOT_READ", expected: false },
        { ...NOT_SHOWN, finding_status: "DISMISSED", expected: false },
        attribute({ attribute_id: D, code: "D", expected: false }),
        { ...IN_PART, expected: false },
      ],
      review: review({ overall: "SUFFICIENT", follow_ups: [] }),
    },
    [TICKET],
    [],
  ],
  [
    { attributes: [SHOWN, JUDGMENT, NOT_SHOWN, DEVIATION, NOT_ASKED] },
    [TICKET, SHEET, MEMO],
    PROPOSED,
  ],
  [
    {
      attributes: [SHOWN, IN_PART],
      held_files: [{ file_id: SECOND, code: "READ_FAILED", reason: "" }],
      review: review({
        follow_ups: [
          followUp(),
          followUp({ key: "k2" }),
          followUp({ key: "k3", attribute_ids: [], codes: [] }),
          followUp({ key: "k4", attribute_ids: [], codes: [] }),
        ],
        follow_ups_more: 3,
        confirmations: [{ file_id: FILE, code: "KIND_UNSURE", reason: "" }],
      }),
    },
    [TICKET, SHEET],
    [{ id: FINDING, status: "ACCEPTED" }],
  ],
  [
    {
      attributes: [
        { ...JUDGMENT, attribute_id: A, code: "A" },
        JUDGMENT,
        NOT_ADDRESSED,
      ],
      review: review({
        follow_ups: [
          followUp({ attribute_ids: [B], codes: ["B"] }),
          followUp({ key: "k2", attribute_ids: [A, B], codes: ["A", "B"] }),
          followUp({ key: "k3", attribute_ids: [B, E], codes: ["B", "E"] }),
        ],
      }),
    },
    [TICKET],
    [],
  ],
  [
    {
      read_in_part: true,
      attributes: [
        { ...SHOWN, shows: "DESIGN" },
        attribute({ attribute_id: B, code: "B" }),
        { ...NOT_SHOWN, finding_status: "DISMISSED" },
        { ...DEVIATION, expected: false },
      ],
      review: review({
        completeness: { state: "INCOMPLETE", reasons: [] },
        follow_ups: [followUp({ attribute_ids: [A], codes: ["A"] })],
      }),
    },
    [TICKET, SHEET],
    PROPOSED,
  ],
];

describe("a finished check only (rule 1)", () => {
  it("is null for a check that is queued, working, held, failed, out of date or not run", () => {
    for (const over of [
      { status: "QUEUED" },
      { status: "CHECKING", stage: "VERIFY" },
      { status: "HELD", held: { code: "KIND_UNSURE", reason: "" } },
      { status: "FAILED", note: "The reading did not finish." },
      { status: "REVIEWED", out_of_date: ["A file was replaced."] },
      { status: "SOMETHING_NEW" },
    ]) {
      const made = check(over);
      assert.notEqual(made.standing, "REVIEWED", JSON.stringify(over));
      assert.equal(
        checkDigest(made, PROPOSED, [TICKET]),
        null,
        JSON.stringify(over),
      );
    }
    const notRun = requestCheck(notChecked(REQUEST), lettered, [TICKET], (l) =>
      lettersSpan(l, ["A", "B", "C", "D", "E"]),
    );
    assert.equal(notRun.standing, "NOT_CHECKED");
    assert.equal(checkDigest(notRun, [], [TICKET]), null);
  });

  it("is made for a finished check of either engine", () => {
    assert.equal(check().standing, "REVIEWED");
    assert.notEqual(checkDigest(check(), [], [TICKET]), null);
    assert.notEqual(checkDigest(check(first()), [], [TICKET]), null);
  });
});

describe("the verdict (rules 1 and 5)", () => {
  it("the outcome is the review's own label, mark and tone, for every outcome", () => {
    for (const overall of OUTCOMES) {
      const over = {
        attributes: overall === "SUFFICIENT" ? [SHOWN] : [SHOWN, NOT_SHOWN],
        review: review({
          overall,
          follow_ups: overall === "SUFFICIENT" ? [] : [followUp()],
        }),
      };
      const shown = check(over).review;
      assert.ok(shown !== null);
      assert.deepEqual(
        digest(over).outcome,
        { label: shown.label, icon: shown.icon, tone: shown.tone },
        overall,
      );
      assert.deepEqual(digest(over).outcome, OUTCOME_WORDS[overall], overall);
    }
  });

  it("the outcome is never worded as more than the review reads it", () => {
    // "Sufficient" beside an attribute that is not satisfied: the review does not show
    // it as sufficient, so neither does the verdict.
    const over = { review: review({ overall: "SUFFICIENT" }) };
    assert.equal(check(over).review?.state, "UNABLE_TO_CONCLUDE");
    assert.deepEqual(digest(over).outcome, OUTCOME_WORDS.UNABLE_TO_CONCLUDE);
    assert.notEqual(digest(over).outcome?.tone, "success");
    // An outcome this page does not know is not a success either.
    const unknown = digest({ review: review({ overall: "PASSED" }) });
    assert.deepEqual(unknown.outcome, OUTCOME_WORDS.UNABLE_TO_CONCLUDE);
    // No outcome's words say the control works, or conclude an exception.
    for (const overall of OUTCOMES) {
      const label = digest({ review: review({ overall }) }).outcome?.label;
      assert.ok(
        Object.values(OUTCOME_WORDS).some((words) => words.label === label),
      );
      assert.equal(
        /effective|passed|failed|deficien|confirmed/i.test(label ?? ""),
        false,
      );
    }
  });

  it("a check without a review (the first engine) has no outcome and no caveat pill, and its sentence alone", () => {
    const made = digest(first());
    assert.equal(made.outcome, null);
    assert.equal(made.caveat, null);
    assert.deepEqual(made.asks, []);
    assert.equal(made.askTotal, 0);
    assert.equal(made.asksMore, "");
    assert.equal(
      made.verdict,
      "1 of 2 attributes is shown. 1 needs your attention.",
    );
  });

  it("the caveat is always there where the evidence is not complete, in the review's words", () => {
    for (const state of [
      "INCOMPLETE",
      "PARTLY_UNREADABLE",
      "RELIABILITY_UNRESOLVED",
    ] as const) {
      for (const overall of OUTCOMES) {
        const over = {
          attributes: [SHOWN],
          review: review({
            overall,
            follow_ups: [],
            completeness: { state, reasons: ["The listing names no source."] },
          }),
        };
        const made = digest(over);
        assert.notEqual(check(over).review?.completeness, null);
        assert.deepEqual(
          made.caveat,
          {
            label: COMPLETENESS_WORDS[state],
            icon: CAVEAT_ICON,
            tone: "warning",
          },
          `${state} ${overall}`,
        );
      }
    }
    // A completeness this page does not know, or none sent, is not complete.
    for (const completeness of [{ state: "NEW_STATE" }, undefined, null, 7]) {
      const made = digest({ review: review({ completeness }) });
      assert.equal(made.caveat?.label, COMPLETENESS_WORDS.INCOMPLETE);
      assert.equal(made.caveat?.tone, "warning");
    }
  });

  it("there is no caveat where the evidence is complete", () => {
    assert.equal(digest().caveat, null);
  });

  it("reads as the contract's own sentence", () => {
    // Superseded by section 10.12, item 1. Old (10.11, item 1): three counts on the
    // answer line, `facts` = "1 of 4 attributes shown", "3 to ask for", "2 need you".
    // New: one sentence under the outcome. Kept: the outcome's and the caveat's own
    // words, and that the numbers are those of the lists (the invariant test below).
    const made = digest(EXAMPLE);
    assert.equal(
      made.verdict,
      "1 of 4 attributes is shown. 3 need your attention.",
    );
    assert.equal(made.attention.length, 3);
    assert.equal(made.outcome?.label, "Potential exception to investigate");
    assert.equal(made.caveat?.label, "Reliability to resolve");
    // A file's type to confirm is one more thing that waits on the person.
    const typed = digest({
      ...EXAMPLE,
      review: review({
        ...EXAMPLE.review,
        confirmations: [{ file_id: FILE, code: "KIND_UNSURE", reason: "" }],
      }),
    });
    assert.equal(
      typed.verdict,
      "1 of 4 attributes is shown. 4 need your attention.",
    );
  });

  it("handles the singulars, and says nothing of attention where nothing waits", () => {
    assert.equal(
      digest({ attributes: [SHOWN], review: quietReview() }).verdict,
      "1 of 1 attribute is shown.",
    );
    assert.equal(
      digest({ attributes: [JUDGMENT], review: quietReview() }).verdict,
      "0 of 1 attribute is shown. 1 needs your attention.",
    );
    assert.equal(
      digest({
        attributes: [
          SHOWN,
          attribute({ attribute_id: B, code: "B" }),
          NOT_SHOWN,
          DEVIATION,
        ],
      }).verdict,
      "2 of 4 attributes are shown. 2 need your attention.",
    );
    assert.equal(
      digest({ attributes: [NOT_SHOWN, DEVIATION], review: quietReview() })
        .verdict,
      "0 of 2 attributes are shown. 2 need your attention.",
    );
    assert.equal(verdictShown(1, 4), "1 of 4 attributes is shown.");
    assert.equal(verdictShown(3, 4), "3 of 4 attributes are shown.");
    assert.equal(verdictShown(0, 1), "0 of 1 attribute is shown.");
    assert.equal(verdictDesign(1), "1 shown in design.");
    assert.equal(verdictAttention(1), "1 needs your attention.");
    assert.equal(verdictAttention(2), "2 need your attention.");
  });

  it("never counts an attribute shown only in design as shown: it is said apart", () => {
    // Kept from the review of the first build (section 10.12, last paragraph). Old: a
    // supported attribute was counted as shown whatever it showed. New: one shown only
    // by what a document requires is counted apart.
    const design = { ...SHOWN, shows: "DESIGN" };
    assert.equal(
      digest({ attributes: [design], review: quietReview() }).verdict,
      "0 of 1 attribute is shown. 1 shown in design.",
    );
    assert.equal(
      digest({
        attributes: [
          design,
          attribute({ attribute_id: B, code: "B" }),
          NOT_SHOWN,
        ],
      }).verdict,
      "1 of 3 attributes is shown. 1 shown in design. 1 needs your attention.",
    );
    assert.equal(
      digest({
        attributes: [design, { ...design, attribute_id: B, code: "B" }],
        review: quietReview(),
      }).verdict,
      "0 of 2 attributes are shown. 2 shown in design.",
    );
  });

  it("counts the attributes the request asks for, and only a supported one as shown", () => {
    const made = digest({
      attributes: [
        SHOWN,
        JUDGMENT,
        NOT_SHOWN,
        attribute({ attribute_id: D, code: "D", expected: false }),
        NOT_ADDRESSED,
      ],
    });
    // D is shown and listed, but the request does not ask for it: it is not counted.
    assert.deepEqual(
      made.attributes.map((each) => each.letter),
      ["A", "B", "C", "D", "E"],
    );
    assert.equal(
      made.verdict,
      "1 of 4 attributes is shown. 3 need your attention.",
    );
    // In part, an issue, a judgment, a decided issue: none is counted as shown.
    const none = digest({
      attributes: [
        IN_PART,
        NOT_SHOWN,
        JUDGMENT,
        { ...DEVIATION, finding_status: "DISMISSED" },
      ],
    });
    assert.equal(
      none.verdict,
      "0 of 4 attributes are shown. 3 need your attention.",
    );
  });

  it("says so where the check has no result for an attribute the request asks for, never 0 of 0", () => {
    for (const over of [
      { attributes: [] },
      first({ attributes: [] }),
      { attributes: [NOT_ASKED] },
      { attributes: [attribute({ expected: false })] },
    ]) {
      const made = digest({ review: quietReview(), ...over });
      assert.equal(made.verdict, VERDICT_NO_RESULT, JSON.stringify(over));
      assert.equal(/\b0 of 0\b/.test(made.verdict), false);
    }
    // What waits on the person is still counted.
    assert.equal(
      digest({ attributes: [] }).verdict,
      `${VERDICT_NO_RESULT} 1 needs your attention.`,
    );
  });

  it("the numbers equal the lists, whatever the check", () => {
    for (const [over, files, findings] of INPUTS) {
      const made = digest(over, files, findings);
      const said = made.verdict;
      const built = check(over, files);
      const asked = made.attributes.filter((each) => each.line.expected);
      const supported = asked.filter((each) => each.line.state === "SUPPORTED");
      const design = supported.filter((each) => each.line.shows === "DESIGN");
      const unsaid = supported.filter((each) => each.line.shows === null);
      const numbers = (pattern: RegExp) =>
        (pattern.exec(said) ?? []).slice(1).map(Number);
      assert.deepEqual(
        numbers(/(\d+) of (\d+) attributes? (?:is|are) shown\./),
        asked.length > 0
          ? [
              supported.filter((each) => each.line.shows === "IMPLEMENTATION")
                .length,
              asked.length,
            ]
          : [],
        said,
      );
      assert.deepEqual(
        numbers(/(\d+) supported, the check does not say how\./),
        unsaid.length > 0 ? [unsaid.length] : [],
        said,
      );
      assert.equal(asked.length > 0, !said.includes(VERDICT_NO_RESULT), said);
      assert.deepEqual(
        numbers(/(\d+) shown in design\./),
        design.length > 0 ? [design.length] : [],
        said,
      );
      assert.deepEqual(
        numbers(/(\d+) needs? your attention\./),
        made.attention.length > 0 ? [made.attention.length] : [],
        said,
      );
      // The items are exactly: each attribute that needs attention, each file with an
      // action of its own, and each follow-up with no item of an attribute to sit on.
      const needing = made.attributes.filter((each) => each.attention);
      const acting = [...built.confirm, ...built.leftOut].filter(
        (each) => each.action !== null,
      );
      const count = (kind: AttentionItem["kind"]) =>
        made.attention.filter((each) => each.kind === kind).length;
      assert.equal(count("ATTRIBUTE"), needing.length, said);
      assert.equal(count("FILE"), acting.length, said);
      assert.equal(
        new Set(made.attention.map((each) => each.key)).size,
        made.attention.length,
      );
      // Every row is one of the check's own, once; nothing is counted that is not
      // listed, and every attribute is one step.
      assert.equal(
        made.attributes.length,
        built.attributes.length + built.notAddressed.length,
      );
      assert.equal(
        new Set(made.attributes.map((each) => each.key)).size,
        made.attributes.length,
      );
      assert.deepEqual(
        [...made.steps].sort(),
        made.attributes.map((each) => each.key).sort(),
      );
      assert.equal(made.askTotal, built.review?.followUps.length ?? 0);
      assert.equal(
        made.asks.reduce((sum, ask) => sum + 1 + ask.similar.length, 0),
        made.askTotal,
      );
      // Every attribute is on the first screen exactly once: as an item, or on the
      // quiet line in its own words. None is reachable only by stepping.
      const placed = [
        ...made.attention
          .filter((each) => each.kind === "ATTRIBUTE")
          .map((each) => each.attributeKey),
        ...made.quiet
          .filter((each) => each.kind !== "CAVEAT")
          .map((each) => each.attributeKey),
      ];
      assert.deepEqual(
        [...placed].sort(),
        made.attributes.map((each) => each.key).sort(),
        said,
      );
      for (const each of made.quiet) {
        const of = made.attributes.find((one) => one.key === each.attributeKey);
        assert.equal(each.kind === "CAVEAT", of === undefined, each.text);
        // Only what the records or a document show is said as shown, in green.
        assert.equal(
          each.kind === "SHOWN",
          of?.line.state === "SUPPORTED" && of.line.shows !== null,
          each.text,
        );
        assert.equal(
          each.tone === "success" && each.kind !== "SHOWN",
          false,
          each.text,
        );
        assert.equal(
          each.text.endsWith(QUIET_NOT_ASKED),
          of !== undefined && !of.line.expected,
          each.text,
        );
      }
      // An item of an attribute says the attribute's own state; no other item has one.
      for (const each of made.attention) {
        const of = made.attributes.find((one) => one.key === each.attributeKey);
        assert.deepEqual(
          each.status,
          each.kind === "ATTRIBUTE" && of !== undefined
            ? attributeStatus(of.line)
            : null,
          each.key,
        );
      }
      // The calm sentence: said only where nothing waits, and "Nothing needs your
      // attention." never beside an outcome or a caveat that says otherwise.
      assert.equal(made.calm !== "" && made.attention.length > 0, false, said);
      if (made.calm === DIGEST_NOTHING) {
        assert.equal(made.attention.length, 0);
        assert.equal(
          made.quiet.some((each) => each.kind === "CAVEAT"),
          false,
        );
        assert.equal(made.caveat, null);
        assert.ok(made.outcome === null || made.outcome.tone === "success");
      }
      // Nothing is asked unseen: every follow-up ticked to start is under a tick of the
      // first screen, and every other lead is under one, or under an attribute that
      // "Decide" opens.
      const ticks = new Set(
        made.attention.flatMap((each) =>
          each.control.type === "ASK" ? each.control.askKeys : [],
        ),
      );
      for (const key of tickedToStart(made)) {
        assert.equal(ticks.has(key), true, key);
      }
      for (const ask of made.asks) {
        assert.equal(
          ticks.has(ask.key) ||
            needing.some(
              (each) =>
                each.line.state === "JUDGMENT" && each.asks.includes(ask),
            ),
          true,
          ask.key,
        );
      }
    }
  });
});

describe("attributes, one each (section 10.12, one attribute at a time)", () => {
  it("lists every attribute the check has a result for, and those the request asks for that the files do not bear on, not those it does not ask for", () => {
    const over = {
      attributes: [
        NOT_ASKED,
        NOT_SHOWN,
        SHOWN,
        { ...NOT_ADDRESSED, attribute_id: D, code: "D" },
        JUDGMENT,
      ],
    };
    const built = check(over);
    assert.deepEqual(
      built.attributes.map((line) => line.letter),
      ["C", "B", "A"],
    );
    assert.deepEqual(
      built.notAddressed.map((line) => line.letter),
      ["D"],
    );
    assert.deepEqual(
      built.notAsked.map((line) => line.letter),
      ["E"],
    );
    const made = digest(over);
    // In the attributes' own order, not the check's (issues first).
    assert.deepEqual(
      made.attributes.map((each) => each.letter),
      ["A", "B", "C", "D"],
    );
    assert.equal(made.details.summary.includes("1 not asked for"), true);
  });

  it("carries the attribute's wording in full and the check's own line", () => {
    const made = digest();
    const built = check();
    const a = row(made, "A");
    assert.equal(a.text, "Attribute 1 wording.");
    assert.equal(a.key, A);
    assert.deepEqual(
      a.line,
      built.attributes.find((line) => line.letter === "A"),
    );
  });

  it("orders the letters past Z: A, B, Z, AA, AB", () => {
    const letters = ["AB", "Z", "AA", "B", "A", "Y"];
    const many: Lettered[] = letters.map((letter, at) => ({
      id: uuid(100 + at),
      letter,
      text: `Attribute ${letter} wording.`,
    }));
    const made = digest(
      {
        attributes: many.map((each, at) =>
          ["Z", "AA", "B"].includes(each.letter)
            ? {
                ...NOT_SHOWN,
                attribute_id: each.id,
                code: `X${at}`,
                finding_id: null,
              }
            : attribute({ attribute_id: each.id, code: `X${at}` }),
        ),
        review: quietReview(),
      },
      [TICKET],
      [],
      many,
    );
    assert.deepEqual(
      made.attributes.map((each) => each.letter),
      ["A", "B", "Y", "Z", "AA", "AB"],
    );
    // The items and the steps keep that order: Z before AA.
    assert.deepEqual(marks(made), [
      "ATTRIBUTE B",
      "ATTRIBUTE Z",
      "ATTRIBUTE AA",
    ]);
    assert.deepEqual(
      made.steps.map(
        (key) => made.attributes.find((each) => each.key === key)?.letter,
      ),
      ["B", "Z", "AA", "A", "Y", "AB"],
    );
    assert.deepEqual(quietTexts(made), ["A shown", "Y shown", "AB shown"]);
  });

  it("keeps the order lines came in where their letters are the same, and puts a line with a code after the letters", () => {
    // Attributes no longer on the control keep the server's code as their letter.
    const made = digest({
      attributes: [
        attribute({ attribute_id: uuid(71), code: "B2" }),
        attribute({ attribute_id: uuid(72), code: "B10" }),
        attribute({ attribute_id: uuid(73), code: "AA" }),
        attribute({ attribute_id: uuid(74), code: "b" }),
        attribute({ attribute_id: uuid(75), code: "B" }),
        SHOWN,
      ],
    });
    assert.deepEqual(
      made.attributes.map((each) => each.letter),
      ["A", "b", "B", "B2", "B10", "AA"],
    );
  });

  it("says each state in short words with the line's own mark and tone", () => {
    const made = digest({
      attributes: [SHOWN, JUDGMENT, NOT_SHOWN, DEVIATION, IN_PART],
    });
    assert.deepEqual(row(made, "A").status, {
      label: STATUS_SHOWN,
      icon: STATE_WORDS.SUPPORTED.icon,
      tone: "success",
    });
    assert.deepEqual(row(made, "B").status, {
      label: STATUS_JUDGMENT,
      icon: STATE_WORDS.JUDGMENT.icon,
      tone: "warning",
    });
    // The check's own label is "Issue: not met": the row never says "not shown" for it,
    // because a record may show the exception (attribute D).
    assert.equal(row(made, "C").line.label, "Issue: not met");
    assert.deepEqual(row(made, "C").status, {
      label: "Not met",
      icon: STATE_WORDS.ISSUE.icon,
      tone: "danger",
    });
    assert.equal(row(made, "D").status.label, "Not met");
    assert.deepEqual(row(made, "E").status, {
      label: STATUS_IN_PART,
      icon: STATE_WORDS.PARTLY.icon,
      tone: STATE_WORDS.PARTLY.tone,
    });
    assert.equal(STATUS_SHOWN, "Shown");
    // Shown only by what a document requires: the status says so, and never reads as
    // the plain "Shown" of an instance's records.
    const design = digest({ attributes: [{ ...SHOWN, shows: "DESIGN" }] });
    assert.equal(row(design, "A").line.shows, "DESIGN");
    assert.equal(row(design, "A").status.label, STATUS_SHOWN_DESIGN);
    assert.equal(STATUS_SHOWN_DESIGN, "Shown in design");
    assert.equal(row(design, "A").status.tone, "success");
    assert.equal(STATUS_IN_PART, "Shown in part");
    assert.equal(STATUS_JUDGMENT, "Your judgment");
  });

  it("words an issue from its own label, without the lead", () => {
    const issue = (result: string | null) =>
      row(
        digest({
          attributes: [SHOWN, { ...NOT_SHOWN, result }],
        }),
        "C",
      );
    assert.equal(
      issue("CONTRADICTED").status.label,
      "Contradicted in the evidence",
    );
    assert.equal(
      issue("NOT_ADDRESSED").status.label,
      "Not addressed by the evidence",
    );
    assert.equal(issue(null).line.label, "Issue");
    assert.equal(issue(null).status.label, "Issue");
    // A label that says "not shown" reads as that.
    const line = issue("NOT_MET").line;
    assert.equal(
      attributeStatus({ ...line, label: "Issue: not shown" }).label,
      STATUS_NOT_SHOWN,
    );
  });

  it("an open issue never reads as the benign Shown in part: it keeps the check's own met in part (rule 6)", () => {
    // Superseded by section 10.12, last paragraph. Old (first build): an issue whose
    // label says "met in part" read "Shown in part", the words of an attribute this
    // request shows in part and leaves the rest to others. New: "Met in part", the
    // label's own words without the lead. Kept: it is never toned as shown.
    const partly = row(
      digest({ attributes: [SHOWN, { ...NOT_SHOWN, result: "PARTLY_MET" }] }),
      "C",
    );
    assert.equal(partly.line.state, "ISSUE");
    assert.equal(partly.line.label, "Issue: met in part");
    assert.deepEqual(partly.status, {
      label: "Met in part",
      icon: STATE_WORDS.ISSUE.icon,
      tone: "danger",
    });
    assert.equal(partly.attention, true);
    // Whatever an issue's label says, it is never "Shown in part".
    for (const label of [
      "Issue: met in part",
      "Issue: shown in part",
      "Shown in part",
      "issue: SHOWN IN PART by the ticket",
      "Issue: Met in part by one reading",
    ]) {
      const words = attributeStatus({ ...partly.line, label }).label;
      assert.notEqual(words, STATUS_IN_PART, label);
      assert.equal(/^shown\b/i.test(words), false, label);
    }
    assert.equal(
      attributeStatus({ ...partly.line, label: "Issue: shown in part" }).label,
      STATE_WORDS.ISSUE.label,
    );
    // Only an attribute this request shows in part reads so.
    const made = digest({
      attributes: [
        SHOWN,
        JUDGMENT,
        { ...NOT_SHOWN, result: "PARTLY_MET" },
        { ...DEVIATION, finding_status: "DISMISSED" },
        IN_PART,
      ],
    });
    assert.deepEqual(
      made.attributes
        .filter((each) => each.status.label === STATUS_IN_PART)
        .map((each) => each.line.state),
      ["PARTLY"],
    );
  });

  it("a decided issue and a result waiting on a file keep the check's own words; an attribute not borne on says so", () => {
    const made = digest({
      attributes: [
        { ...NOT_SHOWN, finding_status: "DISMISSED" },
        { ...JUDGMENT, pending: "FILE_NOT_READ" },
        NOT_ADDRESSED,
      ],
      review: quietReview(),
    });
    assert.deepEqual(row(made, "C").status, {
      label: "Issue: decided by dismissal",
      icon: STATE_WORDS.DECIDED.icon,
      tone: STATE_WORDS.DECIDED.tone,
    });
    assert.deepEqual(row(made, "B").status, STATE_WORDS.WAITING);
    assert.deepEqual(row(made, "E").status, {
      label: STATUS_NOT_ADDRESSED,
      icon: STATE_WORDS.NOT_ADDRESSED.icon,
      tone: STATE_WORDS.NOT_ADDRESSED.tone,
    });
    // Superseded by section 10.12, item 2. Old (10.11, item 4): neither B nor E was a
    // need (`needs` was empty: only a judgment, a file and the findings were). New: an
    // attribute waiting on a file, and one the files do not bear on, need attention;
    // neither is the person's judgment to make ("Decide"). Kept: a decided issue is not
    // shown, and does not wait on the person.
    assert.deepEqual(marks(made), ["ATTRIBUTE B", "ATTRIBUTE E"]);
    assert.deepEqual(
      made.attention.map((each) => each.control),
      [{ type: "NONE" }, { type: "NONE" }],
    );
    assert.equal(
      made.verdict,
      "0 of 3 attributes are shown. 2 need your attention.",
    );
  });

  it("an issue or a judgment is never worded or toned as shown", () => {
    const results = ["NOT_MET", "PARTLY_MET", "CONTRADICTED", "NOT_ADDRESSED"];
    const unsettled = [
      JUDGMENT,
      { ...JUDGMENT, summary: "" },
      // "Supported" without a passage it rests on, a verdict this page does not know,
      // and an issue that says "met": none stands, each is the person's judgment.
      attribute({ attribute_id: B, code: "B", passages: [] }),
      attribute({ attribute_id: B, code: "B", verdict: "CONFIRMED" }),
      { ...NOT_SHOWN, attribute_id: B, code: "B", result: "MET" },
    ];
    const rows = [
      ...results.map((result) => ({ ...NOT_SHOWN, result })),
      ...unsettled,
    ].map((each) => {
      const made = digest({ attributes: [each], review: quietReview() });
      const [only] = made.attributes;
      assert.ok(only !== undefined);
      assert.equal(
        made.verdict,
        "0 of 1 attribute is shown. 1 needs your attention.",
      );
      // It is an item of the first screen, and never on the quiet line as shown.
      assert.equal(only.attention, true);
      assert.deepEqual(
        made.attention.map((one) => one.attributeKey),
        [only.key],
      );
      assert.deepEqual(
        made.quiet.filter((one) => one.kind === "SHOWN"),
        [],
      );
      return only;
    });
    for (const each of rows) {
      assert.ok(["ISSUE", "JUDGMENT"].includes(each.line.state));
      assert.notEqual(each.status.tone, "success", each.status.label);
      assert.notEqual(each.status.icon, STATE_WORDS.SUPPORTED.icon);
      assert.notEqual(each.status.label, STATUS_SHOWN);
      assert.equal(/^(shown|supported)\b/i.test(each.status.label), false);
      assert.notEqual(each.gist.text, "");
    }
    assert.deepEqual(
      rows.slice(4).map((each) => each.status.label),
      unsettled.map(() => STATUS_JUDGMENT),
    );
  });

  it("holds even for a line that came with the wrong words or tone", () => {
    const issue = row(digest(), "C").line;
    const judgment = row(digest({ attributes: [JUDGMENT] }), "B").line;
    for (const label of [
      "Shown",
      "Issue: shown",
      "Issue: Supported",
      "issue:",
      "Issue",
      "",
      "   ",
      "Issue: met",
    ]) {
      const status = attributeStatus({
        ...issue,
        label,
        tone: "success",
        icon: "check",
      });
      assert.deepEqual(status, STATE_WORDS.ISSUE, JSON.stringify(label));
    }
    assert.deepEqual(
      attributeStatus({
        ...judgment,
        label: "Shown",
        tone: "success",
        icon: "check",
      }),
      { ...STATE_WORDS.JUDGMENT, label: STATUS_JUDGMENT },
    );
  });
});

describe("the one short line (rules 3, 7 and 8)", () => {
  it("a gap: Missing, the first thing not shown in its first sentence, and how many more", () => {
    const made = digest();
    const c = row(made, "C");
    assert.deepEqual(c.gist, {
      lead: GIST_MISSING,
      text: "The provisioning record.",
      more: 2,
    });
    assert.equal(gistLine(c.gist), "Missing: The provisioning record.");
    assert.equal(GIST_MISSING, "Missing");
    assert.equal(MISSING, GIST_MISSING);
    // The item's bold line is that line, and counts the same.
    assert.equal(item(made, "C").headline, "Missing: The provisioning record.");
    assert.equal(item(made, "C").more, 2);
  });

  it("reads as the approved screen's first item, from the check's own sentence", () => {
    const made = digest({
      attributes: [
        {
          ...NOT_SHOWN,
          attribute_id: A,
          code: "A",
          result: "PARTLY_MET",
          absent: [
            "Who disabled the account. The account view has no disabled-by field, and no disable log is given.",
          ],
        },
      ],
      review: review({
        follow_ups: [followUp({ attribute_ids: [A], codes: ["A"] })],
      }),
    });
    assert.deepEqual(made.attention, [
      {
        key: `ATTRIBUTE:${A}`,
        kind: "ATTRIBUTE",
        mark: "A",
        headline: "Missing: Who disabled the account.",
        more: 0,
        context: "Attribute 1 wording.",
        flag: "",
        status: {
          label: "Met in part",
          icon: STATE_WORDS.ISSUE.icon,
          tone: "danger",
        },
        control: { type: "ASK", askKeys: ["k1"] },
        attributeKey: A,
      },
    ]);
  });

  it("counts what the elements name as not shown, each distinct thing once", () => {
    const over = {
      attributes: [
        {
          ...NOT_SHOWN,
          absent: ["No record of the approval"],
          elements: [
            element("condition", "Access is approved", "NOT_MET", [
              "No record of the approval.",
              "  no record   of the APPROVAL ",
            ]),
            element("pass", "Before the grant", "NOT_MET", "The grant's date"),
            element("exception", "No self-approval", "MET"),
          ],
        },
      ],
    };
    const c = row(digest(over), "C");
    assert.deepEqual(absentOf(c.line), [
      "No record of the approval",
      "The grant's date",
    ]);
    assert.deepEqual(c.gist, {
      lead: GIST_MISSING,
      text: "No record of the approval.",
      more: 1,
    });
    assert.equal(item(digest(over), "C").more, 1);
    // Only the elements name it: still a gap.
    const fromElements = row(
      digest({
        attributes: [
          {
            ...NOT_SHOWN,
            absent: [],
            elements: [
              element(
                "pass",
                "Before the grant",
                "NOT_MET",
                "The grant's date",
              ),
            ],
          },
        ],
      }),
      "C",
    );
    assert.deepEqual(fromElements.gist, {
      lead: GIST_MISSING,
      text: "The grant's date.",
      more: 0,
    });
  });

  it("cuts a long thing at a word, within the line's length, with an ellipsis", () => {
    const long =
      "The provisioning record for request 4711 showing the role that was granted to the user and the date and time at which the administrator granted it";
    const c = row(
      digest({ attributes: [{ ...NOT_SHOWN, absent: [long] }] }),
      "C",
    );
    assert.equal(c.gist.lead, GIST_MISSING);
    assert.equal(c.gist.more, 0);
    assert.ok(c.gist.text.length <= GIST_LIMIT, String(c.gist.text.length));
    assert.equal(c.gist.text.endsWith("…"), true);
    const kept = c.gist.text.slice(0, -1);
    assert.equal(long.startsWith(kept), true);
    // The cut is between two words.
    assert.equal(long.charAt(kept.length), " ");
    assert.equal(GIST_LIMIT, 90);
    // One word longer than the line is still cut, never left whole.
    const word = row(
      digest({ attributes: [{ ...NOT_SHOWN, absent: ["x".repeat(4000)] }] }),
      "C",
    );
    assert.equal(word.gist.text, `${"x".repeat(89)}…`);
  });

  const passed = {
    element: "pass",
    test: "NOT_AFTER",
    status: "PASSED",
    sentence: "Approved 9 January 2027, performed 10 January 2027",
  };
  const failed = { ...passed, status: "FAILED", sentence: "It is late." };
  const notRun = { ...passed, status: "NOT_RUN", sentence: "Not compared." };

  it("a shown attribute quotes a comparison that passed only where every comparison on it passed (rule 7)", () => {
    // Superseded by section 10.12, last paragraph. Old (10.11, item 2): the first
    // comparison that passed was quoted, even beside one that failed. New: only where
    // every comparison on the attribute passed; otherwise the first sentence of what
    // the check says. Kept: a comparison that did not pass is never said under a shown
    // attribute.
    const a = (checks: unknown[]) =>
      row(digest({ attributes: [attribute({ checks })] }), "A").gist;
    const quoted = {
      lead: "",
      text: "Approved 9 January 2027, performed 10 January 2027.",
      more: 0,
    };
    assert.deepEqual(a([passed]), quoted);
    assert.deepEqual(
      a([passed, { ...passed, element: "condition", sentence: "They agree." }]),
      quoted,
    );
    for (const checks of [
      [],
      [notRun, failed, passed],
      [passed, failed],
      [passed, notRun],
      [failed, notRun],
      [{ ...passed, status: "FAILED_ONE" }, passed],
      // A status this page does not know reads as not run.
      [{ ...passed, status: "NEW_STATUS" }],
      [passed, { ...passed, status: "NEW_STATUS" }],
    ]) {
      assert.deepEqual(
        a(checks),
        {
          lead: "",
          text: "The ticket shows line-manager approval before access.",
          more: 0,
        },
        JSON.stringify(checks.map((each) => (each as typeof passed).status)),
      );
    }
    // Nothing said of it at all: the check's own label, never an empty line.
    assert.equal(
      row(digest({ attributes: [attribute({ summary: "" })] }), "A").gist.text,
      "Supported (implementation).",
    );
  });

  it("a comparison that passed is never the short line of an issue or a judgment", () => {
    const agree = { ...passed, sentence: "The dates agree." };
    const made = digest({
      attributes: [
        { ...DEVIATION, checks: [agree] },
        { ...JUDGMENT, checks: [agree] },
      ],
    });
    assert.equal(
      row(made, "D").gist.text,
      "A check of the records shows it: approved 11 January 2027, performed 10 January 2027.",
    );
    assert.equal(
      row(made, "B").gist.text,
      "The readings differ on the quarterly review.",
    );
    assert.equal(item(made, "D").headline, row(made, "D").gist.text);
    assert.equal(item(made, "B").headline, row(made, "B").gist.text);
  });

  it("a judgment: the sentence over the two readings", () => {
    const b = (over: Record<string, unknown>) =>
      row(digest({ attributes: [{ ...JUDGMENT, ...over }] }), "B");
    // The server's own sentence heads the attribute, so it is the one said.
    assert.equal(b({}).line.judgment, null);
    assert.deepEqual(b({}).gist, {
      lead: "",
      text: "The readings differ on the quarterly review.",
      more: 0,
    });
    assert.equal(b({ summary: "" }).line.judgment, READINGS_DISAGREE);
    assert.equal(
      b({ summary: "" }).gist.text,
      "The two readings do not agree.",
    );
    // A result this page could not take as it stands.
    const unread = b({ verdict: "SUPPORTED", result: "MET" });
    assert.equal(unread.line.judgment, RESULT_UNREAD);
    assert.equal(
      unread.gist.text,
      "This result could not be read as it was sent, so it is not shown as supported.",
    );
    assert.equal(unread.gist.lead, "");
    // Superseded by section 10.12, item 2 (an attribute left to the person's judgment:
    // "bold, the sentence over the two readings"). Old: where a reading named something
    // as not shown, the line was "Missing: The reviewer's name." New: a disagreement is
    // never worded as a gap; its own sentence leads and what is not shown is counted
    // after it. Kept: what a reading names as not shown is never left out of the line.
    assert.deepEqual(b({ absent: ["The reviewer's name"] }).gist, {
      lead: "",
      text: "The readings differ on the quarterly review.",
      more: 1,
    });
    assert.deepEqual(
      b({ summary: "", absent: ["The reviewer's name", "The date"] }).gist,
      { lead: "", text: "The two readings do not agree.", more: 2 },
    );
  });

  it("an attribute the files do not bear on: Not in these files.", () => {
    const made = digest({ attributes: [SHOWN, NOT_ADDRESSED] });
    assert.deepEqual(row(made, "E").gist, {
      lead: "",
      text: GIST_NOT_IN_FILES,
      more: 0,
    });
    assert.equal(GIST_NOT_IN_FILES, "Not in these files.");
    assert.equal(item(made, "E").headline, GIST_NOT_IN_FILES);
  });

  it("is never empty for an issue, a part or a judgment, whatever came", () => {
    const bare = { summary: "", absent: [], checks: [], views: [] };
    const made = digest({
      attributes: [
        { ...NOT_SHOWN, ...bare },
        { ...IN_PART, summary: "" },
        { ...JUDGMENT, ...bare, attribute_id: B, code: "B" },
        { ...NOT_SHOWN, ...bare, attribute_id: D, code: "D", result: null },
      ],
    });
    assert.equal(row(made, "C").gist.text, "Not met.");
    assert.equal(row(made, "D").gist.text, "Issue.");
    assert.equal(row(made, "E").gist.text, "Shown in part.");
    assert.equal(row(made, "B").gist.text, "The two readings do not agree.");
    for (const each of made.attributes) {
      assert.notEqual(each.gist.text.trim(), "", each.letter);
    }
    for (const each of made.attention) {
      assert.notEqual(each.headline.trim(), "", each.key);
    }
    // In part with the check's sentence: that sentence.
    assert.equal(
      row(digest({ attributes: [IN_PART] }), "E").gist.text,
      "This request shows the approval; the timing is for another.",
    );
  });

  it("reads a first sentence without stopping inside a file's name, a number or an abbreviation", () => {
    assert.equal(
      firstSentence("Ticket_4711.pdf was read in full. It names the approver."),
      "Ticket_4711.pdf was read in full.",
    );
    assert.equal(
      firstSentence("Version 4.2 of the procedure, e.g. the 2027 one. Next."),
      "Version 4.2 of the procedure, e.g. the 2027 one.",
    );
    assert.equal(firstSentence("  One\n line   only "), "One line only");
    assert.equal(firstSentence("Is it shown? It is."), "Is it shown?");
    assert.equal(firstSentence(""), "");
    assert.equal(cutAtWord("aaa bbb ccc", 8), "aaa bbb…");
    assert.equal(cutAtWord("aaa bbb ccc", 7), "aaa…");
    assert.equal(cutAtWord("aaa bbb ccc", 11), "aaa bbb ccc");
    assert.equal(cutAtWord("aaa, bbb", 5), "aaa…");
    assert.equal(cutAtWord("aaa", 0), "");
  });

  it("never ends a first sentence after an initial, an abbreviation or a list number (rule 8)", () => {
    const cases: Array<[string, string]> = [
      // An initial.
      [
        "Approved by J. Smith on 4 May. The grant followed.",
        "Approved by J. Smith on 4 May.",
      ],
      [
        "The record of (R. Jones) is absent. It was asked for.",
        "The record of (R. Jones) is absent.",
      ],
      // Each known abbreviation, before a word with a capital.
      [
        "Signed by Mr. Lee on the day. Then filed.",
        "Signed by Mr. Lee on the day.",
      ],
      [
        "Signed by Mrs. Lee on the day. Then filed.",
        "Signed by Mrs. Lee on the day.",
      ],
      [
        "Signed by Ms. Lee on the day. Then filed.",
        "Signed by Ms. Lee on the day.",
      ],
      [
        "Signed by Dr. Lee on the day. Then filed.",
        "Signed by Dr. Lee on the day.",
      ],
      [
        "Records, e.g. The log, are absent. More follows.",
        "Records, e.g. The log, are absent.",
      ],
      [
        "The log, i.e. The audit trail, is absent. More follows.",
        "The log, i.e. The audit trail, is absent.",
      ],
      [
        "Logs, tickets, etc. The owner holds them. More follows.",
        "Logs, tickets, etc. The owner holds them.",
      ],
      [
        "Ticket No. A-17 is not among them. Next.",
        "Ticket No. A-17 is not among them.",
      ],
      [
        "Ticket no. A-17 is not among them. Next.",
        "Ticket no. A-17 is not among them.",
      ],
      [
        "The listing vs. The ledger was not compared. Next.",
        "The listing vs. The ledger was not compared.",
      ],
      [
        "Filed in the U.S. Office of records. Next.",
        "Filed in the U.S. Office of records.",
      ],
      [
        "Held by Acme Inc. The owner signed. Later.",
        "Held by Acme Inc. The owner signed.",
      ],
      [
        "Held by Acme Ltd. The owner signed. Later.",
        "Held by Acme Ltd. The owner signed.",
      ],
      // A list number or letter, at the start and after a colon.
      ["1. Provide the record. It shows the role.", "1. Provide the record."],
      [
        "12. The provisioning record of the request. Then the log.",
        "12. The provisioning record of the request.",
      ],
      [
        "a. The provisioning record of the request. Then the log.",
        "a. The provisioning record of the request.",
      ],
      [
        "(ii). The provisioning record of the request. Then the log.",
        "(ii). The provisioning record of the request.",
      ],
      [
        "Provide these: 1. The provisioning record. Then the log.",
        "Provide these: 1. The provisioning record.",
      ],
      // A number that ends a sentence of its own still ends it.
      [
        "The approval is on page 3. It names the approver.",
        "The approval is on page 3.",
      ],
      [
        "Approved 11 January 2027, performed 10 January 2027. The approval is late.",
        "Approved 11 January 2027, performed 10 January 2027.",
      ],
    ];
    for (const [text, expected] of cases) {
      assert.equal(firstSentence(text), expected, text);
    }
    // The text ends there: it is the sentence, whatever it ends with.
    for (const whole of [
      "Approved by J.",
      "See No.",
      "1.",
      "A.",
      "Logs, etc.",
    ]) {
      assert.equal(firstSentence(whole), whole);
    }
    // Through the digest: the bold line is not cut at the initial.
    const made = digest({
      attributes: [
        {
          ...NOT_SHOWN,
          absent: [
            "The sign-off of J. Smith on the grant. It is not in the files.",
          ],
        },
      ],
    });
    assert.equal(
      item(made, "C").headline,
      "Missing: The sign-off of J. Smith on the grant.",
    );
  });

  it("runs a sentence shorter than twelve characters on to the next, or cuts at a word (rule 8)", () => {
    assert.equal(SENTENCE_MIN, 12);
    assert.equal(
      firstSentence("No log. The account view has none. More."),
      "No log. The account view has none.",
    );
    assert.equal(
      firstSentence("Yes. No. Maybe so, in the end. Done."),
      "Yes. No. Maybe so, in the end.",
    );
    // Exactly twelve is long enough; eleven is not.
    assert.equal(firstSentence("Abcdefghijk. Next one."), "Abcdefghijk.");
    assert.equal(
      firstSentence("Abcdefghij. Next one."),
      "Abcdefghij. Next one.",
    );
    // Nothing follows: it stays as short as it is.
    assert.equal(firstSentence("No log."), "No log.");
    assert.equal(firstSentence("None"), "None");
    // No later end within the line: cut at a word, with an ellipsis, within the limit.
    const run = `No log. ${"The account view has no field for it and ".repeat(6)}none`;
    const c = row(
      digest({ attributes: [{ ...NOT_SHOWN, absent: [run] }] }),
      "C",
    );
    assert.ok(c.gist.text.length <= GIST_LIMIT);
    assert.equal(c.gist.text.startsWith("No log. The account view"), true);
    assert.equal(c.gist.text.endsWith("…"), true);
    assert.equal(run.charAt(c.gist.text.length - 1), " ");
  });
});

describe("needs attention (rules 2 and 3)", () => {
  const WAITING = { ...JUDGMENT, pending: "FILE_NOT_READ" };

  it("an attribute the request asks for that is not shown: an issue, a part, a judgment, one not addressed, one waiting on a file", () => {
    const cases: Array<[Record<string, unknown>, AttributeState]> = [
      [NOT_SHOWN, "ISSUE"],
      [IN_PART, "PARTLY"],
      [JUDGMENT, "JUDGMENT"],
      [NOT_ADDRESSED, "NOT_ADDRESSED"],
      [WAITING, "WAITING"],
    ];
    for (const [each, state] of cases) {
      const made = digest({ attributes: [each], review: quietReview() });
      const [only] = made.attributes;
      assert.ok(only !== undefined, state);
      assert.equal(only.line.state, state);
      assert.equal(only.line.expected, true);
      assert.equal(only.attention, true, state);
      assert.deepEqual(
        made.attention.map((one) => [one.kind, one.mark, one.attributeKey]),
        [["ATTRIBUTE", only.letter, only.key]],
        state,
      );
      assert.deepEqual(made.steps, [only.key]);
      // The request does not ask for it: only an issue or a judgment still waits on
      // the person (the records may show an exception on it); a part, one not
      // addressed and one waiting on a file do not.
      const unasked = digest({
        attributes: [{ ...each, expected: false }],
        review: quietReview(),
      });
      const waits = unasked.attributes.some((one) => one.attention);
      const open = unasked.attributes.some(
        (one) => one.line.state === "ISSUE" || one.line.state === "JUDGMENT",
      );
      assert.equal(waits, open, state);
      assert.equal(unasked.attention.length, open ? 1 : 0, state);
    }
  });

  it("a supported attribute and a decided issue do not, unless a finding on them waits on the person", () => {
    const over = {
      attributes: [SHOWN, { ...NOT_SHOWN, finding_status: "DISMISSED" }],
      review: quietReview(),
    };
    const made = digest(over);
    assert.deepEqual(
      made.attributes.map((each) => [each.line.state, each.attention]),
      [
        ["SUPPORTED", false],
        ["DECIDED", false],
      ],
    );
    assert.deepEqual(made.attention, []);
    assert.equal(made.verdict, "1 of 2 attributes is shown.");
    // The decided issue's finding is proposed again, or answered by the owner.
    assert.deepEqual(FINDING_WAITS, ["PROPOSED", "ANSWERED"]);
    for (const status of FINDING_WAITS) {
      const waiting = digest(over, [TICKET], [{ id: FINDING, status }]);
      assert.equal(row(waiting, "C").attention, true, status);
      assert.deepEqual(waiting.attention, [
        {
          key: `ATTRIBUTE:${C}`,
          kind: "ATTRIBUTE",
          mark: "C",
          headline: "Missing: The provisioning record.",
          more: 2,
          context: "Attribute 3 wording.",
          flag: FINDING_TO_DECIDE,
          status: {
            label: "Issue: decided by dismissal",
            icon: STATE_WORDS.DECIDED.icon,
            tone: STATE_WORDS.DECIDED.tone,
          },
          control: { type: "NONE" },
          attributeKey: C,
        },
      ]);
      assert.equal(
        waiting.verdict,
        "1 of 2 attributes is shown. 1 needs your attention.",
      );
      // It is then not on the quiet line as well.
      assert.deepEqual(quietTexts(waiting), ["A shown"]);
    }
    for (const status of [
      "ACCEPTED",
      "DISMISSED",
      "SENT",
      "RESOLVED",
      "CLARIFICATION_ACCEPTED",
      "proposed",
      "",
    ]) {
      const decided = digest(over, [TICKET], [{ id: FINDING, status }]);
      assert.deepEqual(decided.attention, [], status);
    }
    // A finding on no attribute of this check, or without an id, changes nothing.
    assert.deepEqual(
      digest(
        over,
        [TICKET],
        [
          { id: uuid(99), status: "PROPOSED" },
          { id: "", status: "PROPOSED" },
        ],
      ).attention,
      [],
    );
    // A supported attribute a finding waits on (the parser gives a finding to an issue
    // alone, so the line is given one here).
    const built = check({ attributes: [SHOWN], review: quietReview() });
    const lines = built.attributes.map((line) => ({
      ...line,
      findingId: FINDING,
    }));
    const flagged = checkDigest(
      { ...built, attributes: lines },
      [{ id: FINDING, status: "ANSWERED" }],
      [TICKET],
    );
    assert.deepEqual(flagged?.attention, [
      {
        key: `ATTRIBUTE:${A}`,
        kind: "ATTRIBUTE",
        mark: "A",
        headline: "The ticket shows line-manager approval before access.",
        more: 0,
        context: "Attribute 1 wording.",
        flag: FINDING_TO_DECIDE,
        status: {
          label: STATUS_SHOWN,
          icon: STATE_WORDS.SUPPORTED.icon,
          tone: "success",
        },
        control: { type: "NONE" },
        attributeKey: A,
      },
    ]);
    assert.deepEqual(flagged?.quiet, []);
    // It is still counted as shown: the sentence says both.
    assert.equal(
      flagged?.verdict,
      "1 of 1 attribute is shown. 1 needs your attention.",
    );
    assert.equal(
      checkDigest({ ...built, attributes: lines }, [], [TICKET])?.attention
        .length,
      0,
    );
  });

  it("an issue on an attribute the request does not ask for still needs attention", () => {
    // The records may show an exception on an attribute this request does not ask for:
    // it is never left off the first screen (before the 14 November 2026 review of this
    // rule it was an item only where its finding waited on the person).
    const over = {
      attributes: [SHOWN, { ...NOT_SHOWN, expected: false }],
      review: quietReview(),
    };
    assert.equal(row(digest(over), "C").line.state, "ISSUE");
    assert.equal(row(digest(over), "C").attention, true);
    assert.deepEqual(
      digest(over).attention.map((entry) => entry.mark),
      ["C"],
    );
    assert.deepEqual(digest(over).steps, [C, A]);
    assert.deepEqual(quietTexts(digest(over)), ["A shown"]);
    // The count of shown attributes is still of those the request asks for.
    assert.equal(
      digest(over).verdict,
      "1 of 1 attribute is shown. 1 needs your attention.",
    );
    const waiting = digest(over, [TICKET], PROPOSED);
    assert.equal(item(waiting, "C").flag, FINDING_TO_DECIDE);
  });

  const over = {
    attributes: [SHOWN, JUDGMENT, NOT_SHOWN, DEVIATION],
    file_ids: [FILE],
    held_files: [
      { file_id: SECOND, code: "READ_FAILED", reason: "" },
      { file_id: THIRD, code: "TOO_LARGE", reason: "" },
    ],
    review: review({
      confirmations: [{ file_id: FILE, code: "KIND_UNSURE", reason: "" }],
      follow_ups: [
        followUp(),
        followUp({
          key: "k9",
          attribute_ids: [],
          codes: [],
          request: "Provide the period's population.",
        }),
      ],
    }),
  };
  const files = [TICKET, SHEET, MEMO];

  it("lists the attributes in their order, then a type to confirm, a file left out, then a request that names no attribute, each with its one control", () => {
    // Superseded by section 10.12, item 2. Old (10.11, item 4): `needs` listed a type
    // to confirm, a file left out, each judgment ("Review B"), then one line for the
    // findings ("2 proposed findings to accept or dismiss"); the attributes with a gap
    // were rows of a second list. New: one list, the attributes first, each finding
    // said on its attribute's item. Kept: only what waits on the person, each with one
    // control, and a file's action is the check's own.
    const built = check(over, files);
    const made = checkDigest(built, PROPOSED, files);
    assert.ok(made !== null);
    assert.deepEqual(made.attention, [
      {
        key: `ATTRIBUTE:${B}`,
        kind: "ATTRIBUTE",
        mark: "B",
        headline: "The readings differ on the quarterly review.",
        more: 0,
        context: "Attribute 2 wording.",
        flag: "",
        status: {
          label: STATUS_JUDGMENT,
          icon: STATE_WORDS.JUDGMENT.icon,
          tone: "warning",
        },
        control: { type: "OPEN", label: DECIDE },
        attributeKey: B,
      },
      {
        key: `ATTRIBUTE:${C}`,
        kind: "ATTRIBUTE",
        mark: "C",
        headline: "Missing: The provisioning record.",
        more: 2,
        context: "Attribute 3 wording.",
        flag: FINDING_TO_DECIDE,
        status: {
          label: "Not met",
          icon: STATE_WORDS.ISSUE.icon,
          tone: "danger",
        },
        control: { type: "ASK", askKeys: ["k1"] },
        attributeKey: C,
      },
      {
        key: `ATTRIBUTE:${D}`,
        kind: "ATTRIBUTE",
        mark: "D",
        headline:
          "A check of the records shows it: approved 11 January 2027, performed 10 January 2027.",
        more: 0,
        context: "Attribute 4 wording.",
        flag: FINDING_TO_DECIDE,
        status: {
          label: "Not met",
          icon: STATE_WORDS.ISSUE.icon,
          tone: "danger",
        },
        control: { type: "NONE" },
        attributeKey: D,
      },
      {
        key: `CONFIRM_TYPE:${FILE}`,
        kind: "FILE",
        mark: "E1",
        headline: NEED_CONFIRM_TITLE,
        more: 0,
        context:
          "Ticket_4711.pdf: Its type is not confirmed, so it was read as the type it appears to be.",
        flag: "",
        status: null,
        control: {
          type: "ACT",
          action: {
            kind: "CONFIRM_TYPE",
            label: "Confirm the file's type",
            fileId: FILE,
          },
          label: "Confirm the file's type",
        },
        attributeKey: null,
      },
      {
        key: `FILE:${SECOND}`,
        kind: "FILE",
        mark: "E2",
        // Rewritten 18 November 2026 (design review: one fact, one word). A file none
        // of whose text was read is said so, in its headline and its line. Old:
        // NEED_FILE_TITLE and "Checked without Access_listing.xlsx: Reading it did
        // not finish."
        headline: NEED_UNREAD_TITLE,
        more: 0,
        context: "Access_listing.xlsx was not read: reading it did not finish.",
        flag: "",
        status: null,
        control: {
          type: "ACT",
          action: {
            kind: "REREAD",
            label: "Read the file again",
            fileId: SECOND,
          },
          label: "Read the file again",
        },
        attributeKey: null,
      },
      {
        key: "GENERAL:k9",
        kind: "GENERAL",
        mark: "",
        headline: "Provide the period's population.",
        more: 0,
        context:
          "Without it nothing shows the access granted is the access approved.",
        flag: "",
        status: null,
        control: { type: "ASK", askKeys: ["k9"] },
        attributeKey: null,
      },
    ]);
    // The actions are the check's own, not copies with other words.
    const [, , , confirm, leftOut] = made.attention;
    assert.ok(confirm?.control.type === "ACT");
    assert.ok(leftOut?.control.type === "ACT");
    assert.equal(confirm.control.action, built.confirm[0]?.action);
    assert.equal(leftOut.control.action, built.leftOut[0]?.action);
    assert.equal(
      made.verdict,
      "1 of 4 attributes is shown. 6 need your attention.",
    );
    assert.equal(NEED_CONFIRM_TITLE, "Confirm this file's type.");
    assert.equal(NEED_FILE_TITLE, "A file was left out.");
    assert.equal(NEED_UNREAD_TITLE, "A file was not read.");
    assert.equal(DECIDE, "Decide");
    assert.equal(ASK_OWNER, "Ask owner");
    assert.equal(FINDING_TO_DECIDE, "Finding to decide");
  });

  it("the finding to decide is said on its attribute's item, only while it waits on the person", () => {
    const flags = (list: DigestFinding[]) =>
      digest(over, files, list)
        .attention.filter((each) => each.flag !== "")
        .map((each) => `${each.mark} ${each.flag}`);
    assert.deepEqual(flags([]), []);
    assert.deepEqual(flags(PROPOSED), [
      "C Finding to decide",
      "D Finding to decide",
    ]);
    assert.deepEqual(
      flags([
        { id: FINDING, status: "ACCEPTED" },
        { id: SECOND_FINDING, status: "ANSWERED" },
        { id: SECOND_FINDING, status: "ANSWERED" },
        // Proposed, but on no attribute of this check.
        { id: uuid(99), status: "PROPOSED" },
        { id: "", status: "PROPOSED" },
      ]),
      ["D Finding to decide"],
    );
    // A file and a general request never carry it.
    for (const each of digest(over, files, PROPOSED).attention) {
      assert.equal(each.kind !== "ATTRIBUTE" && each.flag !== "", false);
    }
  });

  it("what has no action is not an item: it stays said on the quiet line and in the details", () => {
    const built = check(over, files);
    // The file too large to read has no action of its own.
    assert.deepEqual(
      built.leftOut.map((each) => each.action?.kind ?? null),
      ["REREAD", null],
    );
    const made = digest(over, files, PROPOSED);
    assert.equal(
      made.attention.some((each) => each.context.includes("Owner_memo.docx")),
      false,
    );
    assert.deepEqual(quietTexts(made), ["A shown", "1 file left out"]);
    assert.equal(made.details.summary.includes("1 file left out"), true);
    // A file read as the type it appears to be, with a reason and no action.
    const noted = {
      attributes: [SHOWN],
      review: quietReview({
        confirmations: [
          { file_id: FILE, code: "NEW_CODE", reason: "It reads as a ticket." },
        ],
      }),
    };
    assert.equal(check(noted).confirm[0]?.action, null);
    assert.deepEqual(digest(noted).attention, []);
    assert.equal(
      digest(noted).details.summary.includes("1 note on a file's type"),
      true,
    );
  });

  it("marks a file by its place among the row's files, and leaves the mark empty for a file that is not one of them", () => {
    const made = digest(
      {
        ...over,
        held_files: [
          { file_id: THIRD, code: "READ_FAILED", reason: "" },
          { file_id: uuid(77), code: "UNREADABLE", reason: "" },
        ],
        review: review({
          confirmations: [{ file_id: SECOND, code: "KIND_UNSURE", reason: "" }],
        }),
        file_ids: [FILE, SECOND],
      },
      files,
    );
    assert.deepEqual(
      made.attention
        .filter((each) => each.kind === "FILE")
        .map((each) => [each.mark, each.headline, each.control.type]),
      [
        ["E2", NEED_CONFIRM_TITLE, "ACT"],
        // 18 November 2026 (design review): a file not read is said so, and one only
        // another copy clears says that. Old: NEED_FILE_TITLE on both.
        ["E3", NEED_UNREAD_TITLE, "ACT"],
        ["", NEED_REPLACE_TITLE, "ACT"],
      ],
    );
    assert.equal(fileRef(files, FILE), "E1");
    assert.equal(fileRef(files, THIRD), "E3");
    assert.equal(fileRef(files, uuid(77)), "");
    assert.equal(fileRef(files, ""), "");
    assert.equal(fileRef(files, null), "");
    assert.equal(fileRef([], FILE), "");
    // A file listed twice keeps its first place.
    assert.equal(fileRef([TICKET, SHEET, SHEET], SECOND), "E2");
  });

  it("a judgment's control is Decide, whatever is recommended for it; any other attribute's is a tick where the check recommends a follow-up", () => {
    const made = digest({
      attributes: [SHOWN, JUDGMENT, NOT_SHOWN, DEVIATION, IN_PART],
      review: review({
        follow_ups: [
          ...(EXAMPLE.review.follow_ups as unknown[]),
          followUp({
            key: "kb",
            attribute_ids: [B],
            codes: ["B"],
            request: "Provide the review's sign-off.",
          }),
          followUp({
            key: "k6",
            attribute_ids: [D, C],
            codes: ["D", "C"],
            request: "Provide both records.",
          }),
        ],
      }),
    });
    assert.deepEqual(item(made, "B").control, {
      type: "OPEN",
      label: "Decide",
    });
    // The lead of each group that serves it, in the list's order.
    assert.deepEqual(item(made, "C").control, {
      type: "ASK",
      askKeys: ["k1", "k3", "k6"],
    });
    assert.deepEqual(item(made, "D").control, {
      type: "ASK",
      askKeys: ["k4", "k6"],
    });
    // Nothing is recommended for it: no tick to offer.
    assert.deepEqual(item(made, "E").control, { type: "NONE" });
    // The follow-ups under each attribute; one serving two is under both, the same one.
    assert.deepEqual(
      made.attributes.map((each) => each.asks.map((ask) => ask.key)),
      [[], ["kb"], ["k1", "k3", "k6"], ["k4", "k6"], []],
    );
    assert.equal(row(made, "C").asks[2], row(made, "D").asks[1]);
    assert.equal(row(made, "C").asks[0], made.asks[0]);
    assert.deepEqual(
      row(made, "C").asks[0]?.similar.map((line) => line.key),
      ["k2"],
    );
    // A waiting attribute is not the person's judgment: a tick, not Decide.
    const waiting = digest({
      attributes: [WAITING],
      review: review({
        follow_ups: [followUp({ attribute_ids: [B], codes: ["B"] })],
      }),
    });
    assert.deepEqual(item(waiting, "B").control, {
      type: "ASK",
      askKeys: ["k1"],
    });
  });

  it("a judgment is never worded as a gap: its own sentence leads, and what is missing is counted after it", () => {
    // Superseded by section 10.12, item 2. Old (this test, first build of 10.12): a
    // judgment whose line named something missing read "Missing: The reviewer's name."
    // New: bold, the sentence over the two readings; what is missing is counted after
    // it (`more`, which the screen says as "+1 missing"). Kept: that something is
    // missing is never left out, and the control is "Decide".
    const made = digest({
      attributes: [{ ...JUDGMENT, absent: ["The reviewer's name"] }],
    });
    assert.equal(
      item(made, "B").headline,
      "The readings differ on the quarterly review.",
    );
    assert.equal(item(made, "B").more, 1);
    assert.equal(item(made, "B").headline.startsWith(MISSING), false);
    assert.deepEqual(item(made, "B").control, { type: "OPEN", label: DECIDE });
  });

  const failedCheck = {
    element: "pass",
    test: "NOT_AFTER",
    status: "FAILED",
    sentence: "Approved 11 January 2027, performed 10 January 2027.",
  };
  const ABSENT = ["The provisioning record.", "The date the role was granted"];

  it("an exception the records show is never worded as a gap (rule 1)", () => {
    const c = (over: Record<string, unknown>) => {
      const made = digest({
        attributes: [{ ...NOT_SHOWN, absent: ABSENT, ...over }],
        review: quietReview(),
      });
      return [
        item(made, "C").headline,
        item(made, "C").more,
        row(made, "C").gist.lead,
      ];
    };
    const own = "Nothing shows the access was provisioned as approved.";
    // A comparison on it did not pass, on both readings' values or on one's.
    assert.deepEqual(c({ checks: [failedCheck] }), [own, 2, ""]);
    assert.deepEqual(
      c({ checks: [{ ...failedCheck, status: "FAILED_ONE" }] }),
      [own, 2, ""],
    );
    assert.deepEqual(
      c({
        checks: [{ ...failedCheck, status: "PASSED" }, failedCheck],
        summary: "The approval came after the grant. It is late.",
      }),
      ["The approval came after the grant.", 2, ""],
    );
    // Its own label says the evidence contradicts it.
    const contradicted = digest({
      attributes: [{ ...NOT_SHOWN, absent: ABSENT, result: "CONTRADICTED" }],
      review: quietReview(),
    });
    assert.equal(
      row(contradicted, "C").line.label,
      "Issue: contradicted in the evidence",
    );
    assert.deepEqual(row(contradicted, "C").gist, {
      lead: "",
      text: own,
      more: 2,
    });
    // It has no sentence of its own: its state's words, still never "Missing".
    assert.deepEqual(c({ result: "CONTRADICTED", summary: "" }), [
      "Contradicted in the evidence.",
      2,
      "",
    ]);
    // Nothing is named as missing: nothing is counted.
    assert.deepEqual(c({ checks: [failedCheck], absent: [] }), [own, 0, ""]);
  });

  it("Missing leads only for a plain gap, read from what the line carries and never guessed from what is absent", () => {
    const lead = (each: Record<string, unknown>, letter: string) => {
      const made = digest({ attributes: [each], review: quietReview() });
      return [
        row(made, letter).line.state,
        item(made, letter).headline,
        item(made, letter).more,
      ];
    };
    const gap = "Missing: The provisioning record.";
    // An issue with no comparison that failed and no contradiction.
    assert.deepEqual(lead({ ...NOT_SHOWN, absent: ABSENT }, "C"), [
      "ISSUE",
      gap,
      1,
    ]);
    assert.deepEqual(
      lead({ ...NOT_SHOWN, absent: ABSENT, result: "PARTLY_MET" }, "C"),
      ["ISSUE", gap, 1],
    );
    // A comparison that passed, or was not made, is not an exception.
    assert.deepEqual(
      lead(
        {
          ...NOT_SHOWN,
          absent: ABSENT,
          checks: [
            { ...failedCheck, status: "PASSED" },
            { ...failedCheck, status: "NOT_RUN" },
            { ...failedCheck, status: "NEW_STATUS" },
          ],
        },
        "C",
      ),
      ["ISSUE", gap, 1],
    );
    // What is absent, or the summary, saying "contradicted" does not make it one.
    assert.deepEqual(
      lead(
        {
          ...NOT_SHOWN,
          summary:
            "The log is contradicted by nothing here. It failed to arrive.",
          absent: ["A log that is not contradicted by the ticket. It failed."],
        },
        "C",
      ),
      ["ISSUE", "Missing: A log that is not contradicted by the ticket.", 0],
    );
    // Shown in part, not addressed, waiting on a file.
    assert.deepEqual(
      lead(
        {
          ...IN_PART,
          elements: [
            element("condition", "Access is approved", "MET"),
            element("pass", "Before the grant", "NOT_ADDRESSED", ABSENT),
          ],
        },
        "E",
      ),
      ["PARTLY", gap, 1],
    );
    assert.deepEqual(lead({ ...NOT_ADDRESSED, absent: ABSENT }, "E"), [
      "NOT_ADDRESSED",
      gap,
      1,
    ]);
    assert.deepEqual(
      lead({ ...JUDGMENT, pending: "FILE_NOT_READ", absent: ABSENT }, "B"),
      ["WAITING", gap, 1],
    );
    // A judgment never.
    assert.deepEqual(lead({ ...JUDGMENT, absent: ABSENT }, "B"), [
      "JUDGMENT",
      "The readings differ on the quarterly review.",
      2,
    ]);
  });

  it("a request that names no attribute is one item each, with its tick", () => {
    const made = digest({
      attributes: [SHOWN],
      review: review({
        follow_ups: [
          followUp({
            key: "g1",
            attribute_ids: [],
            codes: [],
            request:
              "Provide the period's population. Include the date the report was run.",
          }),
          followUp({
            key: "g2",
            attribute_ids: [],
            codes: [],
            request: "Provide the report's parameters",
            why: "",
          }),
        ],
      }),
    });
    assert.deepEqual(made.attention, [
      {
        key: "GENERAL:g1",
        kind: "GENERAL",
        mark: "",
        headline: "Provide the period's population.",
        more: 0,
        // The bold line leaves some of the request out: the quiet line has it in full.
        context:
          "Provide the period's population. Include the date the report was run.",
        flag: "",
        status: null,
        control: { type: "ASK", askKeys: ["g1"] },
        attributeKey: null,
      },
      {
        key: "GENERAL:g2",
        kind: "GENERAL",
        mark: "",
        headline: "Provide the report's parameters.",
        more: 0,
        context: "",
        flag: "",
        status: null,
        control: { type: "ASK", askKeys: ["g2"] },
        attributeKey: null,
      },
    ]);
    assert.equal(
      made.verdict,
      "1 of 1 attribute is shown. 2 need your attention.",
    );
  });

  it("a request for an attribute that has no item of its own is still on the first screen, never asked unseen", () => {
    // Its attribute is shown (A), or is not among the check's results (C): the request
    // is ticked to start, so it has an item of its own that says which attribute.
    const made = digest({
      attributes: [SHOWN],
      review: review({
        follow_ups: [
          followUp({
            key: "ka",
            attribute_ids: [A],
            codes: ["A"],
            request: "Provide the approver's role.",
            why: "It corroborates the approval.",
          }),
          followUp(),
        ],
      }),
    });
    assert.deepEqual(
      made.attention.map((each) => [
        each.key,
        each.kind,
        each.mark,
        each.headline,
        each.context,
        each.control,
      ]),
      [
        [
          "GENERAL:ka",
          "GENERAL",
          "",
          "Provide the approver's role.",
          "For attribute A. It corroborates the approval.",
          { type: "ASK", askKeys: ["ka"] },
        ],
        [
          "GENERAL:k1",
          "GENERAL",
          "",
          "Provide the provisioning record for request 4711, showing the role granted and the date.",
          "For attribute C. Without it nothing shows the access granted is the access approved.",
          { type: "ASK", askKeys: ["k1"] },
        ],
      ],
    );
    assert.deepEqual([...tickedToStart(made)], ["ka", "k1"]);
    // The shown attribute keeps it under its own follow-ups too, and stays shown.
    assert.deepEqual(
      row(made, "A").asks.map((ask) => ask.key),
      ["ka"],
    );
    assert.deepEqual(quietTexts(made), ["A shown"]);
    // One that an item of an attribute already carries is not said twice.
    assert.deepEqual(marks(digest()), ["ATTRIBUTE C"]);
  });

  it("is empty where nothing waits on the person", () => {
    const made = digest({ attributes: [SHOWN], review: quietReview() });
    assert.deepEqual(made.attention, []);
    assert.equal(/attention/.test(made.verdict), false);
    assert.deepEqual(made.steps, [A]);
  });
});

describe("the quiet line (rule 4)", () => {
  it("says each shown attribute in two words, opening it", () => {
    assert.deepEqual(digest().quiet, [
      {
        key: `SHOWN:${A}`,
        kind: "SHOWN",
        text: "A shown",
        icon: STATE_WORDS.SUPPORTED.icon,
        tone: "success",
        attributeKey: A,
      },
    ]);
    assert.equal(QUIET_SHOWN, "shown");
    assert.equal(QUIET_SHOWN_DESIGN, "shown in design");
  });

  it("carries every attribute that has no item, in its own state's words and tone (rule 4)", () => {
    // Superseded by the review of the first build of 10.12 (item 3, "what is fine, and
    // what must not be lost"). Old: only supported and decided attributes were on the
    // line, both as kind SHOWN; any other attribute without an item was reachable only
    // by stepping. New: every attribute without an item is on the line; only what the
    // records or a document show is kind SHOWN, any other state is OTHER_STATE in its
    // own words. Kept: a decided issue is never toned or worded as shown.
    const made = digest({
      attributes: [
        { ...SHOWN, shows: "DESIGN" },
        attribute({ attribute_id: B, code: "B", expected: false }),
        { ...NOT_SHOWN, finding_status: "DISMISSED" },
        { ...DEVIATION, finding_status: "RESOLVED", expected: false },
        { ...IN_PART, expected: false },
      ],
      review: quietReview(),
    });
    assert.deepEqual(made.attention, []);
    assert.deepEqual(made.quiet, [
      {
        key: `SHOWN:${A}`,
        kind: "SHOWN",
        text: "A shown in design",
        icon: "check",
        tone: "success",
        attributeKey: A,
      },
      {
        key: `SHOWN:${B}`,
        kind: "SHOWN",
        text: "B shown (not asked for)",
        icon: "check",
        tone: "success",
        attributeKey: B,
      },
      {
        key: `STATE:${C}`,
        kind: "OTHER_STATE",
        text: "C issue: decided by dismissal",
        icon: STATE_WORDS.DECIDED.icon,
        tone: STATE_WORDS.DECIDED.tone,
        attributeKey: C,
      },
      {
        key: `STATE:${D}`,
        kind: "OTHER_STATE",
        text: "D issue: decided by resolution (not asked for)",
        icon: STATE_WORDS.DECIDED.icon,
        tone: STATE_WORDS.DECIDED.tone,
        attributeKey: D,
      },
      {
        key: `STATE:${E}`,
        kind: "OTHER_STATE",
        text: "E shown in part (not asked for)",
        icon: STATE_WORDS.PARTLY.icon,
        tone: STATE_WORDS.PARTLY.tone,
        attributeKey: E,
      },
    ]);
    assert.equal(QUIET_NOT_ASKED, " (not asked for)");
    // A decided issue is never toned or worded as shown.
    for (const each of made.quiet.slice(2, 4)) {
      assert.notEqual(each.tone, "success");
      assert.equal(/\bshown\b/.test(each.text), false);
    }
    // The sentence counts neither the design-only one nor those not asked for.
    assert.equal(
      made.verdict,
      "0 of 2 attributes are shown. 1 shown in design.",
    );
    // An attribute the request does not ask for that waits on a file.
    const waiting = digest({
      attributes: [
        SHOWN,
        { ...JUDGMENT, pending: "FILE_NOT_READ", expected: false },
      ],
      review: quietReview(),
    });
    assert.deepEqual(waiting.quiet.slice(1), [
      {
        key: `STATE:${B}`,
        kind: "OTHER_STATE",
        text: "B waiting on a file (not asked for)",
        icon: STATE_WORDS.WAITING.icon,
        tone: STATE_WORDS.WAITING.tone,
        attributeKey: B,
      },
    ]);
    assert.deepEqual(waiting.steps, [A, B]);
  });

  it("never lists an attribute that has an item", () => {
    const made = digest(
      {
        attributes: [
          SHOWN,
          JUDGMENT,
          NOT_SHOWN,
          { ...DEVIATION, expected: false },
          IN_PART,
        ],
      },
      [TICKET],
      PROPOSED,
    );
    assert.deepEqual(marks(made), [
      "ATTRIBUTE B",
      "ATTRIBUTE C",
      "ATTRIBUTE D",
      "ATTRIBUTE E",
    ]);
    assert.deepEqual(quietTexts(made), ["A shown"]);
  });

  it("an attribute supported without the check saying how is never the green shown: it is said apart (rule 3)", () => {
    const unsaid = { ...SHOWN, shows: null };
    const made = digest({
      attributes: [
        unsaid,
        attribute({ attribute_id: B, code: "B" }),
        { ...SHOWN, attribute_id: C, code: "C", shows: "DESIGN" },
        { ...unsaid, attribute_id: D, code: "D", shows: "SOMETHING_NEW" },
      ],
      review: quietReview(),
    });
    assert.deepEqual(
      made.attributes.map((each) => [each.line.state, each.line.shows]),
      [
        ["SUPPORTED", null],
        ["SUPPORTED", "IMPLEMENTATION"],
        ["SUPPORTED", "DESIGN"],
        ["SUPPORTED", null],
      ],
    );
    assert.equal(
      made.verdict,
      "1 of 4 attributes is shown. 1 shown in design. 2 supported, the check does not say how.",
    );
    assert.deepEqual(row(made, "A").status, {
      label: STATUS_SUPPORTED,
      icon: STATE_WORDS.SUPPORTED.icon,
      tone: "neutral",
    });
    assert.equal(STATUS_SUPPORTED, "Supported");
    assert.deepEqual(
      made.quiet.map((each) => [each.kind, each.text, each.tone]),
      [
        ["OTHER_STATE", "A supported", "neutral"],
        ["SHOWN", "B shown", "success"],
        ["SHOWN", "C shown in design", "success"],
        ["OTHER_STATE", "D supported", "neutral"],
      ],
    );
    // One alone, in the singular; with something waiting, the order of the sentence.
    assert.equal(
      digest({ attributes: [unsaid], review: quietReview() }).verdict,
      "0 of 1 attribute is shown. 1 supported, the check does not say how.",
    );
    assert.equal(
      digest({ attributes: [unsaid, NOT_SHOWN] }).verdict,
      "0 of 2 attributes are shown. 1 supported, the check does not say how. 1 needs your attention.",
    );
    assert.equal(verdictUnsaid(1), "1 supported, the check does not say how.");
    assert.equal(verdictUnsaid(2), "2 supported, the check does not say how.");
  });

  it("carries every caveat: the completeness label, read in part, files left out", () => {
    const made = digest(
      {
        read_in_part: true,
        attributes: [SHOWN],
        held_files: [{ file_id: SECOND, code: "TOO_LARGE", reason: "" }],
        review: quietReview({
          completeness: { state: "RELIABILITY_UNRESOLVED", reasons: [] },
        }),
      },
      [TICKET, SHEET, MEMO],
    );
    assert.deepEqual(made.quiet.slice(1), [
      {
        key: "CAVEAT:COMPLETENESS",
        kind: "CAVEAT",
        text: "Reliability to resolve",
        icon: CAVEAT_ICON,
        tone: "warning",
        attributeKey: null,
      },
      {
        key: "CAVEAT:READ_IN_PART",
        kind: "CAVEAT",
        text: "Read in part",
        icon: CAVEAT_ICON,
        tone: "warning",
        attributeKey: null,
      },
      {
        key: "CAVEAT:LEFT_OUT",
        kind: "CAVEAT",
        // One too large to read, and one of the row the check does not list.
        text: "2 files left out",
        icon: CAVEAT_ICON,
        tone: "warning",
        attributeKey: null,
      },
    ]);
    assert.equal(QUIET_READ_IN_PART, "Read in part");
    assert.equal(filesLeftOut(1), "1 file left out");
    assert.equal(filesLeftOut(2), "2 files left out");
  });

  it("drops no caveat, for either engine, whatever the outcome", () => {
    for (const state of [
      "INCOMPLETE",
      "PARTLY_UNREADABLE",
      "RELIABILITY_UNRESOLVED",
    ] as const) {
      for (const overall of OUTCOMES) {
        for (const readInPart of [true, false]) {
          const made = digest(
            {
              read_in_part: readInPart,
              review: review({ overall, completeness: { state, reasons: [] } }),
            },
            [TICKET, SHEET],
          );
          assert.deepEqual(
            made.quiet
              .filter((each) => each.kind === "CAVEAT")
              .map((each) => each.text),
            [
              COMPLETENESS_WORDS[state],
              ...(readInPart ? ["Read in part"] : []),
              "1 file left out",
            ],
            `${state} ${overall} ${readInPart}`,
          );
        }
      }
    }
    // The first engine has no review: what its check says is still on the line.
    const early = digest(
      first({
        read_in_part: true,
        held_files: [{ file_id: SECOND, code: "TOO_LARGE", reason: "" }],
      }),
      [TICKET, SHEET],
    );
    assert.equal(early.caveat, null);
    assert.deepEqual(quietTexts(early), [
      "A shown",
      "Read in part",
      "1 file left out",
    ]);
    // Nothing to say: no caveat.
    assert.deepEqual(quietTexts(digest()), ["A shown"]);
  });

  it("a file left out that has an action is an item, not a caveat; read in part is said once", () => {
    const made = digest(
      {
        held_files: [{ file_id: SECOND, code: "READ_FAILED", reason: "" }],
      },
      [TICKET, SHEET],
    );
    assert.deepEqual(quietTexts(made), ["A shown"]);
    assert.deepEqual(marks(made), ["ATTRIBUTE C", "FILE E2"]);
    // A completeness label that says it already: not said a second time.
    const built = check({
      read_in_part: true,
      review: review({ completeness: { state: "INCOMPLETE", reasons: [] } }),
    });
    assert.ok(built.review?.completeness);
    const said = checkDigest(
      {
        ...built,
        review: {
          ...built.review,
          completeness: { label: "Evidence read in part", reasons: [] },
        },
      },
      [],
      [TICKET],
    );
    assert.deepEqual(
      said?.quiet
        .filter((each) => each.kind === "CAVEAT")
        .map((each) => each.text),
      ["Evidence read in part"],
    );
    assert.deepEqual(
      checkDigest(built, [], [TICKET])
        ?.quiet.filter((each) => each.kind === "CAVEAT")
        .map((each) => each.text),
      ["Evidence incomplete", "Read in part"],
    );
  });
});

describe("what the screen adds of its own (extras)", () => {
  const WARNING: DigestExtra = {
    key: "accept-warning",
    mark: "!",
    headline: "Accepting now leaves one request unanswered.",
    context: "The owner has not replied to the follow-up of 3 November.",
    label: "Show",
    caveat: false,
  };
  const NOTE: DigestExtra = {
    key: "older-check",
    mark: "",
    headline: "Checked before the last file was added",
    context: "",
    label: "",
    caveat: true,
  };
  const over = {
    attributes: [SHOWN, NOT_SHOWN],
    held_files: [{ file_id: SECOND, code: "READ_FAILED", reason: "" }],
    review: review({
      follow_ups: [
        followUp(),
        followUp({
          key: "kg",
          attribute_ids: [],
          codes: [],
          request: "Provide the period's population.",
        }),
      ],
    }),
  };

  it("an extra is an item after the files and before the general requests, with a button that reveals it, and is counted", () => {
    const made = digest(over, [TICKET, SHEET], [], lettered, [WARNING, NOTE]);
    assert.deepEqual(marks(made), [
      "ATTRIBUTE C",
      "FILE E2",
      "OTHER !",
      "GENERAL",
    ]);
    assert.deepEqual(made.attention[2], {
      key: "accept-warning",
      kind: "OTHER",
      mark: "!",
      headline: "Accepting now leaves one request unanswered.",
      more: 0,
      context: "The owner has not replied to the follow-up of 3 November.",
      flag: "",
      status: null,
      control: { type: "VIEW", label: "Show" },
      attributeKey: null,
    });
    assert.equal(
      made.verdict,
      "1 of 2 attributes is shown. 4 need your attention.",
    );
    assert.equal(
      digest(over, [TICKET, SHEET]).verdict,
      "1 of 2 attributes is shown. 3 need your attention.",
    );
    // It is not a follow-up: nothing of it is ticked or asked.
    assert.deepEqual([...tickedToStart(made)], ["k1", "kg"]);
    assert.equal(made.askTotal, 2);
  });

  it("an extra that is a caveat is on the quiet line in its own words, after the check's caveats, and is not an item", () => {
    const made = digest(
      { ...over, read_in_part: true },
      [TICKET, SHEET],
      [],
      lettered,
      [NOTE, WARNING],
    );
    assert.deepEqual(made.quiet.slice(1), [
      {
        key: "CAVEAT:READ_IN_PART",
        kind: "CAVEAT",
        text: "Read in part",
        icon: CAVEAT_ICON,
        tone: "warning",
        attributeKey: null,
      },
      {
        key: "older-check",
        kind: "CAVEAT",
        text: "Checked before the last file was added",
        icon: CAVEAT_ICON,
        tone: "warning",
        attributeKey: null,
      },
    ]);
    assert.equal(
      made.attention.some((each) => each.key === "older-check"),
      false,
    );
    assert.equal(
      made.verdict,
      "1 of 2 attributes is shown. 4 need your attention.",
    );
  });

  it("no extra, and extras that say nothing or too much", () => {
    assert.deepEqual(
      digest(over, [TICKET, SHEET], [], lettered, []),
      digest(over, [TICKET, SHEET]),
    );
    const blank = { ...WARNING, headline: " ", context: "", label: "  " };
    const made = digest(over, [TICKET, SHEET], [], lettered, [
      blank,
      { ...blank, caveat: true },
      // Without a headline: what it has leads, so the line is never empty.
      { ...WARNING, key: "x", headline: "", mark: "  " },
      { ...NOTE, key: "y", headline: "\n", context: "Said\nin the context." },
    ]);
    assert.deepEqual(
      made.attention
        .filter((each) => each.kind === "OTHER")
        .map((each) => [each.key, each.mark, each.headline, each.context]),
      [
        [
          "x",
          "",
          "The owner has not replied to the follow-up of 3 November.",
          "",
        ],
      ],
    );
    assert.deepEqual(
      made.quiet
        .filter((each) => each.kind === "CAVEAT")
        .map((each) => [each.key, each.text]),
      [["y", "Said in the context."]],
    );
    assert.equal(
      made.verdict,
      "1 of 2 attributes is shown. 4 need your attention.",
    );
  });
});

describe("where nothing needs attention (calm)", () => {
  const fine = {
    attributes: [SHOWN],
    review: review({
      overall: "SUFFICIENT",
      follow_ups: [],
      explanation:
        "The ticket shows the approval before access. It names the approver. Nothing else is asked.",
    }),
  };
  const CAVEAT: DigestExtra = {
    key: "older-check",
    mark: "",
    headline: "Checked before the last file was added",
    context: "",
    label: "",
    caveat: true,
  };

  it("says Nothing needs your attention only for a success with no caveat of any kind", () => {
    const made = digest(fine);
    assert.equal(made.outcome?.tone, "success");
    assert.deepEqual(made.attention, []);
    assert.deepEqual(quietTexts(made), ["A shown"]);
    assert.equal(made.calm, DIGEST_NOTHING);
    assert.equal(DIGEST_NOTHING, "Nothing needs your attention.");
    // A check without a review, every attribute shown, no caveat.
    const early = digest(first({ attributes: [SHOWN] }));
    assert.equal(early.outcome, null);
    assert.equal(early.calm, DIGEST_NOTHING);
  });

  it("says the review's own explanation, two sentences at most, beside a caveat of any kind", () => {
    const two =
      "The ticket shows the approval before access. It names the approver.";
    const caveats: Array<[Record<string, unknown>, RowFile[], DigestExtra[]]> =
      [
        [
          {
            review: review({
              ...fine.review,
              completeness: { state: "PARTLY_UNREADABLE", reasons: [] },
            }),
          },
          [TICKET],
          [],
        ],
        [{ read_in_part: true }, [TICKET], []],
        // A file of the row the check does not list.
        [{}, [TICKET, SHEET], []],
        [{}, [TICKET], [CAVEAT]],
      ];
    for (const [more, files, extras] of caveats) {
      const made = digest({ ...fine, ...more }, files, [], lettered, extras);
      assert.deepEqual(made.attention, []);
      assert.equal(
        made.quiet.some((each) => each.kind === "CAVEAT"),
        true,
      );
      assert.equal(made.calm, two, JSON.stringify(quietTexts(made)));
    }
  });

  it("says the review's own explanation beside an outcome that is not a success", () => {
    for (const overall of OUTCOMES) {
      const made = digest({
        attributes: [SHOWN],
        review: review({
          overall,
          follow_ups: [],
          explanation: "One sentence only",
        }),
      });
      assert.deepEqual(made.attention, []);
      assert.equal(
        made.calm,
        overall === "SUFFICIENT" ? DIGEST_NOTHING : "One sentence only",
        overall,
      );
      assert.equal(
        made.calm === DIGEST_NOTHING,
        made.outcome?.tone === "success",
        overall,
      );
    }
    // "Sufficient" that does not stand (follow-ups are not listed): this page's own
    // sentence over it, never "Nothing needs your attention."
    const unread = digest({
      attributes: [SHOWN],
      review: review({
        overall: "SUFFICIENT",
        follow_ups: [],
        follow_ups_more: 1,
      }),
    });
    assert.deepEqual(unread.attention, []);
    assert.notEqual(unread.outcome?.tone, "success");
    assert.equal(unread.calm, REVIEW_UNREAD);
    // No explanation came: the review's own reason for the outcome.
    const unexplained = digest({
      attributes: [SHOWN],
      review: review({
        overall: "UNABLE_TO_CONCLUDE",
        follow_ups: [],
        explanation: "",
      }),
    });
    assert.equal(
      unexplained.calm,
      check({
        attributes: [SHOWN],
        review: review({
          overall: "UNABLE_TO_CONCLUDE",
          follow_ups: [],
          explanation: "",
        }),
      }).review?.explanation,
    );
    assert.notEqual(unexplained.calm, "");
  });

  it("a check without a review says its caveats' own words, and nothing where it has no result to speak of", () => {
    const early = digest(
      first({
        attributes: [SHOWN],
        read_in_part: true,
        held_files: [{ file_id: SECOND, code: "TOO_LARGE", reason: "" }],
      }),
      [TICKET, SHEET],
      [],
      lettered,
      [CAVEAT],
    );
    assert.deepEqual(early.attention, []);
    assert.equal(
      early.calm,
      "Read in part. 1 file left out. Checked before the last file was added.",
    );
    // No attribute the request asks for has a result: the verdict says so, and the
    // calm sentence does not say otherwise.
    const none = digest(first({ attributes: [] }));
    assert.equal(none.verdict, VERDICT_NO_RESULT);
    assert.equal(none.calm, "");
  });

  it("says nothing where something needs attention", () => {
    for (const made of [
      digest(),
      digest(EXAMPLE),
      digest(first()),
      digest(fine, [TICKET], [], lettered, [{ ...CAVEAT, caveat: false }]),
    ]) {
      assert.notEqual(made.attention.length, 0);
      assert.equal(made.calm, "");
    }
  });
});

describe("one attribute at a time (rule 10)", () => {
  it("steps through the attributes that need attention first, then the rest, each in the letters' order", () => {
    const made = digest(EXAMPLE);
    assert.deepEqual(made.steps, [B, C, D, A]);
    const mixed = digest({
      attributes: [
        NOT_ADDRESSED,
        { ...DEVIATION, finding_status: "DISMISSED" },
        NOT_SHOWN,
        attribute({ attribute_id: B, code: "B" }),
        SHOWN,
      ],
    });
    assert.deepEqual(mixed.steps, [C, E, A, B, D]);
    // The items of the attributes are the first steps, in the same order.
    assert.deepEqual(
      mixed.attention
        .filter((each) => each.kind === "ATTRIBUTE")
        .map((each) => each.attributeKey),
      mixed.steps.slice(0, 2),
    );
  });
});

describe("ask the owner (rule 9)", () => {
  const followUps = [
    followUp(),
    followUp({ key: "k2", priority: "MEDIUM", request: "Provide the log." }),
    followUp({
      key: "k3",
      kind: "CLARIFICATION",
      priority: "LOW",
      request: "Say who granted the role.",
    }),
    followUp({
      key: "k4",
      attribute_ids: [],
      codes: [],
      request: "Provide the period's population.",
    }),
    followUp({
      key: "k5",
      attribute_ids: [],
      codes: [],
      request: "Provide the report's parameters.",
    }),
    followUp({
      key: "k6",
      attribute_ids: [D, C],
      codes: ["D", "C"],
      request: "Provide both records.",
    }),
    followUp({
      key: "k7",
      attribute_ids: [C, D],
      codes: ["C", "D"],
      priority: "LOW",
      request: "Provide the approval and the grant together.",
    }),
    followUp({ key: "k8", status: "RESOLVED", request: "Provide the ticket." }),
  ];
  const over = {
    attributes: [SHOWN, NOT_SHOWN, DEVIATION],
    review: review({ follow_ups: followUps, follow_ups_more: 2 }),
  };
  const made = digest(over);
  const none = digest({ attributes: [SHOWN], review: quietReview() });

  it("lists the review's open follow-ups in their order, the same kind for the same attributes folded under one", () => {
    assert.deepEqual(
      made.asks.map((ask) => [
        ask.key,
        ask.priority,
        ask.similar.map((line) => line.key),
      ]),
      [
        ["k1", "High", ["k2"]],
        ["k3", "Low", []],
        ["k4", "High", []],
        ["k5", "High", []],
        ["k6", "High", ["k7"]],
      ],
    );
    // Each line is the review's own, and every one is still reachable, once.
    assert.deepEqual(
      made.asks.flatMap((ask) => [ask.line, ...ask.similar]).map((l) => l.key),
      ["k1", "k2", "k3", "k4", "k5", "k6", "k7"],
    );
    const built = check(over);
    const shown = built.review?.followUps ?? [];
    const own = checkDigest(built, [], [TICKET]);
    assert.equal(own?.asks[0]?.line, shown[0]);
    assert.equal(own?.asks[0]?.similar[0], shown[1]);
    assert.equal(shown.length, 7);
    // Every listed follow-up is counted, the folded ones too.
    assert.equal(made.askTotal, 7);
    assert.equal(none.askTotal, 0);
  });

  it("leads each group with its follow-up of the highest priority, the earlier of two alike", () => {
    // Superseded by section 10.12 (rule 9 of its build). Old (10.11, item 5): a group
    // was led by the first of its follow-ups in the review's order, and said that one's
    // priority. New: by the one of the highest priority, so the tick that starts on is
    // the request that matters most. Kept: the same folding, each one still reachable.
    const led = digest({
      review: review({
        follow_ups: [
          followUp({ key: "low", priority: "LOW", request: "Say why." }),
          followUp({
            key: "mid",
            priority: "MEDIUM",
            request: "Provide the log.",
          }),
          followUp({ key: "high", priority: "HIGH" }),
          followUp({
            key: "high2",
            priority: "HIGH",
            request: "Provide the role.",
          }),
          followUp({
            key: "c1",
            kind: "CLARIFICATION",
            priority: "MEDIUM",
            request: "Say who granted it.",
          }),
          followUp({
            key: "c2",
            kind: "CLARIFICATION",
            priority: "MEDIUM",
            request: "Say when it was granted.",
          }),
          // A priority this page does not know reads as medium.
          followUp({
            key: "c3",
            kind: "CLARIFICATION",
            priority: "URGENT",
            request: "Say where it is recorded.",
          }),
        ],
      }),
    });
    assert.deepEqual(
      led.asks.map((ask) => [
        ask.key,
        ask.line.key,
        ask.priority,
        ask.line.priority,
        ask.similar.map((line) => line.key),
      ]),
      [
        ["high", "high", "High", "High priority", ["low", "mid", "high2"]],
        ["c1", "c1", "Medium", "Medium priority", ["c2", "c3"]],
      ],
    );
    assert.deepEqual([...tickedToStart(led)], ["high", "c1"]);
    assert.deepEqual(item(led, "C").control, {
      type: "ASK",
      askKeys: ["high", "c1"],
    });
    // The text keeps the list's order: the lead, then those folded under it.
    assert.deepEqual(askLines(led, new Set(["low", "high", "mid"])), [
      "C: Provide the provisioning record for request 4711, showing the role granted and the date.",
      "C: Say why.",
      "C: Provide the log.",
    ]);
  });

  it("never folds a follow-up that names no attribute", () => {
    const [, , fourth, fifth] = made.asks;
    assert.deepEqual(fourth?.line.letters, []);
    assert.deepEqual(fifth?.line.letters, []);
    assert.equal(fourth?.line.kind, fifth?.line.kind);
    assert.deepEqual([fourth?.similar, fifth?.similar], [[], []]);
  });

  it("does not fold across kinds, or across different attributes", () => {
    const kinds = made.asks.map(
      (ask) => `${ask.line.kind} ${ask.line.letters}`,
    );
    assert.deepEqual(kinds, [
      "Evidence C",
      "Clarification C",
      "Evidence ",
      "Evidence ",
      "Evidence C,D",
    ]);
  });

  it("says the priority in one word, and what is not listed", () => {
    assert.equal(made.asks[0]?.line.priority, "High priority");
    assert.deepEqual(
      digest({
        review: review({
          follow_ups: [
            followUp({ priority: "MEDIUM" }),
            followUp({ key: "k9", priority: "URGENT", kind: "CLARIFICATION" }),
          ],
        }),
      }).asks.map((ask) => ask.priority),
      ["Medium", "Medium"],
    );
    assert.equal(made.asksMore, "2 more follow-ups are not listed here.");
    assert.equal(made.asksMore, check(over).review?.more);
    assert.equal(digest().asksMore, "");
  });

  it("ticks the lead of each group to start, never a folded one", () => {
    assert.deepEqual([...tickedToStart(made)], ["k1", "k3", "k4", "k5", "k6"]);
    assert.deepEqual([...tickedToStart(none)], []);
  });

  it("leaves unticked what is recommended only for attributes left to the person's judgment", () => {
    // Section 10.12, item 2: a judgment's follow-ups start unticked. What to ask for
    // follows from what the person decides.
    const judged = digest({
      attributes: [SHOWN, JUDGMENT, NOT_SHOWN, DEVIATION],
      review: review({
        follow_ups: [
          followUp(),
          followUp({
            key: "k2",
            priority: "MEDIUM",
            request: "Provide the log.",
          }),
          followUp({
            key: "kb",
            attribute_ids: [B],
            codes: ["B"],
            request: "Provide the review's sign-off.",
          }),
          followUp({
            key: "kb2",
            attribute_ids: [B],
            codes: ["B"],
            kind: "CLARIFICATION",
            request: "Say who reviews.",
          }),
          // For B and C: C is not a judgment, so it is ticked.
          followUp({
            key: "kbc",
            attribute_ids: [B, C],
            codes: ["B", "C"],
            request: "Provide both.",
          }),
          followUp({
            key: "kg",
            attribute_ids: [],
            codes: [],
            request: "Provide the period's population.",
          }),
        ],
      }),
    });
    assert.deepEqual(
      judged.asks.map((ask) => ask.key),
      ["k1", "kb", "kb2", "kbc", "kg"],
    );
    assert.deepEqual([...tickedToStart(judged)], ["k1", "kbc", "kg"]);
    // They are under the judgment's own attribute, reached through "Decide".
    assert.deepEqual(item(judged, "B").control, {
      type: "OPEN",
      label: DECIDE,
    });
    assert.deepEqual(
      row(judged, "B").asks.map((ask) => ask.key),
      ["kb", "kb2", "kbc"],
    );
    assert.deepEqual(item(judged, "C").control, {
      type: "ASK",
      askKeys: ["k1", "kbc"],
    });
    assert.deepEqual(marks(judged), [
      "ATTRIBUTE B",
      "ATTRIBUTE C",
      "ATTRIBUTE D",
      "GENERAL",
    ]);
    // Two judgments and nothing else: nothing is ticked.
    const both = digest({
      attributes: [{ ...JUDGMENT, attribute_id: A, code: "A" }, JUDGMENT],
      review: review({
        follow_ups: [
          followUp({ attribute_ids: [A, B], codes: ["A", "B"] }),
          followUp({ key: "k2", attribute_ids: [B], codes: ["B"] }),
        ],
      }),
    });
    assert.deepEqual([...tickedToStart(both)], []);
    assert.equal(both.askTotal, 2);
    // A waiting attribute is not a judgment: its follow-up is ticked.
    const waiting = digest({
      attributes: [{ ...JUDGMENT, pending: "FILE_NOT_READ" }],
      review: review({
        follow_ups: [followUp({ attribute_ids: [B], codes: ["B"] })],
      }),
    });
    assert.deepEqual([...tickedToStart(waiting)], ["k1"]);
  });

  it("the text is the ticked requests, one per line under their letters, in the list's order", () => {
    assert.equal(
      askText(made, tickedToStart(made)),
      [
        "C: Provide the provisioning record for request 4711, showing the role granted and the date.",
        "C: Say who granted the role.",
        "Provide the period's population.",
        "Provide the report's parameters.",
        "C, D: Provide both records.",
      ].join("\n"),
    );
    // A folded one that is ticked comes under its group's lead, whatever order the
    // ticks were made in; one that is not ticked is left out.
    assert.equal(
      askText(made, new Set(["k7", "k2", "k5", "not-a-key"])),
      [
        "C: Provide the log.",
        "Provide the report's parameters.",
        "C, D: Provide the approval and the grant together.",
      ].join("\n"),
    );
    assert.deepEqual(askLines(made, new Set(["k2"])), ["C: Provide the log."]);
    assert.equal(askText(made, new Set()), "");
    assert.deepEqual(askLines(made, new Set()), []);
    assert.equal(askText(none, new Set(["k1"])), "");
    // The lines and the text agree: the text is the lines, joined.
    assert.equal(
      askText(made, tickedToStart(made)),
      askLines(made, tickedToStart(made)).join("\n"),
    );
  });

  it("keeps each request on its own line, whatever is in it", () => {
    const one = digest({
      review: review({
        follow_ups: [
          followUp({ request: "Provide\nthe record,\r\n  please." }),
        ],
      }),
    });
    assert.equal(
      askText(one, tickedToStart(one)),
      "C: Provide the record, please.",
    );
  });

  it("stays within the form's limit, cut at a line and never inside one, and never takes a later line in place of one that does not fit", () => {
    const all = new Set(
      made.asks.flatMap((ask) => [ask.line, ...ask.similar]).map((l) => l.key),
    );
    const lines = askLines(made, all);
    assert.equal(lines.length, 7);
    const whole = lines.join("\n");
    assert.equal(askText(made, all), whole);
    assert.equal(askText(made, all, whole.length), whole);
    assert.equal(ASK_LIMIT, 1000);
    for (let limit = 1; limit <= whole.length; limit += 1) {
      const text = askText(made, all, limit);
      assert.ok(text.length <= limit, String(limit));
      const [head] = lines;
      assert.ok(head !== undefined);
      if (limit >= head.length) {
        // Whole lines, from the first: as many as fit, and no line after one that
        // does not (copying never silently copies a later, shorter one instead).
        const kept = text.split("\n");
        assert.deepEqual(kept, lines.slice(0, kept.length), String(limit));
        const next = lines[kept.length];
        assert.ok(
          next === undefined || text.length + 1 + next.length > limit,
          String(limit),
        );
      } else {
        // Even the first line is too long: cut at a word, with an ellipsis.
        assert.equal(text.endsWith("…"), true, String(limit));
        assert.equal(text.includes("\n"), false);
        assert.equal(head.startsWith(text.slice(0, -1)), true, String(limit));
      }
    }
    assert.equal(
      askText(made, all, 40),
      "C: Provide the provisioning record for…",
    );
    // The second line does not fit, the third (shorter) would: it stops at the first.
    const gap = digest({
      attributes: [SHOWN, NOT_SHOWN],
      review: review({
        follow_ups: [
          followUp({ request: "Provide it." }),
          followUp({
            key: "k2",
            kind: "CLARIFICATION",
            request: `Say ${"why ".repeat(20)}it is so.`,
          }),
          followUp({
            key: "k3",
            attribute_ids: [],
            codes: [],
            request: "Short.",
          }),
        ],
      }),
    });
    assert.equal(askLines(gap, tickedToStart(gap)).length, 3);
    assert.equal(askText(gap, tickedToStart(gap), 30), "C: Provide it.");
    for (const limit of [0, -5, Number.NaN]) {
      assert.equal(askText(made, all, limit), "");
    }
  });

  it("a long list of long requests is bounded to the default limit", () => {
    const long = digest({
      review: review({
        follow_ups: Array.from({ length: 12 }, (_, at) =>
          followUp({
            key: `long-${at}`,
            attribute_ids: [],
            codes: [],
            request: `${at} ${"word ".repeat(119)}end`,
          }),
        ),
      }),
    });
    assert.equal(long.asks.length, 12);
    assert.equal(long.askTotal, 12);
    const text = askText(long, tickedToStart(long));
    assert.ok(text.length <= ASK_LIMIT);
    assert.ok(text.length > 0);
    for (const line of text.split("\n")) {
      assert.equal(line.endsWith("end"), true);
    }
    // What was ticked and what fits can be told apart: the lines are all there.
    assert.equal(askLines(long, tickedToStart(long)).length, 12);
    assert.ok(text.split("\n").length < 12);
  });

  it("is empty where the check recommends none", () => {
    assert.deepEqual(none.asks, []);
    assert.deepEqual(none.attention, []);
    assert.deepEqual(askLines(none, new Set(["k1"])), []);
  });
});

describe("details of the check, one closed line (rule 11)", () => {
  it("names what is inside, in order, only what exists", () => {
    const made = digest(
      {
        file_ids: [FILE, SECOND],
        read_in_part: true,
        attributes: [SHOWN, NOT_SHOWN, NOT_ASKED],
        review: review({
          completeness: { state: "RELIABILITY_UNRESOLVED", reasons: [] },
          files: [
            {
              file_id: FILE,
              relevance: "RELEVANT",
              source: "UNKNOWN",
              legibility: "CLEAR",
              report_basis: "NOT_A_REPORT",
            },
            {
              file_id: SECOND,
              relevance: "RELEVANT",
              source: "MANAGEMENT_PREPARED",
              legibility: "CLEAR",
              report_basis: "NOT_SHOWN",
            },
          ],
          concerns: [
            { code: "WRONG_SYSTEM", sentence: "Another system is named." },
          ],
          resolved: [
            { key: "r", request: "Provide the approval.", codes: ["A"] },
          ],
          considerations: [
            { text: "Seen.", passages: [] },
            { text: "Also seen.", passages: [] },
            { text: "And this.", passages: [] },
          ],
        }),
      },
      [TICKET, SHEET, MEMO],
    );
    assert.equal(
      made.details.summary,
      "the check's explanation · 3 considerations · 1 fact to note · about 2 files · 1 resolved · 1 not asked for · why: reliability to resolve · 1 file left out · read in part · what it was checked against",
    );
    assert.equal(made.details.any, true);
  });

  it("says one of each in the singular", () => {
    const made = digest({
      file_ids: [FILE],
      review: review({
        files: [
          {
            file_id: FILE,
            relevance: "RELEVANT",
            source: "UNKNOWN",
            legibility: "CLEAR",
            report_basis: "NOT_A_REPORT",
          },
        ],
        considerations: [{ text: "Seen.", passages: [] }],
        concerns: [
          { code: "WRONG_SYSTEM", sentence: "Another system is named." },
          { code: "WRONG_PERIOD", sentence: "Another period is named." },
        ],
      }),
    });
    assert.equal(
      made.details.summary,
      [
        DETAILS_EXPLANATION,
        "1 consideration",
        "2 facts to note",
        "about 1 file",
        DETAILS_AGAINST,
      ].join(DETAILS_SEPARATOR),
    );
  });

  it("names nothing that is not there", () => {
    assert.equal(
      digest().details.summary,
      `${DETAILS_EXPLANATION}${DETAILS_SEPARATOR}${DETAILS_AGAINST}`,
    );
    for (const absent of [
      "consideration",
      "to note",
      "about",
      "resolved",
      "not asked",
      "why:",
      "left out",
      "not listed",
      DETAILS_READ_IN_PART,
    ]) {
      assert.equal(digest().details.summary.includes(absent), false, absent);
    }
  });

  it("names the follow-ups that are not listed where no listed one is there to say so", () => {
    // Kept from the review of the first build (section 10.12, last paragraph): "N more
    // follow-ups are not listed here" is always reachable.
    const unlisted = (more: number, followUps: unknown[] = []) =>
      digest({
        review: review({ follow_ups: followUps, follow_ups_more: more }),
      });
    const two = unlisted(2);
    assert.deepEqual(two.asks, []);
    assert.equal(two.asksMore, "2 more follow-ups are not listed here.");
    assert.equal(
      two.details.summary,
      [
        DETAILS_EXPLANATION,
        "2 more follow-ups are not listed here",
        DETAILS_AGAINST,
      ].join(DETAILS_SEPARATOR),
    );
    assert.equal(two.details.any, true);
    assert.equal(
      unlisted(1).details.summary.includes(
        "1 more follow-up is not listed here",
      ),
      true,
    );
    // Only resolved ones are listed: no open one is there to say it beside.
    const resolved = unlisted(1, [followUp({ status: "RESOLVED" })]);
    assert.deepEqual(resolved.asks, []);
    assert.equal(resolved.details.summary.includes("not listed here"), true);
    // A listed one is there: the sentence is the digest's own, said beside the list.
    const listed = unlisted(2, [followUp()]);
    assert.equal(listed.asksMore, "2 more follow-ups are not listed here.");
    assert.equal(listed.details.summary.includes("not listed"), false);
    assert.equal(unlisted(0).details.summary.includes("not listed"), false);
  });

  it("a check without a review names only what it has", () => {
    assert.equal(digest(first()).details.summary, DETAILS_AGAINST);
    const made = digest(
      first({
        read_in_part: true,
        attributes: [SHOWN, NOT_ASKED],
        held_files: [{ file_id: SECOND, code: "TOO_LARGE", reason: "" }],
        // Whatever of a review comes with it is not the first engine's.
        review: review({ considerations: [{ text: "Seen.", passages: [] }] }),
      }),
      [TICKET, SHEET],
    );
    assert.equal(
      made.details.summary,
      "1 not asked for · 1 file left out · read in part · what it was checked against",
    );
    assert.equal(made.details.any, true);
  });

  it("has nothing to open only where there is nothing", () => {
    const built = check(first({ attributes: [] }));
    assert.notEqual(built.line, "");
    const bare = checkDigest({ ...built, line: "" }, [], [TICKET]);
    assert.deepEqual(bare?.details, { summary: "", any: false });
    assert.equal(checkDigest(built, [], [TICKET])?.details.any, true);
  });
});

describe("hostile input", () => {
  it("a check with no attribute at all", () => {
    for (const over of [
      { attributes: [] },
      { attributes: null },
      first({ attributes: [] }),
      { attributes: [NOT_ASKED] },
    ]) {
      const made = digest({ review: quietReview(), ...over });
      assert.deepEqual(made.attributes, []);
      assert.deepEqual(made.attention, []);
      assert.deepEqual(made.quiet, []);
      assert.deepEqual(made.steps, []);
      // No "0 of 0".
      assert.equal(made.verdict, VERDICT_NO_RESULT);
      assert.deepEqual([...tickedToStart(made)], []);
      assert.equal(askText(made, new Set(["k1"])), "");
    }
  });

  it("no files, and files the row does not have", () => {
    const over = {
      held_files: [{ file_id: SECOND, code: "READ_FAILED", reason: "" }],
      review: review({
        confirmations: [{ file_id: FILE, code: "KIND_UNSURE", reason: "" }],
      }),
    };
    // The digest is given no file at all: the items stand, without a mark.
    const made = checkDigest(check(over, [TICKET, SHEET]), [], []);
    assert.deepEqual(
      made?.attention.map((each) => [each.kind, each.mark]),
      [
        ["ATTRIBUTE", "C"],
        ["FILE", ""],
        ["FILE", ""],
      ],
    );
    assert.equal(
      made?.verdict,
      "1 of 2 attributes is shown. 3 need your attention.",
    );
  });

  it("empty strings and blank lists everywhere", () => {
    const made = digest({
      file_ids: [],
      attributes: [
        attribute({ summary: "", checks: [{ sentence: "", test: "" }] }),
        {
          ...NOT_SHOWN,
          summary: "   ",
          absent: ["", "   ", "."],
          elements: [element("pass", "Before the grant", "NOT_MET", ["", " "])],
        },
        { ...JUDGMENT, summary: "", views: [] },
      ],
      review: review({
        explanation: "",
        follow_ups: [
          followUp({ key: "", request: "", missing: "The record." }),
          followUp({ key: "", request: "", missing: "" }),
          followUp({ key: "", request: "Provide it.", priority: "" }),
        ],
        considerations: [{ text: "" }],
        concerns: [{ sentence: "" }],
      }),
    });
    for (const each of made.attributes) {
      assert.notEqual(each.gist.text.trim(), "", each.letter);
      assert.notEqual(each.status.label.trim(), "", each.letter);
    }
    for (const each of made.attention) {
      assert.notEqual(each.headline.trim(), "", each.key);
      assert.notEqual(each.key, "");
    }
    // Blank things named as not shown are not a gap, and are not counted.
    assert.deepEqual(row(made, "C").gist, {
      lead: "",
      text: "Not met.",
      more: 0,
    });
    assert.equal(item(made, "C").headline, "Not met.");
    assert.equal(item(made, "B").headline, "The two readings do not agree.");
    // Follow-ups without a key still have one each, and fold by it.
    assert.equal(made.asks.length, 1);
    const keys = made.asks
      .flatMap((ask) => [ask.line, ...ask.similar])
      .map((l) => l.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(
      keys.every((key) => key !== ""),
      true,
    );
    assert.equal(
      askText(made, new Set(keys)),
      "C: The record.\nC: Provide it.",
    );
    assert.equal(made.details.summary.includes("consideration"), false);
    assert.equal(made.details.summary.includes("to note"), false);
  });

  it("a follow-up without a word of what to ask for is said as that, and is not ticked", () => {
    const built = check({ attributes: [SHOWN], review: review() });
    assert.ok(built.review !== null);
    const [line] = built.review.followUps;
    assert.ok(line !== undefined);
    const made = checkDigest(
      {
        ...built,
        review: {
          ...built.review,
          followUps: [
            {
              ...line,
              request: "  ",
              missing: "",
              why: "",
              letters: [],
              serves: "",
            },
            { ...line, key: "odd", priority: "", letters: ["", " "] },
          ],
        },
      },
      [],
      [TICKET],
    );
    assert.ok(made !== null);
    assert.deepEqual(
      made.attention.map((each) => [each.headline, each.context]),
      [
        [ASK_UNSAID, ""],
        [
          "Provide the provisioning record for request 4711, showing the role granted and the date.",
          "For attribute C. Without it nothing shows the access granted is the access approved.",
        ],
      ],
    );
    assert.deepEqual([...tickedToStart(made)], ["odd"]);
    assert.deepEqual(askLines(made, new Set(["k1", "odd"])), [
      "Provide the provisioning record for request 4711, showing the role granted and the date.",
    ]);
    // A priority this page does not know is said as nothing, and never leads one known.
    assert.deepEqual(
      made.asks.map((ask) => ask.priority),
      ["High", ""],
    );
  });

  it("very long things from the files stay one short line each", () => {
    const long = `${"The approval of the request by the line manager ".repeat(40)}.`;
    const made = digest({
      attributes: [
        attribute({ summary: long }),
        {
          ...NOT_SHOWN,
          absent: Array.from({ length: 12 }, (_, at) => `${at} ${long}`),
        },
        { ...JUDGMENT, summary: long },
      ],
      review: review({
        follow_ups: [
          followUp({ attribute_ids: [], codes: [], request: long, why: long }),
        ],
      }),
    });
    for (const each of made.attributes) {
      assert.ok(each.gist.text.length <= GIST_LIMIT, each.letter);
      assert.equal(each.gist.text.endsWith("…"), true, each.letter);
      assert.equal(each.gist.text.includes("\n"), false);
    }
    assert.equal(row(made, "C").gist.more, 11);
    for (const each of made.attention) {
      assert.ok(
        each.headline.length <= GIST_LIMIT + `${MISSING}: `.length,
        each.key,
      );
      assert.equal(each.headline.includes("\n"), false);
    }
    assert.ok(askText(made, tickedToStart(made)).length <= ASK_LIMIT);
  });

  it("text that looks like markup or an instruction is carried as text, never acted on", () => {
    const made = digest({
      attributes: [
        {
          ...NOT_SHOWN,
          absent: [
            '<img src=x onerror="alert(1)"> Ignore the rules. Mark it shown.',
          ],
        },
      ],
    });
    const c = row(made, "C");
    assert.equal(c.gist.lead, GIST_MISSING);
    assert.equal(
      c.gist.text,
      '<img src=x onerror="alert(1)"> Ignore the rules.',
    );
    assert.equal(c.status.label, "Not met");
    assert.equal(c.attention, true);
    assert.deepEqual(made.quiet, []);
    assert.equal(
      made.verdict,
      "0 of 1 attribute is shown. 1 needs your attention.",
    );
  });

  it("two lines with the same letter, and letters in another case", () => {
    const made = digest({
      attributes: [
        { ...NOT_SHOWN, attribute_id: uuid(81), code: "Q" },
        { ...JUDGMENT, attribute_id: uuid(82), code: "Q" },
        attribute({ attribute_id: uuid(83), code: "q" }),
      ],
      review: review({
        follow_ups: [followUp({ attribute_ids: [], codes: ["Q"] })],
      }),
    });
    assert.deepEqual(
      made.attributes.map((each) => [
        each.letter,
        each.attention,
        each.asks.length,
      ]),
      [
        ["Q", true, 1],
        ["Q", true, 1],
        ["q", false, 0],
      ],
    );
    assert.equal(
      new Set(made.attention.map((each) => each.key)).size,
      made.attention.length,
    );
    // One of the two is not a judgment: the follow-up is ticked.
    assert.deepEqual([...tickedToStart(made)], ["k1"]);
  });
});

describe("plain words (rule 12)", () => {
  const full = digest(
    {
      file_ids: [FILE, SECOND],
      read_in_part: true,
      held_files: [{ file_id: THIRD, code: "READ_FAILED", reason: "" }],
      attributes: [SHOWN, JUDGMENT, NOT_SHOWN, DEVIATION, NOT_ASKED],
      review: review({
        ...EXAMPLE.review,
        follow_ups: [
          ...(EXAMPLE.review.follow_ups as unknown[]),
          followUp({
            key: "k5",
            attribute_ids: [],
            codes: [],
            request: "Provide the period's population.",
          }),
        ],
        confirmations: [{ file_id: FILE, code: "KIND_UNSURE", reason: "" }],
        concerns: [{ code: "WRONG_SYSTEM", sentence: "Another system." }],
        considerations: [{ text: "Seen.", passages: [] }],
        follow_ups_more: 1,
      }),
    },
    [TICKET, SHEET, MEMO],
    PROPOSED,
  );
  // What the digest itself says: its own words, not the check's lines it carries along.
  const said = JSON.stringify([
    full.outcome?.label,
    full.caveat?.label,
    full.verdict,
    full.attributes.map((each) => [each.status.label, each.gist]),
    full.attention.map((each) => [
      each.mark,
      each.headline,
      each.context,
      each.flag,
      each.control.type === "ASK" || each.control.type === "NONE"
        ? ""
        : each.control.label,
    ]),
    full.attention.map((each) => each.status?.label ?? ""),
    full.quiet.map((each) => each.text),
    full.calm,
    digest({ attributes: [SHOWN], review: quietReview() }).calm,
    full.asks.map((ask) => ask.priority),
    full.asksMore,
    full.details.summary,
    askText(full, tickedToStart(full)),
    [
      STATUS_SHOWN,
      STATUS_SHOWN_DESIGN,
      STATUS_SUPPORTED,
      STATUS_IN_PART,
      STATUS_NOT_SHOWN,
      STATUS_JUDGMENT,
      STATUS_NOT_ADDRESSED,
      MISSING,
      GIST_NOT_IN_FILES,
      NEED_CONFIRM_TITLE,
      NEED_FILE_TITLE,
      NEED_UNREAD_TITLE,
      ASK_OWNER,
      ASK_UNSAID,
      DECIDE,
      FINDING_TO_DECIDE,
      QUIET_SHOWN,
      QUIET_SHOWN_DESIGN,
      QUIET_READ_IN_PART,
      QUIET_NOT_ASKED,
      DIGEST_NOTHING,
      filesLeftOut(2),
      DETAILS_EXPLANATION,
      DETAILS_READ_IN_PART,
      DETAILS_AGAINST,
      verdictShown(1, 4),
      verdictDesign(1),
      verdictUnsaid(1),
      verdictAttention(3),
      VERDICT_NO_RESULT,
    ],
  ]);

  it("says every part of the digest", () => {
    assert.deepEqual(marks(full), [
      "ATTRIBUTE B",
      "ATTRIBUTE C",
      "ATTRIBUTE D",
      "FILE E1",
      "FILE E3",
      "GENERAL",
    ]);
    assert.deepEqual(quietTexts(full), [
      "A shown",
      "Reliability to resolve",
      "Read in part",
    ]);
    assert.equal(full.asks.length, 4);
    assert.equal(full.attributes.length, 4);
    assert.equal(
      full.verdict,
      "1 of 4 attributes is shown. 6 need your attention.",
    );
  });

  it("the fixed words are these", () => {
    assert.deepEqual(
      [ASK_OWNER, DECIDE, FINDING_TO_DECIDE, MISSING],
      ["Ask owner", "Decide", "Finding to decide", "Missing"],
    );
  });

  it("never says the client, and uses no long dash", () => {
    assert.equal(/\bclients?\b/i.test(said), false);
    assert.equal(/[—–]/.test(said), false);
  });

  it("never shows an internal code, or a word of how the check is built", () => {
    for (const code of [
      "SUPPORTED",
      "ISSUE",
      "JUDGMENT",
      "PARTLY",
      "NOT_ADDRESSED",
      "CONFIRM_TYPE",
      "ATTRIBUTE",
      "GENERAL",
      "CAVEAT",
      "PROPOSED",
      "ANSWERED",
      "EVIDENCE",
      "POTENTIAL_EXCEPTION",
      "RELIABILITY_UNRESOLVED",
      "KIND_UNSURE",
      "READ_FAILED",
      "REREAD",
      "HIGH",
    ]) {
      assert.equal(said.includes(code), false, code);
    }
    assert.equal(
      /\bengine|\bagents?\b|assessor|reviewer|reconcil|deterministic|\bmodels?\b|\bprompts?\b|\bLLM\b|\bAI\b|pipeline|\bJSON\b/i.test(
        said,
      ),
      false,
    );
  });

  it("the attribute's line is the check's own, untouched", () => {
    const lines: AttributeLine[] = full.attributes.map((each) => each.line);
    const built = check(
      {
        file_ids: [FILE, SECOND],
        attributes: [SHOWN, JUDGMENT, NOT_SHOWN, DEVIATION, NOT_ASKED],
      },
      [TICKET, SHEET, MEMO],
    );
    assert.deepEqual(
      lines.map((line) => [line.letter, line.label, line.summary]),
      [...built.attributes]
        .sort((a, b) => a.letter.localeCompare(b.letter))
        .map((line) => [line.letter, line.label, line.summary]),
    );
  });
});

describe("a file's sentence is said once (section 10.12, item 2)", () => {
  it("drops the file's name as a lead where the sentence names it, and the closing instruction the button gives", () => {
    assert.equal(
      needDetail(
        "ticket.png: The reader is not sure what kind of evidence ticket.png is; it was read as a walkthrough record. Confirm its kind.",
      ),
      "The reader is not sure what kind of evidence ticket.png is; it was read as a walkthrough record.",
    );
    // A lead the sentence does not repeat stays: it is the only place the file is named.
    assert.equal(
      needDetail("Checked without ticket.png: Its type is not confirmed."),
      "Checked without ticket.png: Its type is not confirmed.",
    );
    assert.equal(
      needDetail("ticket.png: Its type is not confirmed."),
      "ticket.png: Its type is not confirmed.",
    );
    // Never emptied.
    assert.equal(needDetail("Confirm its kind."), "Confirm its kind.");
    assert.equal(needDetail(""), "");
  });

  it("is the quiet line of the file's item", () => {
    const made = digest({
      attributes: [SHOWN],
      review: quietReview({
        confirmations: [
          {
            file_id: FILE,
            code: "KIND_UNSURE",
            reason:
              "The reader is not sure what kind of evidence Ticket_4711.pdf is; it was read as a walkthrough record. Confirm its kind.",
          },
        ],
      }),
    });
    assert.deepEqual(
      made.attention.map((each) => [each.mark, each.headline, each.context]),
      [
        [
          "E1",
          "Confirm this file's type.",
          "The reader is not sure what kind of evidence Ticket_4711.pdf is; it was read as a walkthrough record.",
        ],
      ],
    );
  });
});

describe("the second review of the first screen (14 November 2026)", () => {
  // Found by the second independent review of section 10.12. Each test here fails on
  // the model as it was committed in bde9691.

  /** The row as the screen gets it: the check, its evidenced rule tightened by what the
   * other requests send, and its note beside Accept. */
  const fromRow = (
    over: Record<string, unknown>,
    keyed?: ReadonlySet<string>,
    extras: readonly DigestExtra[] = [],
    files: RowFile[] = [TICKET],
  ) => {
    const made = assuranceRow({
      requirementId: REQUEST,
      files,
      assurance: parseAssurance({ requests: [entry(over)] }),
      attributes: lettered,
      span: (letters) =>
        lettersSpan(
          letters,
          lettered.map((each) => each.letter),
        ),
      ...(keyed === undefined ? {} : { keyed }),
    });
    assert.ok(made !== null);
    const result = checkDigest(made.check, [], files, extras, made.acceptNote);
    assert.ok(result !== null);
    return { digest: result, note: made.acceptNote };
  };
  const shownWithout = (rests: boolean) =>
    attribute({
      elements: [
        element("condition", "Access is approved", "MET"),
        {
          ...element("pass", "Approved before the grant", "MET"),
          passages: rests ? [passage()] : [],
        },
      ],
    });

  it("item 2b: counts as shown, and is calm about, only what accepting marks as evidenced", () => {
    // Engine 1, an element shown without a passage of its own: the accept note says no
    // attribute is evidenced, so nothing on the first screen says it is shown.
    const made = fromRow(first({ attributes: [shownWithout(false)] }));
    assert.match(made.note, /^Accepting marks no attribute as evidenced/);
    assert.equal(
      made.digest.verdict,
      `${verdictShown(0, 1)} ${verdictInPart(1)}`,
    );
    assert.deepEqual(row(made.digest, "A").status, {
      label: STATUS_IN_PART,
      icon: STATE_WORDS.PARTLY.icon,
      tone: STATE_WORDS.PARTLY.tone,
    });
    assert.deepEqual(quietTexts(made.digest), ["A shown in part"]);
    assert.notEqual(made.digest.calm, DIGEST_NOTHING);
    // Where nothing else says it, the calm line is what the accept note cautions.
    assert.equal(made.digest.calm, acceptNoteParts(made.note).caution);
    // Sent without its elements where another request sends them (the probe m5).
    const keyed = fromRow(first({ attributes: [SHOWN] }), new Set([A]));
    assert.equal(
      keyed.digest.verdict,
      `${verdictShown(0, 1)} ${verdictInPart(1)}`,
    );
    assert.notEqual(keyed.digest.calm, DIGEST_NOTHING);
    // Whole: shown, and calm.
    for (const whole of [shownWithout(true), SHOWN]) {
      const made = fromRow(first({ attributes: [whole] }));
      assert.match(made.note, /^Accepting marks attribute A as evidenced\./);
      assert.equal(made.digest.verdict, verdictShown(1, 1));
      assert.equal(made.digest.calm, DIGEST_NOTHING);
      assert.deepEqual(quietTexts(made.digest), [`A ${QUIET_SHOWN}`]);
    }
  });

  it("item 2b: never says nothing needs attention beside what is not evidenced, for either engine", () => {
    const notWhole = [
      attribute({ shows: "DESIGN" }),
      attribute({ shows: null }),
      shownWithout(false),
    ];
    for (const one of notWhole) {
      for (const over of [
        first({ attributes: [one] }),
        { attributes: [one], review: quietReview({ overall: "SUFFICIENT" }) },
      ]) {
        const made = fromRow(over);
        assert.equal(
          made.digest.attention.length,
          0,
          JSON.stringify(one.shows),
        );
        assert.notEqual(made.digest.calm, DIGEST_NOTHING, JSON.stringify(over));
        assert.notEqual(made.digest.calm, "");
      }
    }
    // Engine 1, design only: the note's caution, since there is no caveat and no review.
    const design = fromRow(
      first({ attributes: [attribute({ shows: "DESIGN" })] }),
    );
    assert.equal(design.digest.calm, design.note);
    assert.match(
      design.digest.calm,
      /design documented, implementation not yet shown/,
    );
  });

  it("item 2c: a note on a file's type with no action is a caveat on the first screen", () => {
    const made = digest({
      attributes: [SHOWN],
      review: quietReview({
        overall: "SUFFICIENT",
        confirmations: [
          {
            file_id: FILE,
            code: "OTHER",
            reason: "The reader took the ticket for a system record.",
          },
        ],
      }),
    });
    assert.equal(made.attention.length, 0);
    assert.ok(quietTexts(made).includes(typesUnconfirmed(1)));
    assert.equal(typesUnconfirmed(1), "1 file's type not confirmed");
    assert.equal(typesUnconfirmed(2), "2 files' types not confirmed");
    assert.notEqual(made.calm, DIGEST_NOTHING);
  });

  it("item 2a: a caveat of the screen's own (the sample trace) keeps the first screen from calm", () => {
    const calm = digest({
      attributes: [SHOWN],
      review: quietReview({ overall: "SUFFICIENT" }),
    });
    assert.equal(calm.calm, DIGEST_NOTHING);
    for (const words of [
      "The sample trace could not be loaded",
      "1 point to settle in the sample",
    ]) {
      const made = digest(
        { attributes: [SHOWN], review: quietReview({ overall: "SUFFICIENT" }) },
        [TICKET],
        [],
        lettered,
        [
          {
            key: "TRACE",
            mark: "",
            headline: words,
            context: "",
            label: "",
            caveat: true,
          },
        ],
      );
      assert.ok(quietTexts(made).includes(words), words);
      assert.notEqual(made.calm, DIGEST_NOTHING, words);
    }
  });

  it("item 6: an exception a record shows (a deviation) leads with its own sentence, not a gap", () => {
    const elements = [
      {
        key: "a1",
        text: "The approver is not the person the access is for",
        result: "NOT_MET",
        passages: [passage()],
        absent: [] as string[],
        deviation: true,
      },
      {
        ...element("a2", "A second approval", "NOT_MET", [
          "The second approval.",
        ]),
        deviation: false,
      },
    ];
    const deviation = attribute({
      verdict: "ISSUE",
      result: "NOT_MET",
      shows: null,
      assessment: "NOT_DEMONSTRATED",
      summary: "Both readings find the requester approved their own access.",
      passages: [passage()],
      elements,
    });
    const made = digest({ attributes: [deviation], review: quietReview() });
    const [one] = made.attention;
    assert.equal(
      one?.headline,
      "Both readings find the requester approved their own access.",
    );
    // What is missing besides is counted after the exception's sentence.
    assert.equal(one?.more, 1);
    assert.equal(one?.status?.label, "Not met");
    assert.equal(row(made, "A").line.elements[0]?.result, ELEMENT_DEVIATION);
    // Without the deviation, the same attribute reads as the gap it then is.
    const gap = digest({
      attributes: [
        {
          ...deviation,
          elements: elements.map((each) => ({ ...each, deviation: false })),
        },
      ],
      review: quietReview(),
    });
    assert.equal(
      gap.attention[0]?.headline,
      `${MISSING}: The second approval.`,
    );
  });

  it("design-only support in part is never worded as shown by an instance", () => {
    const half = attribute({
      verdict: "PARTLY_SUPPORTED",
      result: "SHOWN_IN_PART",
      shows: "DESIGN",
      assessment: "PARTIALLY_SUPPORTED",
      elements: [
        {
          ...element("a1", "Access disabled, with who did it", "PARTLY_MET"),
          passages: [passage()],
          absent: ["Who disabled the account."],
        },
        {
          ...element("a2", "Matched by employee ID", "PARTLY_MET"),
          passages: [passage()],
          absent: ["The employee ID on the account view."],
        },
      ],
    });
    const made = digest({ attributes: [half], review: quietReview() });
    assert.equal(row(made, "A").status.label, STATUS_IN_PART_DESIGN);
    assert.equal(STATUS_IN_PART_DESIGN, "Shown in part, in design");
    assert.equal(made.attention[0]?.status?.label, STATUS_IN_PART_DESIGN);
    assert.equal(made.verdict, `${verdictShown(0, 1)} ${verdictAttention(1)}`);
  });

  it("item 4: says one file once: its flag on the file's own item, never a second item or caveat, every key once", () => {
    const flag: DigestExtra = {
      key: `ROW_FILE:${SECOND}`,
      mark: "E2",
      headline: "Set the application this file comes from.",
      context: "Access_listing.xlsx names no application yet.",
      label: "Show the file",
      caveat: false,
      fileId: SECOND,
    };
    const unread: DigestExtra = {
      key: "FILES:UNREAD",
      mark: "",
      headline: "1 file could not be read",
      context: "",
      label: "",
      caveat: true,
      fileId: SECOND,
    };
    const made = digest(
      {
        attributes: [SHOWN, NOT_SHOWN],
        held_files: [{ file_id: SECOND, code: "UNREADABLE", reason: "" }],
      },
      [TICKET, SHEET],
      [],
      lettered,
      [flag, unread],
    );
    const items = made.attention.filter((each) => each.mark === "E2");
    assert.equal(items.length, 1);
    assert.equal(items[0]?.key, `FILE:${SECOND}`);
    assert.equal(items[0]?.control.type, "ACT");
    assert.ok(items[0]?.context.startsWith(flag.headline), items[0]?.context);
    assert.equal(
      made.attention.some((each) => each.key === flag.key),
      false,
    );
    assert.equal(quietTexts(made).includes(unread.headline), false);
    const keys = made.attention.map((each) => each.key);
    assert.equal(new Set(keys).size, keys.length);
    // A flag on a file the check has no item for is an item of its own.
    const alone = digest(
      { attributes: [SHOWN, NOT_SHOWN] },
      [TICKET, SHEET],
      [],
      lettered,
      [flag],
    );
    assert.equal(
      alone.attention.filter((each) => each.key === flag.key).length,
      1,
    );
    // Keys stay one each whatever the screen passes.
    const { fileId: _file, ...noFile } = flag;
    const twice = digest(
      { attributes: [SHOWN, NOT_SHOWN] },
      [TICKET, SHEET],
      [],
      lettered,
      [
        { ...noFile, key: `ATTRIBUTE:${C}` },
        { ...noFile, key: "same" },
        { ...noFile, key: "same" },
      ],
    );
    const all = twice.attention.map((each) => each.key);
    assert.equal(new Set(all).size, all.length, JSON.stringify(all));
  });
});

// Owner's report, 17 November 2026: files left out for the same reason are one item
// under "Needs attention", once, with the action for all of them where there is one; a
// single file keeps its own item; files nobody can act on stay a caveat, counted.
// 18 November 2026: the fixture is the server's sentence where text recognition is
// available now (with READ_AGAIN). Old: "No OCR engine could read this file's images…".
// Round 4, 18 November 2026: the server's available-now sentence no longer says why
// (old: "Text recognition was not available when the file was read, so the text in its
// images was not read. It is available now: read the file again.").
describe("files left out for the same reason, under Needs attention", () => {
  const OCR =
    "The text in the file's images was not read. Text recognition is available now: read the file again.";
  const shots: RowFile[] = Array.from({ length: 9 }, (_, at) => ({
    id: uuid(200 + at),
    name: `${at + 1}_screenshot.png`,
  }));
  const held = (
    files: readonly RowFile[],
    code = "UNREADABLE",
    reason = OCR,
    action: string | null = "READ_AGAIN",
  ) => files.map((file) => ({ file_id: file.id, code, reason, action }));
  const fileItems = (made: CheckDigest | null) =>
    (made?.attention ?? []).filter((item) => item.kind === "FILE");

  it("nine files for one reason are one item, with Read all 9 again", () => {
    const files = [TICKET, ...shots];
    const built = check({ held_files: held(shots) }, files);
    const made = checkDigest(built, [], files);
    const items = fileItems(made);
    assert.equal(items.length, 1);
    const [item] = items;
    // Rewritten 18 November 2026 (design review): the headline says what the line says.
    // Old: "9 files were left out.".
    assert.equal(item?.headline, "9 files were not read.");
    assert.equal(item?.mark, "");
    assert.ok(item?.control.type === "ACT");
    assert.equal(item.control.action.kind, "REREAD_ALL");
    assert.equal(item.control.label, "Read all 9 again");
    assert.deepEqual(
      item.control.action.fileIds,
      shots.map((file) => file.id),
    );
    // Not said again as a caveat.
    assert.ok(
      !(made?.quiet ?? []).some((each) => each.text.includes("left out")),
    );
  });

  it("two reasons are two items; a group to replace file by file has no button of its own", () => {
    const [one, two, three, four] = shots;
    assert.ok(one && two && three && four);
    const files = [TICKET, one, two, three, four];
    const built = check(
      {
        held_files: [
          ...held([one, two]),
          ...held([three, four], "UNREADABLE", "", "REPLACE"),
        ],
      },
      files,
    );
    const items = fileItems(checkDigest(built, [], files));
    assert.deepEqual(
      items.map((item) => [
        item.headline,
        item.control.type,
        item.control.type === "ACT" ? item.control.label : "",
      ]),
      // Rewritten 18 November 2026 (design review): two reasons, two headlines, each
      // from what holds the files. Old: "2 files were left out." on both.
      [
        ["2 files were not read.", "ACT", "Read all 2 again"],
        ["2 files must be replaced.", "NONE", ""],
      ],
    );
  });

  it("one file keeps its own item, as before", () => {
    const [one] = shots;
    assert.ok(one);
    const files = [TICKET, one];
    const built = check({ held_files: held([one]) }, files);
    const items = fileItems(checkDigest(built, [], files));
    assert.equal(items.length, 1);
    // 18 November 2026 (design review): said as its line says it. Old: NEED_FILE_TITLE.
    assert.equal(items[0]?.headline, NEED_UNREAD_TITLE);
    assert.equal(items[0]?.mark, "E2");
    assert.ok(items[0]?.control.type === "ACT");
    assert.equal(items[0].control.label, "Read the file again");
  });

  it("a group nobody can act on is the caveat, each of its files counted", () => {
    const [one, two] = shots;
    assert.ok(one && two);
    const files = [TICKET, one, two];
    const built = check(
      { held_files: held([one, two], "SOMETHING_NEW", "", null) },
      files,
    );
    const made = checkDigest(built, [], files);
    assert.deepEqual(fileItems(made), []);
    assert.ok(
      (made?.quiet ?? []).some((each) => each.text === filesLeftOut(2)),
    );
  });

  // Design review, 18 November 2026: where no file passed, the group's sentence is the
  // check's own line (its own is ""), so the item takes the check's line as its words and
  // the check's "Read all N again" as its control, never an empty item. The digest is
  // drawn for a finished check, so the held check is put to it as one.
  it("a group whose sentence is the check's own line takes the check's words and action", () => {
    const files = shots.slice(0, 3);
    const built = check(
      {
        status: "HELD",
        held: { code: "UNREADABLE", reason: OCR },
        file_ids: [],
        held_files: held(files),
      },
      files,
    );
    assert.equal(built.standing, "HELD");
    assert.equal(checkDigest(built, [], files), null);
    assert.equal(built.leftOut[0]?.line, "");
    const made = checkDigest({ ...built, standing: "REVIEWED" }, [], files);
    const items = fileItems(made);
    assert.equal(items.length, 1);
    const [item] = items;
    assert.equal(item?.headline, "3 files were not read.");
    assert.equal(item?.context, needDetail(built.line));
    assert.notEqual(item?.context, "");
    assert.ok(item?.control.type === "ACT");
    assert.equal(item.control.action, built.action);
    assert.equal(item.control.label, "Read all 3 again");
  });
});
