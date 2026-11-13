import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  COVERAGE_UNREAD,
  type EvidenceInput,
  evidenceList,
  lettersSpan,
  type Requirement,
} from "../apps/web/src/design-evidence-model.ts";
import {
  type AssuredRequest,
  acceptNote,
  assuranceCounts,
  assurancePill,
  assuranceProblem,
  assuranceRow,
  assuranceSentence,
  assuranceWrite,
  attributeCoverage,
  checkPollDelay,
  DESIGN_ONLY,
  type EvidenceAssurance,
  elementWords,
  issueDecided,
  keyedOf,
  NOT_CHECKED_LINE,
  NOT_LISTED,
  offeredAction,
  parseAssurance,
  READ_IN_PART,
  READINGS_DISAGREE,
  RESULT_UNREAD,
  type RowFile,
  requestCheck,
  rereadProblem,
  resultWords,
  SAME_INSTANCE,
  STATE_WORDS,
  STILL_CHECKING,
} from "../apps/web/src/evidence-assurance-model.ts";
import { dialogWrite } from "../apps/web/src/evidence-dialog-model.ts";
import { parseFindings } from "../apps/web/src/evidence-findings-model.ts";
import type { RequirementFile } from "../apps/web/src/evidence-plan-model.ts";

// The evidence assurance chain on the D&I list (docs/evidence-assurance.md, sections 6
// and 7; product owner, 12 November 2026: "no room for error ... before providing
// feedback to the user, another agent should review whether that result is accurate").
// One run per request: its in-force files are read together, as one walkthrough. The
// page reads what the server decided and words it. Three errors matter, in order: a
// false "supported", a false issue, and a file or attribute skipped without saying so.
// D&I needs the design and its implementation: an attribute is evidenced only where the
// records of an instance show it.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C, D, E] = [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)] as const;
const [POLICY, WALK] = [uuid(11), uuid(12)] as const;
const REQUEST = uuid(21);
const [FILE, SECOND, THIRD] = [uuid(31), uuid(32), uuid(33)] as const;
const FINDING = uuid(41);
const [ORG, PROJECT, CONTROL] = [uuid(51), uuid(52), uuid(53)] as const;
const ANALYSIS = uuid(61);
const NOW = Date.parse("2026-11-14T12:00:00Z");

const lettered = [A, B, C, D, E].map((id, at) => ({
  id,
  letter: "ABCDE".charAt(at),
  text: `Attribute ${at + 1} wording.`,
}));
const ALL = lettered.map((item) => item.letter);
const span = (letters: readonly string[]) => lettersSpan(letters, ALL);

const POLICY_FILE: RowFile = { id: FILE, name: "Access_Procedure_v3.pdf" };
const TICKET: RowFile = { id: SECOND, name: "Ticket_4711.pdf" };
const LOG: RowFile = { id: THIRD, name: "Change_log.xlsx" };

// A passage's location as the server sends it (evidence_assurance._where):
// {label, page, sheet, row, column, cell}. Before the review these tests used
// {location: "…", page}, a shape the server never sends.
const passage = (fileId: string | null = FILE) => ({
  quote: "approved by the line manager",
  ...(fileId === null ? {} : { file_id: fileId }),
  location: {
    label: "Page 3",
    page: 3,
    sheet: null,
    row: null,
    column: null,
    cell: null,
  },
});

/** One attribute as the API sends it: by default supported, by the records of an
 * instance (`shows: IMPLEMENTATION`). */
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
    ...over,
  };
}

/** One request's entry as the API sends it. */
function entry(over: Record<string, unknown> = {}) {
  return {
    requirement_id: POLICY,
    run_id: uuid(62),
    status: "REVIEWED",
    stage: "DONE",
    held: null,
    held_files: [],
    file_ids: [FILE],
    lens: "INSTANCE_RECORD",
    read_in_part: false,
    attributes: [attribute()],
    out_of_date: [],
    finished_at: "2026-11-14T10:00:00Z",
    ...over,
  };
}

function parsed(requests: unknown[], summary: unknown = undefined) {
  const read = parseAssurance({
    requests,
    ...(summary === undefined ? {} : { summary }),
  });
  assert.ok(read !== null);
  return read;
}

const only = (read: EvidenceAssurance): AssuredRequest => {
  const [request] = read.requests;
  assert.ok(request !== undefined);
  return request;
};

const ISSUE = attribute({
  attribute_id: B,
  code: "B",
  verdict: "ISSUE",
  result: "NOT_MET",
  shows: null,
  summary: "Nothing shows the approval comes before the grant.",
  passages: [],
  absent: ["A step requiring approval before provisioning"],
  finding_id: FINDING,
  finding_status: "PROPOSED",
});
const UNSETTLED = attribute({
  attribute_id: C,
  code: "C",
  verdict: "UNSETTLED",
  result: null,
  shows: null,
  summary: "The readings differ on the quarterly review.",
  passages: [],
  views: [
    { role: "ASSESSOR", result: "MET", reason: "Section 4 sets the review." },
    {
      role: "REVIEWER",
      result: "NOT_MET",
      reason: "Section 4 names no reviewer.",
    },
  ],
});
/** An attribute the request does not link: both readings find the evidence does not
 * bear on it. */
const NOT_ASKED = attribute({
  attribute_id: D,
  code: "D",
  expected: false,
  verdict: "NOT_ADDRESSED",
  result: "NOT_ADDRESSED",
  shows: null,
  summary: "The request does not ask for attribute D.",
  passages: [],
  views: [
    { role: "ASSESSOR", result: "NOT_ADDRESSED", reason: "No termination." },
    { role: "REVIEWER", result: "NOT_ADDRESSED", reason: "Not in the files." },
  ],
});

/** One element of an attribute as the API sends it. */
const element = (
  key: string,
  text: string,
  result: string | null,
  rests = result === "MET",
) => ({
  key,
  text,
  result,
  passages: rests ? [passage()] : [],
  absent: result === "NOT_MET" ? "No record of the approval" : "",
});

/** Attribute A shown in part by this request: its approval is shown, its timing is
 * left to other requests. */
const IN_PART = attribute({
  verdict: "PARTLY_SUPPORTED",
  result: "SHOWN_IN_PART",
  summary: "This request shows the approval; the timing is for another.",
  elements: [
    element("condition", "Access is approved by the line manager", "MET"),
    element("pass", "The approval comes before the grant", "NOT_ADDRESSED"),
  ],
});

describe("parseAssurance (section 6)", () => {
  it("reads a finished check with its files, attributes, passages and summary", () => {
    const read = parsed([entry({ read_in_part: true })], {
      checking: 0,
      held: 0,
      failed: 0,
      out_of_date: 0,
      supported: 1,
      issues: 0,
      unsettled: 0,
    });
    const request = only(read);
    assert.equal(request.requirementId, POLICY);
    assert.equal(request.status, "REVIEWED");
    assert.equal(request.stage, "DONE");
    assert.equal(request.held, null);
    assert.deepEqual(request.heldFiles, []);
    assert.deepEqual(request.fileIds, [FILE]);
    assert.equal(request.lens, "INSTANCE_RECORD");
    assert.equal(request.readInPart, true);
    assert.equal(request.note, "");
    assert.equal(request.finishedAt, "2026-11-14T10:00:00Z");
    assert.deepEqual(request.attributes[0], {
      attributeId: A,
      code: "A",
      expected: true,
      verdict: "SUPPORTED",
      understood: true,
      result: "MET",
      shows: "IMPLEMENTATION",
      elements: [],
      summary: "The ticket shows line-manager approval before access.",
      passages: [
        {
          quote: "approved by the line manager",
          fileId: FILE,
          location: "Page 3",
          page: 3,
        },
      ],
      absent: [],
      views: [],
      findingId: null,
      findingStatus: null,
    });
    assert.deepEqual(read.summary, {
      checking: 0,
      held: 0,
      failed: 0,
      outOfDate: 0,
      supported: 1,
      issues: 0,
      unsettled: 0,
    });
  });

  it("is null for a body that is not the answer, and keeps one entry per request", () => {
    assert.equal(parseAssurance(null), null);
    assert.equal(parseAssurance({ nope: true }), null);
    assert.equal(parseAssurance({ requests: "x" }), null);
    // The per-file shape of before is not this answer.
    assert.equal(parseAssurance({ files: [entry()] }), null);
    const read = parsed([
      entry({ requirement_id: "not-a-uuid" }),
      { ...entry(), requirement_id: undefined },
      "text",
      null,
      entry(),
      entry({ status: "FAILED" }),
      entry({ requirement_id: WALK }),
    ]);
    assert.deepEqual(
      read.requests.map((item) => [item.requirementId, item.status]),
      [
        [POLICY, "REVIEWED"],
        [WALK, "REVIEWED"],
      ],
    );
  });

  it("reads a status it does not know as still being checked: nothing of it shows", () => {
    for (const status of ["DONE", "PASSED", "", null, undefined, 7]) {
      const request = only(parsed([entry({ status })]));
      assert.equal(request.status, "CHECKING", String(status));
      assert.deepEqual(request.attributes, [], String(status));
    }
    const bare = only(parsed([{ requirement_id: POLICY }]));
    assert.equal(bare.status, "CHECKING");
    assert.equal(bare.stage, null);
    assert.equal(bare.lens, null);
    assert.equal(bare.readInPart, false);
    assert.equal(bare.held, null);
    assert.deepEqual(bare.heldFiles, []);
    assert.deepEqual(bare.fileIds, []);
    assert.deepEqual(bare.attributes, []);
    assert.deepEqual(bare.outOfDate, []);
    assert.equal(bare.finishedAt, null);
  });

  it("reads a request with files and no check yet as not checked", () => {
    const request = only(parsed([entry({ status: "NOT_CHECKED" })]));
    assert.equal(request.status, "NOT_CHECKED");
    assert.deepEqual(request.attributes, []);
  });

  it("shows nothing of a run that is not finished and current", () => {
    for (const status of [
      "NOT_CHECKED",
      "QUEUED",
      "CHECKING",
      "HELD",
      "FAILED",
      "OUT_OF_DATE",
    ]) {
      const request = only(parsed([entry({ status })]));
      assert.equal(request.status, status);
      assert.deepEqual(request.attributes, [], status);
    }
    const stale = only(
      parsed([entry({ out_of_date: ["Attribute B's wording changed."] })]),
    );
    assert.equal(stale.status, "OUT_OF_DATE");
    assert.deepEqual(stale.attributes, []);
    assert.deepEqual(stale.outOfDate, ["Attribute B's wording changed."]);
  });

  it("reads a failed check's note, and only a failed one's", () => {
    assert.equal(
      only(parsed([entry({ status: "FAILED", note: "  The budget ran out." })]))
        .note,
      "The budget ran out.",
    );
    assert.equal(
      only(parsed([entry({ status: "FAILED", note: "x".repeat(400) })])).note
        .length,
      300,
    );
    assert.equal(only(parsed([entry({ status: "FAILED", note: 7 })])).note, "");
    assert.equal(only(parsed([entry({ note: "Not failed." })])).note, "");
  });

  it("keeps the gate's code and sentence only for a held request", () => {
    for (const code of [
      "KIND_UNSURE",
      "TOO_LARGE",
      "NO_ATTRIBUTES",
      "READ_FAILED",
    ]) {
      assert.deepEqual(
        only(
          parsed([entry({ status: "HELD", held: { code, reason: "Why." } })]),
        ).held,
        { code, reason: "Why." },
      );
    }
    for (const said of [{ code: "NEW_GATE", reason: "x" }, null, "x", {}]) {
      assert.equal(
        only(parsed([entry({ status: "HELD", held: said })])).held?.code,
        "OTHER",
      );
    }
    assert.equal(
      only(parsed([entry({ held: { code: "CUSTODY", reason: "x" } })])).held,
      null,
    );
  });

  it("reads the files left out, and the files the readings included", () => {
    const request = only(
      parsed([
        entry({
          file_ids: [FILE, SECOND, FILE, "x", 3],
          held_files: [
            { file_id: THIRD, code: "KIND_UNSURE", reason: "Type unsure." },
            { file_id: THIRD, code: "CUSTODY", reason: "dup" },
            { file_id: uuid(34), code: "SOMETHING_NEW" },
            { file_id: uuid(35), code: "READ_FAILED", reason: "" },
            { file_id: "x", code: "CUSTODY" },
            "text",
          ],
        }),
      ]),
    );
    assert.deepEqual(request.fileIds, [FILE, SECOND]);
    assert.deepEqual(request.heldFiles, [
      { fileId: THIRD, code: "KIND_UNSURE", reason: "Type unsure." },
      { fileId: uuid(34), code: "OTHER", reason: "" },
      { fileId: uuid(35), code: "READ_FAILED", reason: "" },
    ]);
  });

  it("never reads an unknown verdict as supported: it is the person's judgment", () => {
    for (const verdict of ["MET", "OK", "supported", "", null, undefined, 1]) {
      const [read] = only(
        parsed([entry({ attributes: [attribute({ verdict })] })]),
      ).attributes;
      assert.equal(read?.verdict, "UNSETTLED", String(verdict));
      assert.equal(read?.understood, false, String(verdict));
      assert.equal(read?.result, null, String(verdict));
      assert.equal(read?.shows, null, String(verdict));
    }
  });

  it("does not show support that came without what support needs", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["no agreed result", { result: null }],
      ["a result other than met", { result: "PARTLY_MET" }],
      ["a result this page does not know", { result: "FINE" }],
      ["no passage", { passages: [] }],
      ["passages that hold no words", { passages: [{ quote: "  " }, 3] }],
      ["no passages field", { passages: undefined }],
    ];
    for (const [name, over] of cases) {
      const [read] = only(
        parsed([entry({ attributes: [attribute(over)] })]),
      ).attributes;
      assert.equal(read?.verdict, "UNSETTLED", name);
      assert.equal(read?.understood, false, name);
    }
  });

  it("reads what supported evidence shows, and nothing for anything else", () => {
    const shows = (over: Record<string, unknown>) =>
      only(parsed([entry({ attributes: [attribute(over)] })])).attributes[0]
        ?.shows;
    assert.equal(shows({ shows: "IMPLEMENTATION" }), "IMPLEMENTATION");
    assert.equal(shows({ shows: "DESIGN" }), "DESIGN");
    for (const said of ["implementation", "BOTH", null, undefined, 1]) {
      assert.equal(shows({ shows: said }), null, String(said));
    }
    // Only support says what it shows.
    assert.equal(
      only(parsed([entry({ attributes: [{ ...ISSUE, shows: "DESIGN" }] })]))
        .attributes[0]?.shows,
      null,
    );
  });

  it("keeps an issue an issue, and leaves a self-contradicting one to the person", () => {
    for (const result of [
      "NOT_MET",
      "PARTLY_MET",
      "CONTRADICTED",
      "NOT_ADDRESSED",
      null,
    ]) {
      const [read] = only(
        parsed([entry({ attributes: [{ ...ISSUE, result }] })]),
      ).attributes;
      assert.equal(read?.verdict, "ISSUE", String(result));
      assert.equal(read?.findingId, FINDING);
    }
    const [odd] = only(
      parsed([entry({ attributes: [{ ...ISSUE, result: "BROKEN" }] })]),
    ).attributes;
    assert.equal(odd?.verdict, "ISSUE");
    assert.equal(odd?.result, null);
    for (const verdict of ["ISSUE", "NOT_ADDRESSED"]) {
      const [read] = only(
        parsed([entry({ attributes: [{ ...ISSUE, verdict, result: "MET" }] })]),
      ).attributes;
      assert.equal(read?.verdict, "UNSETTLED", verdict);
      assert.equal(read?.understood, false, verdict);
      assert.equal(read?.findingId, null, verdict);
    }
  });

  it("reads an issue's finding status, and treats one it does not know as open", () => {
    const status = (finding_status: unknown) => {
      const [read] = only(
        parsed([entry({ attributes: [{ ...ISSUE, finding_status }] })]),
      ).attributes;
      assert.ok(read !== undefined);
      return [read.findingStatus, issueDecided(read)];
    };
    for (const closed of [
      "DISMISSED",
      "RESOLVED",
      "CLARIFICATION_ACCEPTED",
      "NOT_APPLICABLE",
    ]) {
      assert.deepEqual(status(closed), [closed, true], closed);
    }
    for (const open of ["PROPOSED", "ACCEPTED", "SENT", "MORE_NEEDED"]) {
      assert.deepEqual(status(open), [open, false], open);
    }
    for (const unknown of ["CLOSED", null, undefined, 3]) {
      assert.deepEqual(status(unknown), [null, false], String(unknown));
    }
    // No finding, no status.
    assert.equal(
      only(
        parsed([
          entry({
            attributes: [
              { ...ISSUE, finding_id: null, finding_status: "DISMISSED" },
            ],
          }),
        ]),
      ).attributes[0]?.findingStatus,
      null,
    );
  });

  it("keeps one answer per attribute", () => {
    const request = only(
      parsed([
        entry({
          attributes: [
            attribute(),
            { ...ISSUE, attribute_id: A, code: "A" },
            attribute({ attribute_id: null, code: "F" }),
            attribute({ attribute_id: null, code: "F", verdict: "ISSUE" }),
          ],
        }),
      ]),
    );
    assert.deepEqual(
      request.attributes.map((item) => [item.code, item.verdict]),
      [
        ["A", "SUPPORTED"],
        ["F", "SUPPORTED"],
      ],
    );
  });

  it("reads both views where the readings do not agree and where the request does not ask, a finding only for an issue", () => {
    const request = only(
      parsed([
        entry({
          attributes: [
            attribute({
              views: [{ role: "ASSESSOR", result: "MET", reason: "x" }],
              finding_id: FINDING,
            }),
            UNSETTLED,
            NOT_ASKED,
            {
              ...UNSETTLED,
              attribute_id: E,
              code: "E",
              finding_id: FINDING,
              views: [
                { role: "JUDGE", result: "MET", reason: "x" },
                { role: "REVIEWER", result: "SURE", reason: "" },
              ],
            },
          ],
        }),
      ]),
    );
    assert.deepEqual(request.attributes[0]?.views, []);
    assert.equal(request.attributes[0]?.findingId, null);
    assert.deepEqual(request.attributes[1]?.views, [
      { role: "ASSESSOR", result: "MET", reason: "Section 4 sets the review." },
      {
        role: "REVIEWER",
        result: "NOT_MET",
        reason: "Section 4 names no reviewer.",
      },
    ]);
    assert.deepEqual(request.attributes[2]?.views, [
      { role: "ASSESSOR", result: "NOT_ADDRESSED", reason: "No termination." },
      {
        role: "REVIEWER",
        result: "NOT_ADDRESSED",
        reason: "Not in the files.",
      },
    ]);
    assert.deepEqual(request.attributes[3]?.views, [
      { role: "REVIEWER", result: null, reason: "" },
    ]);
    assert.equal(request.attributes[3]?.findingId, null);
  });

  it("keeps both readings on an issue only where each reading sent one: a split shortfall (the D&I evidence wizard, 13 November 2026)", () => {
    // The server sends ISSUE PARTLY_MET with both views where one reading finds the
    // attribute not met and the other met in part (docs/evidence-assurance.md, rule 4).
    const split = {
      ...ISSUE,
      result: "PARTLY_MET",
      views: [
        { role: "ASSESSOR", result: "NOT_MET", reason: "No approval at all." },
        {
          role: "REVIEWER",
          result: "PARTLY_MET",
          reason: "Approved, but after the grant.",
        },
      ],
    };
    const request = only(
      parsed([
        entry({
          attributes: [
            split,
            // One view, or the same reading twice, is not both readings.
            {
              ...split,
              attribute_id: C,
              code: "C",
              views: [split.views[0]],
            },
            {
              ...split,
              attribute_id: D,
              code: "D",
              views: [split.views[0], split.views[0]],
            },
          ],
        }),
      ]),
    );
    assert.equal(request.attributes[0]?.verdict, "ISSUE");
    assert.deepEqual(
      request.attributes[0]?.views.map((view) => [view.role, view.result]),
      [
        ["ASSESSOR", "NOT_MET"],
        ["REVIEWER", "PARTLY_MET"],
      ],
    );
    assert.deepEqual(request.attributes[1]?.views, []);
    assert.deepEqual(request.attributes[2]?.views, []);
    // The row shows them side by side, under the issue.
    const check = requestCheck(request, lettered, [POLICY_FILE], span);
    assert.deepEqual(
      check.attributes.find((line) => line.letter === "B")?.readings,
      [
        {
          who: "First reading",
          result: "Not shown",
          reason: "No approval at all.",
        },
        {
          who: "Second, independent reading",
          result: "Shown in part",
          reason: "Approved, but after the grant.",
        },
      ],
    );
  });

  it("shows the server's location label as it is, and composes one from the parts without it", () => {
    const where = (location: unknown) =>
      only(
        parsed([
          entry({
            attributes: [
              attribute({
                passages: [{ quote: "q", file_id: FILE, location }],
              }),
            ],
          }),
        ]),
      ).attributes[0]?.passages[0];
    const parts = {
      label: null,
      page: null,
      sheet: null,
      row: null,
      column: null,
      cell: null,
    };
    // The label wins, however the parts read.
    assert.deepEqual(where({ ...parts, label: "Image 2" }), {
      quote: "q",
      fileId: FILE,
      location: "Image 2",
      page: null,
    });
    assert.deepEqual(where({ ...parts, label: "Page 3", page: 3 }), {
      quote: "q",
      fileId: FILE,
      location: "Page 3",
      page: 3,
    });
    assert.equal(
      where({
        label: "Sheet Users, row 4, column B",
        sheet: "Elsewhere",
        row: 9,
        column: "Z",
        cell: "Z9",
      })?.location,
      "Sheet Users, row 4, column B",
    );
    // Without a label, the parts.
    assert.equal(where({ ...parts, page: 3 })?.location, "Page 3");
    assert.equal(
      where({ ...parts, sheet: "Users", row: 4, column: "B", cell: "B5" })
        ?.location,
      "Sheet Users, row 4, column B",
    );
    assert.equal(
      where({ ...parts, sheet: "Users", cell: "B5" })?.location,
      "Sheet Users, cell B5",
    );
    assert.equal(where({ ...parts, label: "   " })?.location, "");
    // The old guess at the shape ({location: "…"}) is not the server's: not read.
    assert.equal(where({ location: "Page 2", page: 2 })?.location, "Page 2");
    assert.equal(where({ location: "Section 9" })?.location, "");
    assert.equal(where("Section 4")?.location, "Section 4");
    for (const nothing of [
      null,
      undefined,
      3,
      {},
      { page: 0 },
      { page: "3" },
    ]) {
      assert.deepEqual(
        [where(nothing)?.location, where(nothing)?.page],
        ["", null],
      );
    }
    // A passage that names no file: the request's one file, else not known.
    const unnamed = (fileIds: string[]) =>
      only(
        parsed([
          entry({
            file_ids: fileIds,
            attributes: [attribute({ passages: [passage(null)] })],
          }),
        ]),
      ).attributes[0]?.passages[0]?.fileId;
    assert.equal(unnamed([FILE]), FILE);
    assert.equal(unnamed([FILE, SECOND]), null);
    assert.equal(unnamed([]), null);
  });

  it("drops an attribute that names neither an id nor a letter, and keeps one with a letter", () => {
    const request = only(
      parsed([
        entry({
          attributes: [
            attribute({ attribute_id: null, code: "" }),
            attribute({ attribute_id: "x", code: "B" }),
            "text",
          ],
        }),
      ]),
    );
    assert.deepEqual(
      request.attributes.map((item) => [item.attributeId, item.code]),
      [["", "B"]],
    );
  });

  it("takes each count of the summary only when it is a whole number", () => {
    const good = {
      checking: 1,
      held: 2,
      failed: 3,
      out_of_date: 4,
      supported: 5,
      issues: 6,
      unsettled: 7,
    };
    assert.deepEqual(parsed([], good).summary, {
      checking: 1,
      held: 2,
      failed: 3,
      outOfDate: 4,
      supported: 5,
      issues: 6,
      unsettled: 7,
    });
    const odd = parsed([], {
      ...good,
      issues: "6",
      held: -1,
      failed: 1.5,
    }).summary;
    assert.deepEqual(
      [odd?.issues, odd?.held, odd?.failed, odd?.unsettled],
      [null, null, null, 7],
    );
    for (const bad of [undefined, null, "x", [1]]) {
      assert.equal(parsed([], bad).summary, null);
    }
  });
});

describe("a request's check, in every status", () => {
  const check = (over: Record<string, unknown>, files = [POLICY_FILE]) =>
    requestCheck(only(parsed([entry(over)])), lettered, files, span);

  it("not checked yet: one line and Check now, the request's", () => {
    const view = check({ status: "NOT_CHECKED" });
    assert.equal(view.standing, "NOT_CHECKED");
    assert.equal(view.line, NOT_CHECKED_LINE);
    assert.equal(view.line, "Not checked against the attributes yet");
    assert.deepEqual(view.action, {
      kind: "RERUN",
      label: "Check now",
      fileId: null,
    });
    assert.deepEqual(view.attributes, []);
    assert.deepEqual(view.leftOut, []);
  });

  it("is one quiet working line naming the letters being checked", () => {
    const queued = check({ status: "QUEUED", stage: "GATE" });
    assert.equal(queued.standing, "CHECKING");
    assert.equal(queued.line, "Waiting to check against attributes A to E");
    assert.equal(queued.stage, "");
    assert.equal(queued.action, null);
    const working = check({ status: "CHECKING", stage: "VERIFY" });
    assert.equal(working.line, "Checking against attributes A to E");
    assert.equal(working.stage, "second, independent reading");
    assert.equal(
      check({ status: "CHECKING", stage: "ASSESS" }).stage,
      "first reading",
    );
    assert.equal(
      check({ status: "CHECKING", stage: "COMPARE" }).stage,
      "comparing the two readings",
    );
    assert.equal(check({ status: "CHECKING", stage: "???" }).stage, "");
    assert.deepEqual(working.attributes, []);
    assert.equal(working.readInPart, null);
    const request = only(parsed([entry({ status: "CHECKING" })]));
    assert.equal(
      requestCheck(request, lettered.slice(0, 1), [POLICY_FILE], span).line,
      "Checking against attribute A",
    );
    assert.equal(
      requestCheck(request, [], [POLICY_FILE], span).line,
      "Checking against the attributes",
    );
  });

  it("held: the reason and the single action that clears it, on the request's file", () => {
    const held = (code: string, reason = "", files = [POLICY_FILE]) =>
      check({ status: "HELD", held: { code, reason } }, files);
    assert.deepEqual(held("KIND_UNSURE").action, {
      kind: "CONFIRM_TYPE",
      label: "Confirm the file's type",
      fileId: FILE,
    });
    for (const code of ["UNREADABLE", "CUSTODY"]) {
      assert.deepEqual(held(code).action, {
        kind: "REPLACE",
        label: "Replace the file",
        fileId: FILE,
      });
    }
    assert.deepEqual(held("POPULATION").action, {
      kind: "PICK_INSTANCE",
      label: "Pick the walkthrough instance",
      fileId: FILE,
    });
    for (const code of ["TOO_LARGE", "NO_ATTRIBUTES", "SOMETHING_NEW"]) {
      assert.equal(held(code).action, null, code);
    }
    assert.equal(held("KIND_UNSURE", "", [POLICY_FILE, TICKET]).action, null);
    for (const code of [
      "KIND_UNSURE",
      "UNREADABLE",
      "CUSTODY",
      "READ_FAILED",
      "POPULATION",
      "NO_ATTRIBUTES",
      "TOO_LARGE",
      "SOMETHING_NEW",
    ]) {
      const view = held(code);
      assert.equal(view.standing, "HELD");
      assert.deepEqual(view.attributes, []);
      assert.match(view.line, /^[A-Z].*\.$/);
      assert.ok(!view.line.includes(code), code);
    }
    assert.equal(
      held("TOO_LARGE", "The four files together exceed one reading").line,
      "The four files together exceed one reading.",
    );
  });

  it("a reading that failed is read again, never replaced", () => {
    // Before the review there was no READ_FAILED: the file would have been held as
    // UNREADABLE and offered "Replace the file".
    assert.deepEqual(
      check({
        status: "HELD",
        held: { code: "READ_FAILED", reason: "The reader timed out." },
      }).action,
      { kind: "REREAD", label: "Read the file again", fileId: FILE },
    );
    assert.equal(
      check({
        status: "HELD",
        held: { code: "READ_FAILED", reason: "The reader timed out" },
      }).line,
      "The reader timed out.",
    );
    const view = check(
      {
        file_ids: [FILE],
        held_files: [{ file_id: THIRD, code: "READ_FAILED", reason: "" }],
      },
      [POLICY_FILE, LOG],
    );
    assert.deepEqual(view.leftOut, [
      {
        fileId: THIRD,
        line: "Checked without Change_log.xlsx: Reading it did not finish.",
        action: { kind: "REREAD", label: "Read the file again", fileId: THIRD },
      },
    ]);
  });

  it("held because of named files: each file's own line carries its action", () => {
    const view = check(
      {
        status: "HELD",
        held: { code: "KIND_UNSURE", reason: "" },
        file_ids: [],
        held_files: [
          { file_id: FILE, code: "KIND_UNSURE", reason: "" },
          { file_id: SECOND, code: "UNREADABLE", reason: "" },
        ],
      },
      [POLICY_FILE, TICKET],
    );
    assert.equal(view.action, null);
    assert.deepEqual(
      view.leftOut.map((item) => [
        item.line,
        item.action?.kind,
        item.action?.fileId,
      ]),
      [
        [
          "Left out of the check, Access_Procedure_v3.pdf: Its type is not confirmed.",
          "CONFIRM_TYPE",
          FILE,
        ],
        [
          "Left out of the check, Ticket_4711.pdf: Nothing readable could be taken from it.",
          "REPLACE",
          SECOND,
        ],
      ],
    );
  });

  it("failed and out of date: one line and Check again, the request's", () => {
    const failed = check({ status: "FAILED" });
    assert.equal(failed.standing, "FAILED");
    assert.equal(
      failed.line,
      "The check did not finish, so nothing of it is shown.",
    );
    assert.deepEqual(failed.action, {
      kind: "RERUN",
      label: "Check again",
      fileId: null,
    });
    const stale = check({
      status: "OUT_OF_DATE",
      out_of_date: ["Attribute B's wording changed"],
    });
    assert.equal(stale.standing, "OUT_OF_DATE");
    assert.equal(
      stale.line,
      "The check is out of date, so its results are not shown. Attribute B's wording changed.",
    );
    assert.deepEqual(stale.action?.kind, "RERUN");
    assert.deepEqual(stale.attributes, []);
  });

  it("a failed check shows the server's note", () => {
    assert.equal(
      check({
        status: "FAILED",
        note: "The engagement's model budget ran out",
      }).line,
      "The check did not finish, so nothing of it is shown. The engagement's model budget ran out.",
    );
  });

  it("an action is offered only to a person who may act, and a file's only where it can be done", () => {
    const rerun = {
      kind: "RERUN",
      label: "Check again",
      fileId: null,
    } as const;
    const replace = {
      kind: "REPLACE",
      label: "Replace the file",
      fileId: FILE,
    } as const;
    const reread = {
      kind: "REREAD",
      label: "Read the file again",
      fileId: FILE,
    } as const;
    const can = {
      canAct: true,
      replaceable: () => true,
      rereadable: () => true,
    };
    assert.deepEqual(offeredAction(rerun, can), rerun);
    for (const action of [rerun, replace, reread]) {
      assert.equal(offeredAction(action, { ...can, canAct: false }), null);
    }
    assert.equal(
      offeredAction(replace, { ...can, replaceable: () => false }),
      null,
    );
    assert.equal(
      offeredAction(reread, { ...can, rereadable: () => false }),
      null,
    );
    assert.deepEqual(
      offeredAction(reread, { ...can, replaceable: () => false }),
      reread,
    );
    assert.equal(offeredAction({ ...replace, fileId: null }, can), null);
    assert.equal(offeredAction({ ...reread, fileId: null }, can), null);
    assert.deepEqual(offeredAction(replace, can), replace);
    assert.equal(offeredAction(null, can), null);
  });

  it("reviewed: each attribute's state in words with a mark, what needs the person first", () => {
    const view = check({
      read_in_part: true,
      attributes: [NOT_ASKED, attribute(), UNSETTLED, ISSUE],
    });
    assert.equal(view.standing, "REVIEWED");
    assert.equal(
      view.line,
      "Checked against attributes A to D by two independent readings.",
    );
    assert.equal(view.readInPart, READ_IN_PART);
    assert.equal(view.readInPart, "The evidence was read in part.");
    assert.deepEqual(view.leftOut, []);
    // Before the review support had no "shows": its label was "Supported". Now the
    // server says what it shows, and the words say it.
    assert.deepEqual(
      view.attributes.map((line) => [
        line.letter,
        line.state,
        line.label,
        line.icon,
        line.open,
      ]),
      [
        // Was "Issue: not shown": NOT_MET now also means an exception a record shows
        // (a self-approval), so the label says "not met" and the summary names it.
        ["B", "ISSUE", "Issue: not met", "risk", true],
        ["C", "JUDGMENT", "Your judgment needed", "help", true],
        ["A", "SUPPORTED", "Supported (implementation)", "check", false],
      ],
    );
    const [issue, judged, supported] = view.attributes;
    assert.equal(issue?.findingId, FINDING);
    assert.deepEqual(issue?.absent, [
      "A step requiring approval before provisioning",
    ]);
    assert.equal(issue?.judgment, null);
    assert.equal(judged?.judgment, READINGS_DISAGREE);
    assert.equal(
      judged?.judgment,
      "The two readings do not agree. Your judgment is needed.",
    );
    assert.deepEqual(judged?.readings, [
      {
        who: "First reading",
        result: "Shown",
        reason: "Section 4 sets the review.",
      },
      {
        who: "Second, independent reading",
        result: "Not shown",
        reason: "Section 4 names no reviewer.",
      },
    ]);
    assert.deepEqual(supported?.passages[0], {
      quote: "approved by the line manager",
      fileId: FILE,
      location: "Page 3",
      page: 3,
      fileLabel: "",
      opens: true,
    });
    assert.equal(check({}).readInPart, null);
  });

  it("names support by what it shows: the design, or its implementation", () => {
    const label = (shows: unknown) =>
      check({ attributes: [attribute({ shows })] }).attributes[0]?.label;
    assert.equal(label("IMPLEMENTATION"), "Supported (implementation)");
    assert.equal(label("DESIGN"), "Supported (design)");
    assert.equal(label(null), "Supported");
  });

  it("an attribute the request does not ask for folds to one line, its readings on open, never an issue or a judgment", () => {
    const view = check({ attributes: [attribute(), NOT_ASKED] });
    assert.deepEqual(view.notAddressed, []);
    assert.deepEqual(
      view.notAsked.map((line) => [line.letter, line.state, line.judgment]),
      [["D", "NOT_ADDRESSED", null]],
    );
    assert.deepEqual(view.notAsked[0]?.readings, [
      {
        who: "First reading",
        result: "Not addressed by the evidence",
        reason: "No termination.",
      },
      {
        who: "Second, independent reading",
        result: "Not addressed by the evidence",
        reason: "Not in the files.",
      },
    ]);
    assert.ok(!view.attributes.some((line) => line.letter === "D"));
    // One the request asks for and the evidence does not bear on stays its own fold.
    const asked = check({
      attributes: [{ ...NOT_ASKED, expected: true }],
    });
    assert.deepEqual(
      asked.notAddressed.map((line) => line.letter),
      ["D"],
    );
    assert.deepEqual(asked.notAsked, []);
    // Counted as neither an issue nor a judgment.
    const counts = assuranceCounts(
      parsed([entry({ attributes: [NOT_ASKED] })]),
    );
    assert.deepEqual([counts.issues, counts.unsettled], [0, 0]);
  });

  it("a decided issue shows as decided, by how, and does not open by itself", () => {
    const decided = (finding_status: string) =>
      check({ attributes: [{ ...ISSUE, finding_status }] }).attributes[0];
    assert.deepEqual(
      [
        decided("DISMISSED")?.state,
        decided("DISMISSED")?.label,
        decided("DISMISSED")?.open,
        decided("DISMISSED")?.findingId,
      ],
      ["DECIDED", "Issue: decided by dismissal", false, FINDING],
    );
    assert.equal(decided("RESOLVED")?.label, "Issue: decided by resolution");
    assert.equal(
      decided("CLARIFICATION_ACCEPTED")?.label,
      "Issue: decided by an accepted clarification",
    );
    assert.equal(
      decided("NOT_APPLICABLE")?.label,
      "Issue: decided by marking it not applicable",
    );
    // An open finding is still an open issue.
    assert.equal(decided("SENT")?.state, "ISSUE");
    assert.equal(decided("SENT")?.open, true);
  });

  it("with several files read together, a passage names the file it is in", () => {
    const view = check(
      {
        file_ids: [FILE, SECOND],
        attributes: [
          attribute({
            passages: [passage(SECOND), passage(uuid(99)), passage(null)],
          }),
        ],
      },
      [POLICY_FILE, TICKET],
    );
    assert.equal(
      view.line,
      "Checked against attribute A by two independent readings, reading 2 files together.",
    );
    assert.deepEqual(
      view.attributes[0]?.passages.map((item) => [item.fileLabel, item.opens]),
      [
        ["Ticket_4711.pdf", true],
        ["A file no longer on this request", false],
        ["The file is not named", false],
      ],
    );
  });

  it("a held file on a checked request: named, with its reason and its action", () => {
    const view = check(
      {
        file_ids: [FILE, SECOND],
        held_files: [
          {
            file_id: THIRD,
            code: "KIND_UNSURE",
            reason: "The reader was not sure this is a change log",
          },
        ],
      },
      [POLICY_FILE, TICKET, LOG],
    );
    assert.deepEqual(view.leftOut, [
      {
        fileId: THIRD,
        line: "Checked without Change_log.xlsx: The reader was not sure this is a change log.",
        action: {
          kind: "CONFIRM_TYPE",
          label: "Confirm the file's type",
          fileId: THIRD,
        },
      },
    ]);
    const reason = (code: string) =>
      check({ held_files: [{ file_id: THIRD, code }] }, [POLICY_FILE, LOG])
        .leftOut[0]?.line;
    assert.equal(
      reason("UNREADABLE"),
      "Checked without Change_log.xlsx: Nothing readable could be taken from it.",
    );
    assert.equal(
      reason("CUSTODY"),
      "Checked without Change_log.xlsx: It did not pass its custody check.",
    );
    assert.equal(
      reason("POPULATION"),
      "Checked without Change_log.xlsx: It is a population: the walkthrough instance is picked first.",
    );
    assert.equal(
      reason("TOO_LARGE"),
      "Checked without Change_log.xlsx: It is too large to be read with the other files.",
    );
    assert.equal(
      reason("NEW_CODE"),
      "Checked without Change_log.xlsx: It was not checked.",
    );
    assert.equal(
      check(
        {
          status: "CHECKING",
          held_files: [{ file_id: THIRD, code: "CUSTODY" }],
        },
        [POLICY_FILE, LOG],
      ).leftOut[0]?.line,
      "Being checked without Change_log.xlsx: It did not pass its custody check.",
    );
  });

  it("a file of the row the finished check does not list is said, never passed over", () => {
    const view = check({ file_ids: [FILE] }, [POLICY_FILE, TICKET]);
    assert.deepEqual(view.leftOut, [
      {
        fileId: SECOND,
        line: `Checked without Ticket_4711.pdf: ${NOT_LISTED}`,
        action: null,
      },
    ]);
    assert.deepEqual(
      check({ status: "CHECKING", file_ids: [FILE] }, [POLICY_FILE, TICKET])
        .leftOut,
      [],
    );
  });

  it("names an issue by what both readings agree the evidence shows", () => {
    const label = (result: unknown) =>
      check({ attributes: [{ ...ISSUE, result }] }).attributes[0]?.label;
    // Were "Issue: not shown" and "Issue: shown in part". NOT_MET on an issue now also
    // means an exception a record shows (a self-approval, named by the summary), so
    // "not shown" would misstate it; the words say what was found against the attribute.
    assert.equal(label("NOT_MET"), "Issue: not met");
    assert.equal(label("PARTLY_MET"), "Issue: met in part");
    assert.equal(label("CONTRADICTED"), "Issue: contradicted in the evidence");
    assert.equal(
      label("NOT_ADDRESSED"),
      "Issue: not addressed by the evidence",
    );
    assert.equal(label(null), "Issue");
  });

  it("says a result it could not read needs judgment, without claiming two readings disagree", () => {
    const [line] = check({
      attributes: [attribute({ verdict: "GREEN" })],
    }).attributes;
    assert.equal(line?.state, "JUDGMENT");
    assert.equal(line?.label, "Your judgment needed");
    assert.equal(line?.judgment, RESULT_UNREAD);
    assert.notEqual(line?.judgment, READINGS_DISAGREE);
  });

  it("a finished check with no result says so, and shows no state", () => {
    const view = check({ attributes: [] });
    assert.equal(
      view.line,
      "The check finished without a result for any attribute.",
    );
    assert.deepEqual(view.attributes, []);
  });

  it("uses the server's letter for an attribute that left the control", () => {
    const [line] = check({
      attributes: [attribute({ attribute_id: uuid(99), code: "F" })],
    }).attributes;
    assert.equal(line?.letter, "F");
    assert.equal(line?.text, "");
  });
});

describe("words for a reading's result", () => {
  it("has one for every result, and 'could not tell' for none", () => {
    assert.equal(resultWords("MET"), "Shown");
    assert.equal(resultWords("PARTLY_MET"), "Shown in part");
    assert.equal(resultWords("NOT_MET"), "Not shown");
    assert.equal(resultWords("CONTRADICTED"), "Contradicted in the evidence");
    assert.equal(resultWords("CANNOT_TELL"), "Could not tell");
    assert.equal(resultWords("NOT_ADDRESSED"), "Not addressed by the evidence");
    assert.equal(resultWords(null), "Could not tell");
  });
});

describe("a request row", () => {
  const row = (requests: unknown[], files: RowFile[] = [POLICY_FILE]) =>
    assuranceRow({
      requirementId: POLICY,
      files,
      assurance: parsed(requests),
      attributes: lettered,
      span,
    });

  it("is matched on the request only, and null where the chain has no entry for it", () => {
    assert.equal(row([]), null);
    assert.equal(row([entry({ requirement_id: WALK })]), null);
    assert.equal(
      assuranceRow({
        requirementId: POLICY,
        files: [POLICY_FILE],
        assurance: null,
        attributes: lettered,
        span,
      }),
      null,
    );
    assert.notEqual(row([entry({ file_ids: [uuid(99)] })], []), null);
  });

  it("reads Checking against the attributes while a run works, and is read again", () => {
    const view = row([entry({ status: "CHECKING", stage: "ASSESS" })]);
    assert.equal(view?.standing, "CHECKING");
    assert.equal(view?.fact, "Checking against attributes A to E…");
    assert.equal(view?.working, true);
    assert.deepEqual(view?.states, []);
    assert.deepEqual(view?.implementedIds, []);
    assert.equal(
      view?.acceptNote,
      "The check is still running, so what accepting marks as evidenced is not known yet.",
    );
  });

  it("names where a check not run, held, failed or out of date stands, and marks nothing", () => {
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [{ status: "NOT_CHECKED" }, "NOT_CHECKED", "Not checked yet"],
      [
        { status: "HELD", held: { code: "TOO_LARGE", reason: "" } },
        "HELD",
        "Check on hold",
      ],
      [{ status: "FAILED" }, "FAILED", "Check did not finish"],
      [{ status: "OUT_OF_DATE" }, "OUT_OF_DATE", "Check out of date"],
    ];
    for (const [over, standing, fact] of cases) {
      const view = row([entry(over)]);
      assert.equal(view?.standing, standing);
      assert.equal(view?.fact, fact);
      assert.equal(view?.working, false);
      assert.deepEqual(view?.states, []);
      assert.deepEqual(view?.implementedIds, []);
      assert.equal(
        view?.acceptNote,
        "This evidence has not been checked against the attributes, so accepting marks no attribute as evidenced.",
      );
    }
  });

  it("puts each letter under its one state in words, and marks only what an instance shows", () => {
    // Before the review: "A and E supported", and accepting marked A and E as
    // evidenced. Now support says what it shows, and only the implementation evidences.
    const view = row([
      entry({
        attributes: [
          attribute(),
          ISSUE,
          UNSETTLED,
          NOT_ASKED,
          attribute({ attribute_id: E, code: "E", shows: "DESIGN" }),
        ],
      }),
    ]);
    assert.equal(view?.fact, "Checked by two readings");
    assert.deepEqual(
      view?.states.map((group) => [group.key, group.label, group.icon]),
      [
        ["IMPLEMENTED", "A supported (implementation)", "check"],
        ["DESIGN", "E supported (design)", "check"],
        ["ISSUE", "B issue", "risk"],
        ["JUDGMENT", "C your judgment needed", "help"],
      ],
    );
    assert.equal(
      view?.spoken,
      "A supported (implementation), E supported (design), B issue, C your judgment needed",
    );
    assert.deepEqual(view?.implementedIds, [A]);
    assert.deepEqual(view?.designIds, [E]);
    assert.equal(
      view?.acceptNote,
      `Accepting marks attribute A as evidenced. E: ${DESIGN_ONLY}. Both readings found an issue on B. The readings do not agree on C: your judgment is needed. You can still accept; accepting does not settle these.`,
    );
    assert.equal(
      DESIGN_ONLY,
      "design documented, implementation not yet shown",
    );
    const letters = (view?.states ?? []).flatMap((group) => group.letters);
    assert.equal(new Set(letters).size, letters.length);
  });

  it("support without saying what it shows is not marked as evidenced", () => {
    const view = row([entry({ attributes: [attribute({ shows: null })] })]);
    assert.deepEqual(view?.implementedIds, []);
    assert.deepEqual(view?.designIds, []);
    assert.equal(view?.states[0]?.label, "A supported");
    assert.equal(
      view?.acceptNote,
      "Accepting marks no attribute as evidenced: the two readings find no record of an instance that shows one. A is supported, but the check does not say whether by the design or its implementation, so it is not marked as evidenced.",
    );
  });

  it("a decided issue is not an open issue on the row, beside Accept, or on the step", () => {
    const view = row([
      entry({
        attributes: [attribute(), { ...ISSUE, finding_status: "DISMISSED" }],
      }),
    ]);
    assert.deepEqual(
      view?.states.map((group) => group.label),
      ["A supported (implementation)", "B issue decided"],
    );
    assert.equal(
      view?.acceptNote,
      "Accepting marks attribute A as evidenced. The issue on B is decided, and it is not marked as evidenced.",
    );
    assert.ok(!(view?.acceptNote ?? "").includes("You can still accept"));
    const counts = assuranceCounts(
      parsed([
        entry({
          attributes: [
            { ...ISSUE, finding_status: "RESOLVED" },
            { ...ISSUE, attribute_id: C, code: "C", finding_status: "SENT" },
          ],
        }),
      ]),
    );
    assert.equal(counts.issues, 1);
  });

  it("a ticket and a change log read together: one state per letter", () => {
    const view = row(
      [
        entry({
          file_ids: [SECOND, THIRD],
          attributes: [
            attribute({ passages: [passage(SECOND)] }),
            attribute({
              attribute_id: B,
              code: "B",
              passages: [passage(THIRD)],
            }),
          ],
        }),
      ],
      [TICKET, LOG],
    );
    assert.equal(view?.spoken, "A and B supported (implementation)");
    assert.deepEqual(view?.implementedIds, [A, B]);
    assert.equal(
      view?.acceptNote,
      "Accepting marks attributes A and B as evidenced.",
    );
  });

  it("says on the row's line, and beside Accept, that a file was left out", () => {
    const view = row(
      [
        entry({
          file_ids: [SECOND],
          held_files: [{ file_id: THIRD, code: "UNREADABLE", reason: "" }],
          attributes: [attribute({ passages: [passage(SECOND)] })],
        }),
      ],
      [TICKET, LOG],
    );
    assert.equal(view?.fact, "Checked by two readings, 1 file left out");
    assert.equal(
      view?.acceptNote,
      "Accepting marks attribute A as evidenced. 1 file was not part of the check.",
    );
  });

  it("never presents an unsettled attribute as support or as an issue", () => {
    const cautious = [
      UNSETTLED,
      attribute({ attribute_id: A, code: "A", verdict: "FINE" }),
      attribute({ attribute_id: B, code: "B", result: null }),
      attribute({ attribute_id: D, code: "D", passages: [] }),
    ];
    const assurance = parsed([entry({ attributes: cautious })]);
    const view = assuranceRow({
      requirementId: POLICY,
      files: [POLICY_FILE],
      assurance,
      attributes: lettered,
      span,
    });
    assert.deepEqual(
      view?.states.map((group) => group.key),
      ["JUDGMENT"],
    );
    assert.deepEqual(view?.states[0]?.letters, ["A", "B", "C", "D"]);
    assert.deepEqual(view?.implementedIds, []);
    assert.deepEqual(view?.designIds, []);
    assert.match(
      view?.acceptNote ?? "",
      /^Accepting marks no attribute as evidenced/,
    );
    assert.ok(!(view?.acceptNote ?? "").includes("issue"));
    for (const line of view?.check.attributes ?? []) {
      assert.equal(line.state, "JUDGMENT");
      assert.equal(line.label, "Your judgment needed");
      assert.equal(line.findingId, null);
    }
    const counts = assuranceCounts(assurance);
    assert.equal(counts.issues, 0);
    assert.equal(counts.unsettled, 4);
  });
});

describe("beside Accept", () => {
  const facts = {
    standing: "REVIEWED" as const,
    implemented: [] as string[],
    design: [] as string[],
    unstated: [] as string[],
    issues: [] as string[],
    judged: [] as string[],
    decided: [] as string[],
    leftOut: 0,
    span,
  };

  it("says what accepting marks as evidenced: what an instance shows, no other", () => {
    // Before the review the parameter was "supported" and a policy's word alone was
    // marked as evidenced. Now only the implementation is.
    assert.equal(
      acceptNote({ ...facts, implemented: ["A"] }),
      "Accepting marks attribute A as evidenced.",
    );
    assert.equal(
      acceptNote({ ...facts, implemented: ["A", "B", "C"] }),
      "Accepting marks attributes A to C as evidenced.",
    );
    assert.equal(
      acceptNote({ ...facts, design: ["A", "B"] }),
      `Accepting marks no attribute as evidenced: the two readings find no record of an instance that shows one. A and B: ${DESIGN_ONLY}.`,
    );
  });

  it("says issues and disagreements plainly, and that the person can still accept", () => {
    assert.equal(
      acceptNote({ ...facts, implemented: ["A"], issues: ["B", "D"] }),
      "Accepting marks attribute A as evidenced. Both readings found an issue on B and D. You can still accept; accepting does not settle these.",
    );
    assert.equal(
      acceptNote({ ...facts, judged: ["C"] }),
      "Accepting marks no attribute as evidenced: the two readings find no record of an instance that shows one. The readings do not agree on C: your judgment is needed. You can still accept; accepting does not settle these.",
    );
  });

  it("says what was not checked", () => {
    assert.equal(
      acceptNote({ ...facts, implemented: ["A"], leftOut: 2 }),
      "Accepting marks attribute A as evidenced. 2 files were not part of the check.",
    );
    assert.equal(
      acceptNote({ ...facts, standing: "CHECKING" }),
      "The check is still running, so what accepting marks as evidenced is not known yet.",
    );
    for (const standing of [
      "NOT_CHECKED",
      "HELD",
      "FAILED",
      "OUT_OF_DATE",
    ] as const) {
      assert.equal(
        acceptNote({ ...facts, standing, implemented: ["A"] }),
        "This evidence has not been checked against the attributes, so accepting marks no attribute as evidenced.",
      );
    }
  });
});

describe("the step's counts, pill and line", () => {
  const requests = [
    entry({ attributes: [attribute(), ISSUE, UNSETTLED] }),
    entry({ requirement_id: uuid(13), status: "CHECKING" }),
    entry({ requirement_id: uuid(14), status: "HELD" }),
    entry({ requirement_id: uuid(15), status: "FAILED" }),
    entry({ requirement_id: uuid(16), status: "OUT_OF_DATE" }),
    entry({ requirement_id: uuid(17), status: "NOT_CHECKED" }),
  ];

  it("counts from the server's summary: requests, and open issues and judgments", () => {
    const counts = assuranceCounts(
      parsed(requests, {
        checking: 3,
        held: 2,
        failed: 2,
        out_of_date: 1,
        supported: 9,
        issues: 4,
        unsettled: 5,
      }),
    );
    assert.deepEqual(counts, {
      requests: 6,
      notChecked: 1,
      checking: 3,
      held: 2,
      again: 3,
      issues: 4,
      unsettled: 5,
    });
  });

  it("never counts below what the requests on the page show, and never a decided issue", () => {
    const zero = {
      checking: 0,
      held: 0,
      failed: 0,
      out_of_date: 0,
      supported: 0,
      issues: 0,
      unsettled: 0,
    };
    for (const summary of [zero, undefined, "broken", { issues: "x" }]) {
      const counts = assuranceCounts(parsed(requests, summary));
      assert.deepEqual(
        [
          counts.checking,
          counts.held,
          counts.again,
          counts.notChecked,
          counts.issues,
          counts.unsettled,
        ],
        [1, 1, 2, 1, 1, 1],
      );
    }
    // The open issues are the server's to count: a decided one is not one of them.
    const decided = assuranceCounts(
      parsed(
        [entry({ attributes: [{ ...ISSUE, finding_status: "DISMISSED" }] })],
        {
          issues: 0,
        },
      ),
    );
    assert.equal(decided.issues, 0);
    assert.deepEqual(assuranceCounts(null), {
      requests: 0,
      notChecked: 0,
      checking: 0,
      held: 0,
      again: 0,
      issues: 0,
      unsettled: 0,
    });
  });

  it("the pill names what needs the person first", () => {
    const base = {
      requests: 3,
      notChecked: 0,
      checking: 0,
      held: 0,
      issues: 0,
      unsettled: 0,
      again: 0,
    };
    assert.equal(assurancePill(base), "");
    assert.equal(
      assurancePill({ ...base, issues: 1, unsettled: 2, held: 1, checking: 1 }),
      "1 issue · 2 for your judgment",
    );
    assert.equal(assurancePill({ ...base, issues: 2 }), "2 issues");
    assert.equal(
      assurancePill({ ...base, unsettled: 1 }),
      "1 for your judgment",
    );
    assert.equal(assurancePill({ ...base, held: 1, checking: 1 }), "1 on hold");
    assert.equal(
      assurancePill({ ...base, again: 1, checking: 1 }),
      "1 to check again",
    );
    assert.equal(
      assurancePill({ ...base, notChecked: 2, checking: 1 }),
      "2 not checked yet",
    );
    assert.equal(assurancePill({ ...base, checking: 2 }), "2 being checked");
  });

  it("the line says what the checks found and what still waits", () => {
    const base = {
      requests: 3,
      notChecked: 0,
      checking: 0,
      held: 0,
      issues: 0,
      unsettled: 0,
      again: 0,
    };
    assert.equal(assuranceSentence({ ...base, requests: 0 }), "");
    // Before the review: "no issue, …". Now an issue a person decided is not counted,
    // so the line says "no open issue".
    assert.equal(
      assuranceSentence(base),
      "Two independent readings checked the evidence against the attributes: no open issue, and nothing left for your judgment. What each row supports is on the row.",
    );
    assert.equal(
      assuranceSentence({
        ...base,
        issues: 1,
        unsettled: 2,
        held: 1,
        checking: 1,
      }),
      "Two independent readings checked the evidence against the attributes: 1 open issue, 2 results for your judgment. See each row. 1 request on hold until you act on its row, 1 request still being checked.",
    );
    assert.equal(
      assuranceSentence({ ...base, requests: 2, checking: 2 }),
      "2 requests still being checked.",
    );
    assert.equal(
      assuranceSentence({ ...base, requests: 3, held: 2, again: 1 }),
      "2 requests on hold until you act on their row, 1 check to run again.",
    );
    assert.equal(
      assuranceSentence({ ...base, requests: 1, notChecked: 1 }),
      "1 request not checked yet.",
    );
  });
});

describe("an attribute's elements", () => {
  const check = (over: Record<string, unknown>, files = [POLICY_FILE]) =>
    requestCheck(only(parsed([entry(over)])), lettered, files, span);

  it("reads each element with its agreed result, and drops what is not one", () => {
    const [read] = only(
      parsed([
        entry({
          attributes: [
            attribute({
              elements: [
                element("condition", "Access is approved", "MET"),
                element("pass", "Approved before the grant", null),
                element("condition", "A duplicate key", "NOT_MET"),
                { key: "", text: "No key", result: "MET" },
                { key: "x", text: "", result: "MET" },
                {
                  ...element("odd", "An odd result", "MET"),
                  result: "SHOWN_IN_PART",
                },
                "text",
              ],
            }),
          ],
        }),
      ]),
    ).attributes;
    assert.deepEqual(
      read?.elements.map((item) => [
        item.key,
        item.result,
        item.passages.length,
      ]),
      [
        ["condition", "MET", 1],
        ["pass", null, 0],
        // SHOWN_IN_PART is an attribute's result, never an element's.
        ["odd", null, 1],
      ],
    );
    // A supported attribute with an element not shown contradicts itself.
    assert.equal(read?.verdict, "UNSETTLED");
    assert.equal(read?.understood, false);
  });

  it("lists an opened attribute's elements with their result in words", () => {
    assert.equal(elementWords("MET"), "Shown");
    assert.equal(elementWords("NOT_MET"), "Not shown");
    assert.equal(elementWords("NOT_ADDRESSED"), "Not in these files");
    assert.equal(elementWords(null), "Your judgment needed");
    assert.equal(elementWords("PARTLY_MET"), "Shown in part");
    assert.equal(elementWords("CANNOT_TELL"), "Could not tell");
    const [line] = check({
      attributes: [
        {
          ...ISSUE,
          elements: [
            element("condition", "Access is approved", "MET"),
            element("pass", "Approved before the grant", "NOT_MET"),
            element("exception", "No self-approval", null),
          ],
        },
      ],
    }).attributes;
    assert.deepEqual(line?.elements, [
      {
        key: "condition",
        text: "Access is approved",
        result: "Shown",
        tone: "success",
        absent: [],
      },
      {
        key: "pass",
        text: "Approved before the grant",
        result: "Not shown",
        tone: "danger",
        absent: ["No record of the approval"],
      },
      {
        key: "exception",
        text: "No self-approval",
        result: "Your judgment needed",
        tone: "warning",
        absent: [],
      },
    ]);
  });

  it("an issue whose result is not met keeps the summary that names the exception", () => {
    const [line] = check({
      attributes: [
        {
          ...ISSUE,
          summary: "The requester approved their own access (self-approval).",
        },
      ],
    }).attributes;
    assert.equal(line?.label, "Issue: not met");
    assert.equal(
      line?.summary,
      "The requester approved their own access (self-approval).",
    );
  });

  it("shown in part by this request: what it shows and what it leaves, never an issue or a judgment", () => {
    const view = check({ attributes: [IN_PART] });
    const [line] = view.attributes;
    assert.equal(line?.state, "PARTLY");
    assert.equal(line?.label, "Shown in part by this request (implementation)");
    assert.equal(line?.judgment, null);
    assert.equal(line?.findingId, null);
    assert.equal(line?.open, false);
    assert.deepEqual(line?.inPart, {
      shows: ["Access is approved by the line manager"],
      leaves: ["The approval comes before the grant"],
    });
    const row = assuranceRow({
      requirementId: POLICY,
      files: [POLICY_FILE],
      assurance: parsed([entry({ attributes: [IN_PART] })]),
      attributes: lettered,
      span,
    });
    assert.deepEqual(
      row?.states.map((group) => group.label),
      ["A shown in part"],
    );
    assert.deepEqual(row?.implementedIds, []);
    assert.equal(
      row?.acceptNote,
      "Accepting marks no attribute as evidenced: the two readings find no record of an instance that shows one. A is shown in part by this request; the rest is left to other requests, so it is evidenced only once they show it.",
    );
    const counts = assuranceCounts(parsed([entry({ attributes: [IN_PART] })]));
    assert.deepEqual([counts.issues, counts.unsettled], [0, 0]);
  });

  it("support in part stands only as sent: some element shown, the rest not borne on", () => {
    const verdict = (over: Record<string, unknown>) =>
      only(parsed([entry({ attributes: [{ ...IN_PART, ...over }] })]))
        .attributes[0]?.verdict;
    assert.equal(verdict({}), "PARTLY_SUPPORTED");
    assert.equal(verdict({ result: null }), "PARTLY_SUPPORTED");
    for (const [name, over] of [
      ["a result of met", { result: "MET" }],
      ["no passage", { passages: [] }],
      [
        "an element not met",
        {
          elements: [
            element("condition", "Approved", "MET"),
            element("pass", "Before the grant", "NOT_MET"),
          ],
        },
      ],
      [
        "nothing shown",
        { elements: [element("pass", "Before the grant", "NOT_ADDRESSED")] },
      ],
      ["nothing left", { elements: [element("condition", "Approved", "MET")] }],
    ] as const) {
      assert.equal(verdict(over), "UNSETTLED", name);
    }
  });

  it("combines elements across the control's requests: evidenced only when every one is shown from an instance by an accepted request", () => {
    const facts = (attributes: unknown[]) => {
      const row = assuranceRow({
        requirementId: POLICY,
        files: [POLICY_FILE],
        assurance: parsed([entry({ attributes })]),
        attributes: lettered,
        span,
      });
      assert.ok(row !== null);
      return row.elementFacts;
    };
    const approval = facts([IN_PART]);
    const timing = facts([
      {
        ...IN_PART,
        elements: [
          element(
            "condition",
            "Access is approved by the line manager",
            "NOT_ADDRESSED",
          ),
          element("pass", "The approval comes before the grant", "MET"),
        ],
      },
    ]);
    // Both accepted: every element shown, across the two requests.
    assert.deepEqual(
      attributeCoverage(A, [
        { accepted: true, facts: approval },
        { accepted: true, facts: timing },
      ]),
      { state: "EVIDENCED", missing: [], across: 2 },
    );
    // One accepted: shown in part, the rest named.
    assert.deepEqual(
      attributeCoverage(A, [
        { accepted: true, facts: approval },
        { accepted: false, facts: timing },
      ]),
      {
        state: "PARTLY",
        missing: ["The approval comes before the grant"],
        across: 0,
      },
    );
    // The rest documented in a policy only: design documented.
    const policy = facts([
      {
        ...IN_PART,
        shows: "DESIGN",
        elements: [
          element(
            "condition",
            "Access is approved by the line manager",
            "NOT_ADDRESSED",
          ),
          element("pass", "The approval comes before the grant", "MET"),
        ],
      },
    ]);
    assert.deepEqual(
      attributeCoverage(A, [
        { accepted: true, facts: approval },
        { accepted: true, facts: policy },
      ]),
      {
        state: "DESIGN_ONLY",
        missing: ["The approval comes before the grant"],
        across: 0,
      },
    );
    // Nothing accepted, and no check read it.
    assert.equal(
      attributeCoverage(A, [{ accepted: false, facts: approval }]).state,
      "NONE",
    );
    assert.equal(
      attributeCoverage(B, [{ accepted: true, facts: approval }]).state,
      "UNKNOWN",
    );
    // An element met without a verified passage under it is not shown.
    const bare = facts([
      {
        ...IN_PART,
        elements: [
          element(
            "condition",
            "Access is approved by the line manager",
            "MET",
            false,
          ),
          element(
            "pass",
            "The approval comes before the grant",
            "NOT_ADDRESSED",
          ),
        ],
      },
    ]);
    assert.equal(
      attributeCoverage(A, [{ accepted: true, facts: bare }]).state,
      "NONE",
    );
    // Before the second review, whole support sent without its elements covered every
    // element (a wildcard), here EVIDENCED. Where another request sends the attribute's
    // elements, which ones it showed is not known: it covers nothing.
    assert.equal(
      attributeCoverage(A, [
        { accepted: true, facts: facts([attribute()]) },
        { accepted: false, facts: timing },
      ]).state,
      "NONE",
    );
    assert.deepEqual(
      attributeCoverage(A, [
        { accepted: true, facts: facts([attribute()]) },
        { accepted: true, facts: approval },
      ]),
      {
        state: "PARTLY",
        missing: ["The approval comes before the grant"],
        across: 0,
      },
    );
    // Where no request sends the elements, whole support stands, in one request.
    assert.deepEqual(
      attributeCoverage(A, [{ accepted: true, facts: facts([attribute()]) }]),
      { state: "EVIDENCED", missing: [], across: 1 },
    );
    // One request showing every element is not "across": it is plainly evidenced.
    const whole = facts([
      attribute({
        elements: [
          element("condition", "Access is approved by the line manager", "MET"),
          element("pass", "The approval comes before the grant", "MET"),
        ],
      }),
    ]);
    assert.equal(
      attributeCoverage(A, [
        { accepted: true, facts: whole },
        { accepted: true, facts: approval },
      ]).across,
      1,
    );
  });

  it("a check sent without elements does not show an attribute whole beside Accept where others send them", () => {
    const keyedRow = (keyed: Set<string>) =>
      assuranceRow({
        requirementId: POLICY,
        files: [POLICY_FILE],
        assurance: parsed([entry({ attributes: [attribute()] })]),
        attributes: lettered,
        span,
        keyed,
      });
    assert.equal(
      keyedRow(new Set())?.acceptNote,
      "Accepting marks attribute A as evidenced.",
    );
    assert.match(
      keyedRow(new Set([A]))?.acceptNote ?? "",
      /^Accepting marks no attribute as evidenced/,
    );
    assert.deepEqual(
      [
        ...keyedOf(
          parsed([
            entry({ attributes: [IN_PART] }),
            entry({ requirement_id: WALK, attributes: [ISSUE] }),
          ]),
        ),
      ],
      [A],
    );
    assert.deepEqual([...keyedOf(null)], []);
  });

  it("on the list: the coverage names the elements still not shown, and evidences once the last is", () => {
    const requirements = [
      requirement({ state: "ACCEPTED", attributeIds: [A] }),
      requirement({
        id: WALK,
        title: "One access request traced",
        state: "RECEIVED",
        attributeIds: [A],
        files: [file({ fileId: SECOND, name: "Ticket_4711.pdf" })],
      }),
    ];
    const assurance = parsed([
      entry({ attributes: [IN_PART] }),
      entry({
        requirement_id: WALK,
        file_ids: [SECOND],
        attributes: [
          {
            ...IN_PART,
            passages: [passage(SECOND)],
            elements: [
              element(
                "condition",
                "Access is approved by the line manager",
                "NOT_ADDRESSED",
              ),
              {
                ...element(
                  "pass",
                  "The approval comes before the grant",
                  "MET",
                ),
                passages: [passage(SECOND)],
              },
            ],
          },
        ],
      }),
    ]);
    const view = list({ requirements, assurance });
    assert.equal(view.coverage[0]?.state, "PARTLY");
    assert.equal(
      view.coverage[0]?.label,
      "Attribute A: shown in part; still not shown: The approval comes before the grant",
    );
    assert.deepEqual(view.coverage[0]?.missing, [
      "The approval comes before the grant",
    ]);
    assert.match(view.coverageLine, /A shown in part/);
    // Accepting the request that shows the rest covers A.
    assert.match(view.coverageLine, /accepting this file covers A/);
    // Beside Accept on the request that completes it: shown across two requests, and
    // the one check the person makes.
    const walkRow = view.rows.find((row) => row.id === WALK);
    assert.match(
      walkRow?.assurance?.acceptNote ?? "",
      / Accepting this request shows A across 2 requests\. Check that these requests show the same instance\.$/,
    );
    assert.equal(
      SAME_INSTANCE,
      "Check that these requests show the same instance.",
    );
    // The request already accepted has no Accept, and no such note.
    assert.ok(
      !(
        view.rows.find((row) => row.id === POLICY)?.assurance?.acceptNote ?? ""
      ).includes(SAME_INSTANCE),
    );
    const done = list({
      requirements: requirements.map((item) => ({
        ...item,
        state: "ACCEPTED",
      })),
      assurance,
    });
    // Evidenced for coverage, and labelled as combined: never plain "evidence accepted".
    assert.equal(done.coverage[0]?.state, "EVIDENCED");
    assert.equal(done.coverage[0]?.across, 2);
    assert.equal(
      done.coverage[0]?.label,
      "Attribute A: shown across 2 requests",
    );
    assert.deepEqual(done.coverage[0]?.missing, []);
    assert.match(
      done.coverageLine,
      /^1 of 5 attributes evidenced · A shown across 2 requests/,
    );
  });
});

describe("polling while a check works", () => {
  it("every 5 seconds for the first minute, then every 15, and stops after 20 minutes", () => {
    // Before the review: every 5 seconds, stopping after 5 minutes.
    assert.equal(checkPollDelay(0), 5_000);
    assert.equal(checkPollDelay(59_999), 5_000);
    assert.equal(checkPollDelay(60_000), 15_000);
    assert.equal(checkPollDelay(19 * 60_000), 15_000);
    assert.equal(checkPollDelay(20 * 60_000), null);
    assert.equal(checkPollDelay(3_600_000), null);
    assert.equal(STILL_CHECKING, "Still checking. Refresh to see the result.");
  });
});

// The list itself (design-evidence-model): the row's quiet line, the step's header and
// the coverage read the chain where it has an entry, and read as before where it has none.

function file(overrides: Partial<RequirementFile> = {}): RequirementFile {
  return {
    fileId: FILE,
    name: "Access_Procedure_v3.pdf",
    via: "REQUEST",
    sharedFrom: null,
    linkId: null,
    linkedBy: null,
    reason: "",
    linkVersion: null,
    readStatus: "READY",
    readBy: "MODEL",
    kind: null,
    kindConfirmed: false,
    coverage: "COVERED",
    note: "",
    period: "",
    gaps: [],
    ...overrides,
  };
}

function requirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    id: POLICY,
    phase: "DESIGN",
    title: "User access management policy and provisioning procedure",
    description: "The policy and procedure for granting access, in force.",
    categories: ["PROCESS_DOCUMENTATION"],
    necessity: "REQUIRED",
    state: "RECEIVED",
    pendingChange: null,
    version: 3,
    requestId: REQUEST,
    files: [file()],
    assessment: {
      proposal: "FOLLOW_UP",
      reason: "The procedure does not name the approver",
      followUps: ["Ask for the approver's name"],
    },
    sufficiencyNote: "",
    sufficiencyBy: null,
    waiveReason: "",
    periodLabel: "",
    attributeIds: [A, B, C],
    procedureIds: [],
    acceptedBy: "Daniel Osei",
    acceptedAt: "2026-11-12T08:00:00Z",
    ...overrides,
  } as Requirement;
}

function list(overrides: Partial<EvidenceInput> = {}) {
  return evidenceList({
    requirements: [requirement()],
    approved: lettered.map((item) => ({
      id: item.id,
      text: item.text,
      sourceKind: "LIBRARY",
    })),
    requests: [
      {
        id: REQUEST,
        kind: "EVIDENCE",
        status: "RECEIVED",
        dueAt: "2026-11-26",
        recipient: "maria.keller@example.com",
        delivery: { mode: "EMAIL", at: "2026-11-12T09:00:00Z", by: null },
      },
    ],
    owner: { name: "Maria Keller", role: "IT Access Manager" },
    exceptions: [],
    liveEmail: null,
    procedures: null,
    period: "The control as currently designed",
    now: NOW,
    // A read that failed unless a test gives one: the same as leaving it out, typed.
    assurance: null,
    ...overrides,
  });
}

const reviewed = (extra: unknown[] = []) =>
  parsed(
    [
      entry({
        attributes: [attribute(), ISSUE, UNSETTLED, NOT_ASKED, ...extra],
      }),
    ],
    {
      checking: 0,
      held: 0,
      failed: 0,
      out_of_date: 0,
      supported: 1,
      issues: 1,
      unsettled: 1,
    },
  );

describe("the D&I list with the chain", () => {
  // Before: "reads exactly as before where the read succeeded and has no entry for the
  // request" (the row kept the reader's "Agent proposes: a follow-up." and, accepted,
  // evidenced what it addressed). Now, the cautious way (lead, 12 November 2026): a
  // request with files the read does not list is not checked, and evidences nothing.
  it("a request with files the read does not list is not checked: Check now, no reader's proposal, nothing evidenced", () => {
    for (const assurance of [
      parsed([]),
      parsed([entry({ requirement_id: WALK })]),
    ]) {
      const view = list({ assurance });
      assert.equal(view.rows[0]?.assurance?.standing, "NOT_CHECKED");
      assert.equal(
        view.rows[0]?.assurance?.check.line,
        "Not checked against the attributes yet",
      );
      assert.deepEqual(view.rows[0]?.assurance?.check.action, {
        kind: "RERUN",
        label: "Check now",
        fileId: null,
      });
      assert.equal(
        view.rows[0]?.sub,
        "Policy or procedure · 1 file · Not checked yet",
      );
      assert.equal(view.rows[0]?.agent, null);
      assert.equal(view.rows[0]?.proposal, "NONE");
      assert.equal(view.rows[0]?.readerShown, false);
    }
    const accepted = list({
      requirements: [requirement({ state: "ACCEPTED" })],
      assurance: parsed([]),
    });
    assert.deepEqual(
      accepted.coverage.filter((chip) => chip.state === "EVIDENCED"),
      [],
    );
    assert.equal(
      accepted.coverage[0]?.label,
      "Attribute A: evidence accepted, not checked against the attributes yet",
    );
    // A request with no file has nothing to check, and no entry is made up for it.
    const empty = list({
      requirements: [requirement({ state: "SENT", files: [] })],
      assurance: parsed([]),
    });
    assert.equal(empty.rows[0]?.assurance, null);
  });

  it("fails closed: a read that failed, or did not parse, evidences nothing and says the coverage is not known", () => {
    const accepted = [requirement({ state: "ACCEPTED" })];
    // What the same accepted request evidences when its check is read and supports A.
    // (Before the lead's follow-up this used an empty read, parsed([]): a request with
    // no entry then evidenced what it addressed. It is now not checked, and does not.)
    assert.equal(
      list({ requirements: accepted, assurance: parsed([entry()]) }).coverage[0]
        ?.state,
      "EVIDENCED",
    );
    for (const assurance of [
      null,
      parseAssurance({ broken: true }),
      undefined,
    ]) {
      const view = list({
        requirements: accepted,
        // A missing read is no read: left out, it fails closed too.
        ...(assurance === undefined ? {} : { assurance }),
      });
      assert.equal(view.coverageUnread, true);
      assert.deepEqual(
        view.coverage.filter((chip) => chip.state === "EVIDENCED"),
        [],
      );
      assert.equal(
        view.coverageLine,
        "The checks against the attributes could not be read. Refresh to try again.",
      );
      assert.equal(view.coverageLine, COVERAGE_UNREAD);
      assert.equal(
        view.coverage[0]?.label,
        "Attribute A: evidence accepted; its check could not be read",
      );
      assert.equal(view.coverage[0]?.state, "REQUESTED");
    }
    // Not a single attribute evidenced, nor promised by accepting what waits.
    const waiting = list({ assurance: null });
    assert.ok(!waiting.coverageLine.includes("accepting"));
    // Nor the reader's single reading: never checked by a second one. The row says
    // nothing of it, and the step's line says only that the checks could not be read.
    assert.equal(waiting.rows[0]?.agent, null);
    assert.equal(waiting.rows[0]?.proposal, "NONE");
    assert.equal(waiting.rows[0]?.readerShown, false);
    assert.equal(waiting.rows[0]?.sub, "Policy or procedure · 1 file");
    assert.equal(
      waiting.header.need.detail,
      `${COVERAGE_UNREAD} Nothing is accepted until you accept it.`,
    );
    assert.ok(!waiting.header.agent.found.join(" ").includes("Agent proposes"));
    // Nothing to check (no D&I request): nothing is said to have failed.
    const none = list({ requirements: [], assurance: null });
    assert.equal(none.coverageUnread, false);
  });

  it("the row's quiet line names the check, and the reader's single reading is not put to the person", () => {
    const working = list({
      assurance: parsed([entry({ status: "CHECKING", stage: "ASSESS" })]),
    });
    assert.equal(
      working.rows[0]?.sub,
      "Policy or procedure · 1 file · Checking against attributes A to E…",
    );
    assert.equal(working.rows[0]?.agent, null);
    assert.equal(working.rows[0]?.proposal, "NONE");
    assert.equal(working.rows[0]?.canAccept, true);
    const done = list({ assurance: reviewed() });
    assert.equal(
      done.rows[0]?.sub,
      "Policy or procedure · 1 file · Checked by two readings",
    );
    assert.equal(done.rows[0]?.agent, null);
    assert.ok(!done.header.agent.found.join(" ").includes("Agent proposes"));
    assert.ok(
      done.header.agent.found.includes(
        "User access management policy and provisioning procedure: A supported (implementation), B issue, C your judgment needed.",
      ),
    );
    const idle = list({
      assurance: parsed([entry({ status: "NOT_CHECKED" })]),
    });
    assert.equal(
      idle.rows[0]?.sub,
      "Policy or procedure · 1 file · Not checked yet",
    );
  });

  it("the step's pill and decision line count what needs the person, from the summary", () => {
    const view = list({ assurance: reviewed() });
    assert.equal(view.header.standing, "REVIEW");
    assert.equal(
      view.header.status,
      "1 file to review · 1 issue · 1 for your judgment",
    );
    assert.equal(
      view.header.need.detail,
      "Two independent readings checked the evidence against the attributes: 1 open issue, 1 result for your judgment. See each row. Nothing is accepted until you accept it.",
    );
    const working = list({
      assurance: parsed([entry({ status: "CHECKING" })], { checking: 1 }),
    });
    assert.equal(working.header.status, "1 file to review · 1 being checked");
    const held = list({
      assurance: parsed(
        [entry({ status: "HELD", held: { code: "TOO_LARGE", reason: "" } })],
        { held: 1 },
      ),
    });
    assert.equal(held.header.status, "1 file to review · 1 on hold");
    // The issue's finding is decided, and the server counts no open issue.
    const decided = list({
      assurance: parsed(
        [entry({ attributes: [{ ...ISSUE, finding_status: "RESOLVED" }] })],
        { issues: 0 },
      ),
    });
    assert.equal(decided.header.status, "1 file to review");
  });

  it("an attribute is evidenced only when the records of an instance show it and a person accepted", () => {
    const state = (view: ReturnType<typeof list>) =>
      Object.fromEntries(
        view.coverage.map((chip) => [chip.letter, chip.state]),
      );
    const waiting = list({ assurance: reviewed() });
    assert.deepEqual(state(waiting), {
      A: "REQUESTED",
      B: "REQUESTED",
      C: "REQUESTED",
      D: "UNCOVERED",
      E: "UNCOVERED",
    });
    assert.equal(
      waiting.coverageLine,
      "0 of 5 attributes evidenced · accepting this file covers A · D and E not addressed by any request",
    );
    const accepted = list({
      requirements: [requirement({ state: "ACCEPTED" })],
      assurance: reviewed(),
    });
    assert.deepEqual(state(accepted), {
      A: "EVIDENCED",
      B: "REQUESTED",
      C: "REQUESTED",
      D: "UNCOVERED",
      E: "UNCOVERED",
    });
    assert.equal(
      accepted.coverage[1]?.label,
      "Attribute B: evidence accepted, and its check does not show the attribute supported",
    );
    const early = list({
      requirements: [requirement({ state: "ACCEPTED" })],
      assurance: parsed([entry({ status: "CHECKING" })]),
    });
    assert.deepEqual(
      early.coverage.filter((chip) => chip.state === "EVIDENCED"),
      [],
    );
    // Old: accepted where the read has no entry for it, A was EVIDENCED, "as before the
    // chain". New (the cautious way, lead's decision): the request is not checked, and
    // evidences nothing.
    const legacy = list({
      requirements: [requirement({ state: "ACCEPTED" })],
      assurance: parsed([]),
    });
    assert.equal(state(legacy).A, "REQUESTED");
    assert.equal(
      legacy.coverage[0]?.label,
      "Attribute A: evidence accepted, not checked against the attributes yet",
    );
  });

  it("support by the documented design alone reads design documented, implementation not yet shown", () => {
    // Before the review a policy's support, once accepted, was "evidence accepted".
    const view = list({
      requirements: [requirement({ state: "ACCEPTED" })],
      assurance: parsed([
        entry({
          attributes: [
            attribute({ shows: "DESIGN" }),
            attribute({ attribute_id: B, code: "B", shows: null }),
          ],
        }),
      ]),
    });
    assert.equal(view.coverage[0]?.state, "DESIGN_ONLY");
    assert.equal(view.coverage[0]?.label, `Attribute A: ${DESIGN_ONLY}`);
    // Support without saying what it shows is not evidenced either.
    assert.equal(view.coverage[1]?.state, "REQUESTED");
    assert.equal(
      view.coverageLine,
      `0 of 5 attributes evidenced · A ${DESIGN_ONLY} · B and C accepted without support from the check · D and E not addressed by any request`,
    );
    // Not accepted yet: accepting a policy's support covers nothing.
    const waiting = list({
      assurance: parsed([
        entry({ attributes: [attribute({ shows: "DESIGN" })] }),
      ]),
    });
    assert.equal(waiting.coverage[0]?.state, "REQUESTED");
    assert.ok(!waiting.coverageLine.includes("accepting this file covers"));
  });

  it("a supported attribute the request did not ask for is evidenced once accepted", () => {
    const view = list({
      requirements: [requirement({ state: "ACCEPTED" })],
      assurance: parsed([
        entry({
          attributes: [
            attribute(),
            attribute({ attribute_id: E, code: "E", expected: false }),
          ],
        }),
      ]),
    });
    assert.equal(view.coverage[4]?.state, "EVIDENCED");
  });

  it("a row with two files reads their check as one, and names a file left out", () => {
    const view = list({
      requirements: [
        requirement({
          files: [
            file({ fileId: SECOND, name: "Ticket_4711.pdf" }),
            file({ fileId: THIRD, name: "Change_log.xlsx" }),
          ],
        }),
      ],
      assurance: parsed([
        entry({
          file_ids: [SECOND],
          held_files: [{ file_id: THIRD, code: "KIND_UNSURE", reason: "" }],
          attributes: [attribute({ passages: [passage(SECOND)] })],
        }),
      ]),
    });
    assert.equal(
      view.rows[0]?.sub,
      "Policy or procedure · 2 files · Checked by two readings, 1 file left out",
    );
    assert.equal(
      view.rows[0]?.assurance?.check.leftOut[0]?.line,
      "Checked without Change_log.xlsx: Its type is not confirmed.",
    );
    assert.equal(
      view.rows[0]?.assurance?.check.attributes[0]?.passages[0]?.fileLabel,
      "Ticket_4711.pdf",
    );
  });
});

describe("running the check, and reading a file again", () => {
  const fields = {
    organization_id: ORG,
    project_id: PROJECT,
    control_id: CONTROL,
    requirement_id: POLICY,
    intent: "rerun",
  };

  it("posts the rerun of one request, and nothing else", () => {
    assert.deepEqual(assuranceWrite(fields), {
      path: `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/evidence-assurance/${POLICY}/rerun`,
    });
    for (const bad of [
      { ...fields, intent: "accept" },
      { ...fields, intent: undefined },
      { ...fields, requirement_id: "../../admin" },
      { ...fields, requirement_id: undefined, file_id: FILE },
      { ...fields, control_id: "" },
      { ...fields, organization_id: 7 },
      {},
    ]) {
      assert.deepEqual(assuranceWrite(bad), { error: "invalid" });
    }
  });

  it("is confirmed only by the server; its refusal is shown as it says it", () => {
    assert.equal(assuranceProblem(200), null);
    assert.equal(
      assuranceProblem(409, "A check is already at work on this request."),
      "A check is already at work on this request.",
    );
    assert.equal(
      assuranceProblem(409),
      "The check cannot be run now. The row is refreshed.",
    );
    assert.equal(assuranceProblem(403), "Your role cannot run the check.");
    assert.match(assuranceProblem(404) ?? "", /no longer here/);
    for (const status of [0, 422, 500, 502]) {
      assert.notEqual(assuranceProblem(status), null);
    }
  });

  it("reads a file again through the reader's own re-read, in the evidence dialog's route", () => {
    assert.deepEqual(
      dialogWrite({
        organization_id: ORG,
        project_id: PROJECT,
        intent: "reanalyze",
        analysis_id: ANALYSIS,
        version: 4,
      }),
      {
        ok: true,
        path: `/organizations/${ORG}/projects/${PROJECT}/evidence-analyses/${ANALYSIS}/reanalyze`,
        body: { version: 4 },
      },
    );
    for (const bad of [
      { analysis_id: "x", version: 4 },
      { analysis_id: ANALYSIS, version: 0 },
      { analysis_id: ANALYSIS },
    ]) {
      assert.equal(
        dialogWrite({
          organization_id: ORG,
          project_id: PROJECT,
          intent: "reanalyze",
          ...bad,
        }).ok,
        false,
      );
    }
    assert.equal(rereadProblem(200), null);
    for (const status of [0, 403, 404, 409, 422, 500]) {
      assert.match(rereadProblem(status) ?? "", /^[A-Z].*\.$/);
    }
  });
});

describe("plain words on screen", () => {
  it("never shows an internal code", () => {
    const codes = [
      "KIND_UNSURE",
      "UNREADABLE",
      "READ_FAILED",
      "CUSTODY",
      "POPULATION",
      "NO_ATTRIBUTES",
      "TOO_LARGE",
    ];
    const assurance = parsed(
      [
        entry({
          file_ids: [FILE, SECOND],
          held_files: codes.map((code, at) => ({
            file_id: uuid(70 + at),
            code,
          })),
          attributes: [
            attribute(),
            attribute({ attribute_id: E, code: "E", shows: "DESIGN" }),
            ISSUE,
            {
              ...ISSUE,
              attribute_id: A,
              code: "A",
              finding_status: "DISMISSED",
            },
            UNSETTLED,
            NOT_ASKED,
            {
              ...IN_PART,
              attribute_id: uuid(6),
              code: "F",
            },
          ],
        }),
        entry({
          requirement_id: uuid(13),
          status: "CHECKING",
          stage: "VERIFY",
        }),
        ...codes.map((code, at) =>
          entry({
            requirement_id: uuid(80 + at),
            status: "HELD",
            held: { code, reason: "" },
          }),
        ),
        entry({ requirement_id: uuid(90), status: "FAILED" }),
        entry({ requirement_id: uuid(91), status: "OUT_OF_DATE" }),
        entry({ requirement_id: uuid(92), status: "QUEUED" }),
        entry({ requirement_id: uuid(93), status: "NOT_CHECKED" }),
      ],
      { checking: 2, held: 7, supported: 1, issues: 1, unsettled: 1 },
    );
    const rows = assurance.requests.map((item) =>
      assuranceRow({
        requirementId: item.requirementId,
        files: [POLICY_FILE, TICKET],
        assurance,
        attributes: lettered,
        span,
      }),
    );
    const counts = assuranceCounts(assurance);
    const shown = JSON.stringify([
      rows,
      assurancePill(counts),
      assuranceSentence(counts),
      Object.values(STATE_WORDS).map((words) => words.label),
      [0, 403, 404, 409, 422, 500].map((status) => assuranceProblem(status)),
      [0, 403, 404, 409, 422, 500].map((status) => rereadProblem(status)),
      STILL_CHECKING,
    ])
      // The states, kinds and keys the component switches on are not text on screen.
      .replace(/"(state|standing|kind|tone|icon|key|shows)":"[^"]*"/g, "");
    for (const code of [
      "UNSETTLED",
      "ASSESSOR",
      "REVIEWER",
      ...codes,
      "NOT_ADDRESSED",
      "SUPPORTED",
      "NOT_MET",
      "PARTLY_MET",
      "CONTRADICTED",
      "CANNOT_TELL",
      "OUT_OF_DATE",
      "NOT_CHECKED",
      "QUEUED",
      "DESIGN_DOCUMENT",
      "IMPLEMENTATION",
      "DISMISSED",
      "VERIFY",
      "PARTLY_SUPPORTED",
      "SHOWN_IN_PART",
    ]) {
      assert.ok(!shown.includes(code), code);
    }
  });
});

describe("an issue is its evidence finding", () => {
  it("the findings list reads the chain's source and kinds, so the finding is not dropped", () => {
    const kinds = ["NOT_MET", "PARTLY_MET", "CONTRADICTED", "NOT_ADDRESSED"];
    const read = parseFindings({
      findings: kinds.map((kind, at) => ({
        id: uuid(90 + at),
        file_id: FILE,
        source: "ASSURANCE",
        kind,
        status: "PROPOSED",
        title: "Attribute B is not shown",
        observation: "Nothing shows the approval comes before the grant.",
      })),
    });
    assert.deepEqual(
      read?.map((finding) => [finding.source, finding.kind]),
      kinds.map((kind) => ["ASSURANCE", kind]),
    );
  });
});

describe("the screen's own files", () => {
  const css = readFileSync("apps/web/app/design-evidence.css", "utf8");
  const view = readFileSync("apps/web/src/design-evidence.tsx", "utf8");
  const route = readFileSync(
    "apps/web/app/workspace/evidence-assurance/route.ts",
    "utf8",
  );

  it("opens an attribute and the not-asked fold within the motion budget, and not at all under reduced motion", () => {
    assert.match(css, /\.de-attr-body \{[^}]*animation: tar-open 200ms ease;/);
    assert.match(
      css,
      /\.de-unasked-list \{[^}]*animation: tar-open 200ms ease;/,
    );
    const reduced = css.slice(
      css.lastIndexOf("@media (prefers-reduced-motion"),
    );
    assert.match(
      reduced,
      /\.de-attr-body,\s*\.de-unasked-list \{\s*animation: none;/,
    );
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false);
  });

  it("runs a check and reads a file again through the list's action pattern, with no page reload", () => {
    assert.match(view, /fetch\("\/workspace\/evidence-assurance"/);
    assert.match(view, /fetch\("\/workspace\/evidence-dialog"/);
    assert.match(view, /intent: "reanalyze"/);
    assert.match(view, /requirement_id: requirementId/);
    assert.match(view, /router\.refresh\(\)/);
    assert.equal(
      /location\.reload|window\.location\.href\s*=/.test(view),
      false,
    );
    assert.match(route, /assuranceWrite\(fields\)/);
    assert.match(route, /response\.ok \? 200 : response\.status/);
  });

  it("polls with the backoff while a check works, and says when it stopped", () => {
    assert.match(view, /checkPollDelay\(Date\.now\(\) - start\)/);
    assert.match(view, /\{STILL_CHECKING\}/);
    // The old fixed refresh for checks is gone.
    assert.equal(/<AutoRefresh key="checks"/.test(view), false);
  });

  it("shows one check per request, an issue as its finding, and the not-asked fold", () => {
    assert.match(view, /<CheckOfRequest\b/);
    assert.equal(/CheckOfFile/.test(view), false);
    assert.match(view, /<FindingRecords\s+findings=\{\[finding\]\}/);
    assert.match(view, /Not asked for by this request/);
    assert.match(view, /chip\.state ===\s*"DESIGN_ONLY"/);
    // An evidenced chip combined from several requests says so in words.
    assert.match(view, /Shown across \$\{chip\.across\} requests/);
  });

  it("lists an opened attribute's elements, what a request shows in part, and the elements still not shown under the coverage", () => {
    assert.match(view, /className="de-elements"/);
    assert.match(view, /line\.inPart !== null/);
    assert.match(view, /Left to other requests/);
    assert.match(view, /className="dq-cov-missing"/);
    assert.match(view, /Still not shown:/);
  });
});
