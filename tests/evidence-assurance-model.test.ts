import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
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
  type EvidenceAssurance,
  NOT_LISTED,
  offeredAction,
  parseAssurance,
  READ_IN_PART,
  READINGS_DISAGREE,
  RESULT_UNREAD,
  type RowFile,
  requestCheck,
  resultWords,
  STATE_WORDS,
} from "../apps/web/src/evidence-assurance-model.ts";
import { parseFindings } from "../apps/web/src/evidence-findings-model.ts";
import type { RequirementFile } from "../apps/web/src/evidence-plan-model.ts";

// The evidence assurance chain on the D&I list (docs/evidence-assurance.md, sections 6
// and 7; product owner, 12 November 2026: "no room for error ... before providing
// feedback to the user, another agent should review whether that result is accurate").
// One run per request: its in-force files are read together, as one walkthrough. The
// page reads what the server decided and words it. Three errors matter, in order: a
// false "supported", a false issue, and a file or attribute skipped without saying so.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C, D, E] = [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)] as const;
const [POLICY, WALK] = [uuid(11), uuid(12)] as const;
const REQUEST = uuid(21);
const [FILE, SECOND, THIRD] = [uuid(31), uuid(32), uuid(33)] as const;
const FINDING = uuid(41);
const [ORG, PROJECT, CONTROL] = [uuid(51), uuid(52), uuid(53)] as const;
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

const passage = (fileId: string | null = FILE) => ({
  quote: "approved by the line manager",
  ...(fileId === null ? {} : { file_id: fileId }),
  location: { page: 3 },
});

/** One attribute as the API sends it. */
function attribute(over: Record<string, unknown> = {}) {
  return {
    attribute_id: A,
    code: "A",
    expected: true,
    verdict: "SUPPORTED",
    result: "MET",
    summary: "The procedure requires line-manager approval before access.",
    passages: [passage()],
    absent: [],
    views: [],
    finding_id: null,
    ...over,
  };
}

/** One request's entry as the API sends it. */
function entry(over: Record<string, unknown> = {}) {
  return {
    requirement_id: POLICY,
    run_id: uuid(61),
    status: "REVIEWED",
    stage: "DONE",
    held: null,
    held_files: [],
    file_ids: [FILE],
    lens: "DESIGN_DOCUMENT",
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
  summary: "Nothing shows the approval comes before the grant.",
  passages: [],
  absent: ["A step requiring approval before provisioning"],
  finding_id: FINDING,
});
const UNSETTLED = attribute({
  attribute_id: C,
  code: "C",
  verdict: "UNSETTLED",
  result: null,
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
const OFF_TOPIC = attribute({
  attribute_id: D,
  code: "D",
  expected: false,
  verdict: "NOT_ADDRESSED",
  result: "NOT_ADDRESSED",
  summary: "The evidence does not bear on terminations.",
  passages: [],
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
    assert.equal(request.lens, "DESIGN_DOCUMENT");
    assert.equal(request.readInPart, true);
    assert.equal(request.finishedAt, "2026-11-14T10:00:00Z");
    assert.deepEqual(request.attributes[0], {
      attributeId: A,
      code: "A",
      expected: true,
      verdict: "SUPPORTED",
      understood: true,
      result: "MET",
      summary: "The procedure requires line-manager approval before access.",
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
      // The same request twice keeps its first entry.
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
    // An entry that says nothing but the request is still being checked.
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

  it("shows nothing of a run that is not finished and current", () => {
    for (const status of [
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
    // Finished, and marked out of date: out of date.
    const stale = only(
      parsed([entry({ out_of_date: ["Attribute B's wording changed."] })]),
    );
    assert.equal(stale.status, "OUT_OF_DATE");
    assert.deepEqual(stale.attributes, []);
    assert.deepEqual(stale.outOfDate, ["Attribute B's wording changed."]);
  });

  it("keeps the gate's code and sentence only for a held request", () => {
    for (const code of ["KIND_UNSURE", "TOO_LARGE", "NO_ATTRIBUTES"]) {
      assert.deepEqual(
        only(
          parsed([entry({ status: "HELD", held: { code, reason: "Why." } })]),
        ).held,
        { code, reason: "Why." },
      );
    }
    // A code this page does not know, or no code at all: held, with no action.
    for (const said of [{ code: "NEW_GATE", reason: "x" }, null, "x", {}]) {
      assert.equal(
        only(parsed([entry({ status: "HELD", held: said })])).held?.code,
        "OTHER",
      );
    }
    // Not held: the field is not read.
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

  it("reads both views only for an unsettled attribute, and a finding only for an issue", () => {
    const request = only(
      parsed([
        entry({
          attributes: [
            attribute({
              views: [{ role: "ASSESSOR", result: "MET", reason: "x" }],
              finding_id: FINDING,
            }),
            UNSETTLED,
            {
              ...UNSETTLED,
              attribute_id: D,
              code: "D",
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
      { role: "REVIEWER", result: null, reason: "" },
    ]);
    assert.equal(request.attributes[2]?.findingId, null);
  });

  it("reads which file a passage is in, and where in it", () => {
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
    assert.deepEqual(where({ page: 3 }), {
      quote: "q",
      fileId: FILE,
      location: "Page 3",
      page: 3,
    });
    assert.equal(where({ location: "Page 2", page: 2 })?.location, "Page 2");
    assert.equal(
      where({ sheet: "Users", row: 4, cell: "B5" })?.location,
      "Sheet Users, cell B5",
    );
    assert.equal(
      where({ sheet: "Users", row: 4 })?.location,
      "Sheet Users, row 4",
    );
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
    assert.deepEqual(working.notAddressed, []);
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
    assert.deepEqual(held("UNREADABLE").action, {
      kind: "REPLACE",
      label: "Replace the file",
      fileId: FILE,
    });
    assert.deepEqual(held("CUSTODY").action, {
      kind: "REPLACE",
      label: "Replace the file",
      fileId: FILE,
    });
    assert.deepEqual(held("POPULATION").action, {
      kind: "PICK_INSTANCE",
      label: "Pick the walkthrough instance",
      fileId: FILE,
    });
    // No action of its own: too large together, no attribute, or a code not known.
    for (const code of ["TOO_LARGE", "NO_ATTRIBUTES", "SOMETHING_NEW"]) {
      assert.equal(held(code).action, null, code);
    }
    // With several files and no file named, which file to act on is not plain.
    assert.equal(held("KIND_UNSURE", "", [POLICY_FILE, TICKET]).action, null);
    for (const code of [
      "KIND_UNSURE",
      "UNREADABLE",
      "CUSTODY",
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
      held("TOO_LARGE").line,
      "The request's files are too large together to be read in one check, so they have not been checked against the attributes.",
    );
    // The gate's own sentence is shown as it is, closed with a full stop.
    assert.equal(
      held("TOO_LARGE", "The four files together exceed one reading").line,
      "The four files together exceed one reading.",
    );
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

  it("an action is offered only to a person who may act, and a replacement only where one can be made", () => {
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
    const can = { canAct: true, replaceable: () => true };
    assert.deepEqual(offeredAction(rerun, can), rerun);
    assert.equal(offeredAction(rerun, { ...can, canAct: false }), null);
    assert.equal(offeredAction(replace, { ...can, canAct: false }), null);
    assert.equal(
      offeredAction(replace, { ...can, replaceable: () => false }),
      null,
    );
    assert.equal(offeredAction({ ...replace, fileId: null }, can), null);
    assert.deepEqual(offeredAction(replace, can), replace);
    assert.deepEqual(
      offeredAction(rerun, { ...can, replaceable: () => false }),
      rerun,
    );
    assert.equal(offeredAction(null, can), null);
  });

  it("reviewed: each attribute's state in words with a mark, what needs the person first", () => {
    const view = check({
      read_in_part: true,
      attributes: [OFF_TOPIC, attribute(), UNSETTLED, ISSUE],
    });
    assert.equal(view.standing, "REVIEWED");
    assert.equal(
      view.line,
      "Checked against attributes A to D by two independent readings.",
    );
    assert.equal(view.readInPart, READ_IN_PART);
    assert.equal(view.readInPart, "The evidence was read in part.");
    assert.equal(view.action, null);
    assert.deepEqual(view.leftOut, []);
    assert.deepEqual(
      view.attributes.map((line) => [
        line.letter,
        line.state,
        line.label,
        line.icon,
        line.open,
      ]),
      [
        ["B", "ISSUE", "Issue: not shown", "risk", true],
        ["C", "JUDGMENT", "Your judgment needed", "help", true],
        ["A", "SUPPORTED", "Supported", "check", false],
      ],
    );
    assert.deepEqual(
      view.notAddressed.map((line) => [line.letter, line.label, line.icon]),
      [["D", "Not addressed", "minus"]],
    );
    const [issue, judged, supported] = view.attributes;
    assert.equal(issue?.findingId, FINDING);
    assert.deepEqual(issue?.absent, [
      "A step requiring approval before provisioning",
    ]);
    assert.equal(issue?.judgment, null);
    assert.equal(issue?.text, "Attribute 2 wording.");
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
    // One file: the passage does not name it, and opens in it.
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
    assert.equal(view.standing, "REVIEWED");
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
    // The page's own reason where the server sent none, for every code.
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
    // While the check works, the file left out is said too.
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
    assert.equal(NOT_LISTED, "It is not part of this check.");
    // Not while the check works: the files are still being read.
    assert.deepEqual(
      check({ status: "CHECKING", file_ids: [FILE] }, [POLICY_FILE, TICKET])
        .leftOut,
      [],
    );
  });

  it("names an issue by what both readings agree the evidence shows", () => {
    const label = (result: unknown) =>
      check({ attributes: [{ ...ISSUE, result }] }).attributes[0]?.label;
    assert.equal(label("NOT_MET"), "Issue: not shown");
    assert.equal(label("PARTLY_MET"), "Issue: shown in part");
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
    assert.equal(view.standing, "REVIEWED");
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
    // The request's entry is the row's, whatever files it lists.
    assert.notEqual(row([entry({ file_ids: [uuid(99)] })], []), null);
  });

  it("reads Checking against the attributes while a run works, and is read again", () => {
    const view = row([entry({ status: "CHECKING", stage: "ASSESS" })]);
    assert.equal(view?.standing, "CHECKING");
    assert.equal(view?.fact, "Checking against attributes A to E…");
    assert.equal(view?.working, true);
    assert.deepEqual(view?.states, []);
    assert.deepEqual(view?.supportedIds, []);
    assert.equal(
      view?.acceptNote,
      "The check is still running, so what accepting marks as evidenced is not known yet.",
    );
  });

  it("names where a held, failed or out-of-date check stands, and marks nothing", () => {
    const cases: Array<[Record<string, unknown>, string, string]> = [
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
      assert.deepEqual(view?.supportedIds, []);
      assert.equal(
        view?.acceptNote,
        "This evidence has not been checked against the attributes, so accepting marks no attribute as evidenced.",
      );
    }
  });

  it("puts each letter under its one state in words, and marks only what is supported", () => {
    const view = row([
      entry({
        attributes: [
          attribute(),
          ISSUE,
          UNSETTLED,
          OFF_TOPIC,
          attribute({ attribute_id: E, code: "E", expected: false }),
        ],
      }),
    ]);
    assert.equal(view?.standing, "REVIEWED");
    assert.equal(view?.fact, "Checked by two readings");
    assert.deepEqual(
      view?.states.map((group) => [group.state, group.label, group.icon]),
      [
        ["SUPPORTED", "A and E supported", "check"],
        ["ISSUE", "B issue", "risk"],
        ["JUDGMENT", "C your judgment needed", "help"],
      ],
    );
    assert.equal(
      view?.spoken,
      "A and E supported, B issue, C your judgment needed",
    );
    assert.deepEqual(view?.supportedIds, [A, E]);
    assert.equal(
      view?.acceptNote,
      "Accepting marks attributes A and E as evidenced. Both readings found an issue on B. The readings do not agree on C: your judgment is needed. You can still accept; accepting does not settle these.",
    );
    // Every letter stands under exactly one state.
    const letters = (view?.states ?? []).flatMap((group) => group.letters);
    assert.equal(new Set(letters).size, letters.length);
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
    assert.equal(view?.spoken, "A and B supported");
    assert.deepEqual(view?.supportedIds, [A, B]);
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
    assert.equal(
      view?.check.leftOut[0]?.line,
      "Checked without Change_log.xlsx: Nothing readable could be taken from it.",
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
      view?.states.map((group) => group.state),
      ["JUDGMENT"],
    );
    assert.deepEqual(view?.states[0]?.letters, ["A", "B", "C", "D"]);
    assert.deepEqual(view?.supportedIds, []);
    assert.match(
      view?.acceptNote ?? "",
      /^Accepting marks no attribute as evidenced/,
    );
    assert.ok(!(view?.acceptNote ?? "").includes("issue"));
    for (const line of view?.check.attributes ?? []) {
      assert.equal(line.state, "JUDGMENT");
      assert.equal(line.label, "Your judgment needed");
      assert.equal(line.tone, "warning");
      assert.equal(line.findingId, null);
      assert.notEqual(line.judgment, null);
    }
    const counts = assuranceCounts(assurance);
    assert.equal(counts.issues, 0);
    assert.equal(counts.unsettled, 4);
  });
});

describe("beside Accept", () => {
  const facts = {
    standing: "REVIEWED" as const,
    supported: [] as string[],
    issues: [] as string[],
    judged: [] as string[],
    leftOut: 0,
    span,
  };

  it("says what accepting marks as evidenced: the supported letters, no other", () => {
    assert.equal(
      acceptNote({ ...facts, supported: ["A"] }),
      "Accepting marks attribute A as evidenced.",
    );
    assert.equal(
      acceptNote({ ...facts, supported: ["A", "B", "C"] }),
      "Accepting marks attributes A to C as evidenced.",
    );
    assert.equal(
      acceptNote(facts),
      "Accepting marks no attribute as evidenced: the two readings support none.",
    );
  });

  it("says issues and disagreements plainly, and that the person can still accept", () => {
    assert.equal(
      acceptNote({ ...facts, supported: ["A"], issues: ["B", "D"] }),
      "Accepting marks attribute A as evidenced. Both readings found an issue on B and D. You can still accept; accepting does not settle these.",
    );
    assert.equal(
      acceptNote({ ...facts, judged: ["C"] }),
      "Accepting marks no attribute as evidenced: the two readings support none. The readings do not agree on C: your judgment is needed. You can still accept; accepting does not settle these.",
    );
  });

  it("says what was not checked", () => {
    assert.equal(
      acceptNote({ ...facts, supported: ["A"], leftOut: 2 }),
      "Accepting marks attribute A as evidenced. 2 files were not part of the check.",
    );
    assert.equal(
      acceptNote({ ...facts, standing: "CHECKING" }),
      "The check is still running, so what accepting marks as evidenced is not known yet.",
    );
    for (const standing of ["HELD", "FAILED", "OUT_OF_DATE"] as const) {
      assert.equal(
        acceptNote({ ...facts, standing, supported: ["A"] }),
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
  ];

  it("counts from the server's summary: requests, and attribute verdicts", () => {
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
      requests: 5,
      checking: 3,
      held: 2,
      again: 3,
      issues: 4,
      unsettled: 5,
    });
  });

  it("never counts below what the requests on the page show", () => {
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
          counts.issues,
          counts.unsettled,
        ],
        [1, 1, 2, 1, 1],
      );
    }
    assert.deepEqual(assuranceCounts(null), {
      requests: 0,
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
    assert.equal(assurancePill({ ...base, checking: 2 }), "2 being checked");
  });

  it("the line says what the checks found and what still waits", () => {
    const base = {
      requests: 3,
      checking: 0,
      held: 0,
      issues: 0,
      unsettled: 0,
      again: 0,
    };
    assert.equal(assuranceSentence({ ...base, requests: 0 }), "");
    assert.equal(
      assuranceSentence(base),
      "Two independent readings checked the evidence against the attributes: no issue, and nothing left for your judgment. What each row supports is on the row.",
    );
    assert.equal(
      assuranceSentence({
        ...base,
        issues: 1,
        unsettled: 2,
        held: 1,
        checking: 1,
      }),
      "Two independent readings checked the evidence against the attributes: 1 issue, 2 results for your judgment. See each row. 1 request on hold until you act on its row, 1 request still being checked.",
    );
    assert.equal(
      assuranceSentence({ ...base, requests: 2, checking: 2 }),
      "2 requests still being checked.",
    );
    assert.equal(
      assuranceSentence({ ...base, requests: 3, held: 2, again: 1 }),
      "2 requests on hold until you act on their row, 1 check to run again.",
    );
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
    ...overrides,
  });
}

const reviewed = () =>
  parsed([entry({ attributes: [attribute(), ISSUE, UNSETTLED, OFF_TOPIC] })], {
    checking: 0,
    held: 0,
    failed: 0,
    out_of_date: 0,
    supported: 1,
    issues: 1,
    unsettled: 1,
  });

describe("the D&I list with the chain", () => {
  it("reads exactly as before where the chain was not read, or has no entry", () => {
    const before = list();
    for (const assurance of [
      null,
      parsed([]),
      parsed([entry({ requirement_id: WALK })]),
    ]) {
      const view = list({ assurance });
      assert.equal(view.rows[0]?.assurance, null);
      assert.equal(view.rows[0]?.sub, before.rows[0]?.sub);
      assert.deepEqual(view.rows[0]?.agent, before.rows[0]?.agent);
      assert.deepEqual(view.coverage, before.coverage);
      assert.equal(view.coverageLine, before.coverageLine);
    }
    assert.equal(list({ assurance: null }).header.status, "1 file to review");
    assert.equal(before.rows[0]?.agent?.lead, "Agent proposes: a follow-up.");
    assert.match(before.rows[0]?.sub ?? "", /Agent: a follow-up$/);
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
    assert.equal(done.rows[0]?.canAccept, true);
    assert.ok(!done.header.agent.found.join(" ").includes("Agent proposes"));
    assert.ok(
      done.header.agent.found.includes(
        "User access management policy and provisioning procedure: A supported, B issue, C your judgment needed.",
      ),
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
      "Two independent readings checked the evidence against the attributes: 1 issue, 1 result for your judgment. See each row. Nothing is accepted until you accept it.",
    );
    const working = list({
      assurance: parsed([entry({ status: "CHECKING" })], { checking: 1 }),
    });
    assert.equal(working.header.status, "1 file to review · 1 being checked");
    assert.equal(
      working.header.need.detail,
      "1 request still being checked. Nothing is accepted until you accept it.",
    );
    const held = list({
      assurance: parsed(
        [entry({ status: "HELD", held: { code: "TOO_LARGE", reason: "" } })],
        { held: 1 },
      ),
    });
    assert.equal(held.header.status, "1 file to review · 1 on hold");
    assert.equal(
      held.header.need.detail,
      "1 request on hold until you act on its row. Nothing is accepted until you accept it.",
    );
  });

  it("an attribute is evidenced only when both readings support it and a person accepted", () => {
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
    assert.equal(
      accepted.coverageLine,
      "1 of 5 attributes evidenced · B and C accepted without support from the check · D and E not addressed by any request",
    );
    const early = list({
      requirements: [requirement({ state: "ACCEPTED" })],
      assurance: parsed([entry({ status: "CHECKING" })]),
    });
    assert.deepEqual(
      early.coverage.filter((chip) => chip.state === "EVIDENCED"),
      [],
    );
    const legacy = list({
      requirements: [requirement({ state: "ACCEPTED" })],
      assurance: parsed([]),
    });
    assert.deepEqual(state(legacy), {
      A: "EVIDENCED",
      B: "EVIDENCED",
      C: "EVIDENCED",
      D: "UNCOVERED",
      E: "UNCOVERED",
    });
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

describe("Check again", () => {
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
      assuranceProblem(409, "a check is at work"),
      "a check is at work.",
    );
    assert.equal(
      assuranceProblem(409),
      "The check cannot be run again now. The row is refreshed.",
    );
    assert.equal(
      assuranceProblem(403),
      "Your role cannot run the check again.",
    );
    assert.match(assuranceProblem(404) ?? "", /no longer here/);
    for (const status of [0, 422, 500, 502]) {
      assert.notEqual(assuranceProblem(status), null);
    }
  });
});

describe("plain words on screen", () => {
  it("never shows an internal code", () => {
    const codes = [
      "KIND_UNSURE",
      "UNREADABLE",
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
          attributes: [attribute(), ISSUE, UNSETTLED, OFF_TOPIC],
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
      ],
      { checking: 2, held: 6, supported: 1, issues: 1, unsettled: 1 },
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
    ])
      // The states and kinds the component switches on are not text on screen.
      .replace(/"(state|standing|kind|tone|icon)":"[^"]*"/g, "");
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
      "QUEUED",
      "DESIGN_DOCUMENT",
      "VERIFY",
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

  it("opens an attribute within the motion budget, and not at all under reduced motion", () => {
    assert.match(css, /\.de-attr-body \{[^}]*animation: tar-open 200ms ease;/);
    const reduced = css.slice(
      css.lastIndexOf("@media (prefers-reduced-motion"),
    );
    assert.match(reduced, /\.de-attr-body \{\s*animation: none;/);
    assert.match(reduced, /\.de-attr-caret > svg/);
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false);
  });

  it("runs a check again through the list's action pattern, with no page reload", () => {
    assert.match(view, /fetch\("\/workspace\/evidence-assurance"/);
    assert.match(view, /requirement_id: requirementId/);
    assert.match(view, /router\.refresh\(\)/);
    assert.equal(
      /location\.reload|window\.location\.href\s*=/.test(view),
      false,
    );
    assert.match(route, /assuranceWrite\(fields\)/);
    assert.match(route, /method: "POST"/);
    // The server's 202 is its confirmation.
    assert.match(route, /response\.ok \? 200 : response\.status/);
  });

  it("shows one check per request, and an issue as its finding", () => {
    assert.match(view, /<CheckOfRequest\b/);
    assert.equal(/CheckOfFile/.test(view), false);
    assert.match(view, /<FindingRecords\s+findings=\{\[finding\]\}/);
  });
});
