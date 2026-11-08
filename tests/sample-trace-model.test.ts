import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  daysWords,
  parseTrace,
  shortLabel,
  traceFileNote,
  traceHeading,
  traceProblem,
  traceReadPath,
  tracesSample,
  traceWrite,
} from "../apps/web/src/sample-trace-model.ts";

const ORG = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-000000000002";
const CONTROL = "00000000-0000-4000-8000-000000000003";
const ITEM = "00000000-0000-4000-8000-000000000004";
const HR = "00000000-0000-4000-8000-0000000000a1";
const AD = "00000000-0000-4000-8000-0000000000a2";
const EBS = "00000000-0000-4000-8000-0000000000a3";
const TICKET = "00000000-0000-4000-8000-0000000000a4";

const proposed = {
  requirement_id: ITEM,
  status: "PROPOSED",
  noun: "person",
  subject: {
    label: "Farah Navarro (101398)",
    identifiers: ["101398", "farah navarro", "fnavarro"],
    file_id: HR,
    file_name: "hr.csv",
    row_number: 1,
    origin: "PROPOSED",
    named_in_file_id: TICKET,
    confirmed_by: "",
    confirmed_at: null,
  },
  reasons: ["ticket.pdf names Farah Navarro, 101398, fnavarro."],
  candidates: [],
  listings: [{ file_id: HR, file_name: "hr.csv", rows: 58 }],
  files: [
    {
      file_id: HR,
      file_name: "hr.csv",
      system: "HRIS",
      listing: true,
      state: "FOUND",
      row_number: 1,
      summary: "Row 1: Employee ID 101398",
      dates: [
        {
          label: "Termination effective date",
          date: "2026-01-05",
          role: "EVENT",
          days: 0,
          over: false,
        },
      ],
    },
    {
      file_id: AD,
      file_name: "ad.csv",
      system: "",
      listing: true,
      state: "FOUND",
      row_number: 1,
      summary: "Row 1",
      dates: [
        {
          label: "whenChanged",
          date: "2026-01-13",
          role: "REMOVAL",
          days: 6,
          over: true,
        },
        { label: "bad", date: 5, role: "REMOVAL" },
      ],
    },
    {
      file_id: EBS,
      file_name: "ebs.csv",
      system: "Oracle EBS",
      listing: true,
      state: "NOT_FOUND",
      row_number: null,
      summary: "No row.",
      dates: [],
    },
    {
      file_id: TICKET,
      file_name: "ticket.pdf",
      system: "",
      listing: false,
      state: "NAMED",
      row_number: null,
      summary: "Requested for Farah Navarro",
      dates: [],
    },
    { file_id: "not-an-id", state: "FOUND" },
  ],
  event: {
    label: "Termination effective date",
    date: "2026-01-05",
    file_name: "hr.csv",
  },
  limit_days: 3,
  limit_words: "3 business days",
  observations: [
    {
      kind: "LATE",
      file_id: AD,
      title: "Removal after the limit in ad.csv",
      question: "Please explain…",
      recorded: false,
    },
    { kind: "SOMETHING_ELSE", file_id: AD, title: "x" },
  ],
  ready: false,
};

describe("the sample trace, as the item card reads it", () => {
  it("keeps only what the API promises", () => {
    const trace = parseTrace(proposed);
    assert.ok(trace !== null);
    assert.equal(trace.status, "PROPOSED");
    assert.equal(trace.subject?.label, "Farah Navarro (101398)");
    assert.equal(trace.files.length, 4);
    assert.equal(trace.files[1]?.dates.length, 1);
    assert.deepEqual(
      trace.observations.map((each) => each.kind),
      ["LATE"],
    );
    assert.equal(trace.limitDays, 3);
    assert.equal(parseTrace({ ...proposed, status: "DONE" }), null);
    assert.equal(parseTrace(null), null);
  });

  it("says what each file shows for the sample instead of its coverage", () => {
    const trace = parseTrace(proposed);
    assert.equal(traceFileNote(trace, HR), "traces Farah Navarro, row 1");
    assert.equal(traceFileNote(trace, EBS), "no row for Farah Navarro");
    assert.equal(traceFileNote(trace, TICKET), "names Farah Navarro");
    assert.equal(traceFileNote(trace, "other"), null);
    // A memo that names no one keeps the reader's own note.
    const memo = parseTrace({
      ...proposed,
      files: [
        {
          file_id: TICKET,
          file_name: "memo.docx",
          state: "GENERAL",
          dates: [],
        },
      ],
    });
    assert.equal(memo?.files[0]?.state, "GENERAL");
    assert.equal(traceFileNote(memo, TICKET), null);
    // No sample yet: the reader's own note stands.
    assert.equal(
      traceFileNote(parseTrace({ ...proposed, subject: null }), HR),
      null,
    );
    assert.equal(traceFileNote(null, HR), null);
    assert.equal(shortLabel("Farah Navarro (101398)"), "Farah Navarro");
    assert.equal(shortLabel("CHG0012345"), "CHG0012345");
  });

  it("words business days and the question for the person", () => {
    assert.equal(daysWords(0), "same day");
    assert.equal(daysWords(1), "1 business day after");
    assert.equal(daysWords(6), "6 business days after");
    assert.equal(daysWords(-7), "7 business days before");
    assert.equal(daysWords(null), "");
    const trace = parseTrace(proposed);
    assert.ok(trace !== null);
    assert.equal(traceHeading(trace), "Sample identified from the evidence");
    assert.equal(
      traceHeading({ ...trace, status: "CHOOSE" }),
      "Which person is the sample?",
    );
    assert.equal(
      traceHeading({ ...trace, status: "CHOOSE", noun: "ticket" }),
      "Which ticket is the sample?",
    );
    assert.equal(
      traceHeading({ ...trace, status: "CHOOSE", noun: "record" }),
      "Which item is the sample?",
    );
    assert.equal(
      traceHeading({ ...trace, status: "CONFIRMED", ready: true }),
      "Sample traced end to end",
    );
  });

  it("traces only a design item that walks one instance through", () => {
    assert.equal(
      tracesSample({ phase: "DESIGN", categories: ["CONTROL_EXECUTION"] }),
      true,
    );
    assert.equal(
      tracesSample({ phase: "DESIGN", categories: ["SAMPLE"] }),
      true,
    );
    assert.equal(
      tracesSample({ phase: "DESIGN", categories: ["PROCESS_DOCUMENTATION"] }),
      false,
    );
    assert.equal(
      tracesSample({ phase: "INTERIM", categories: ["CONTROL_EXECUTION"] }),
      false,
    );
  });

  it("checks what it sends", () => {
    const fields = {
      organization_id: ORG,
      project_id: PROJECT,
      control_id: CONTROL,
      requirement_id: ITEM,
      file_id: HR,
      row_number: 1,
      proposed: true,
    };
    assert.deepEqual(traceWrite(fields), {
      ok: true,
      path: `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/evidence-requirements/${ITEM}/sample-trace`,
      body: { file_id: HR, row_number: 1, proposed: true },
    });
    // Only a real true is a confirmation of the proposal.
    const picked = traceWrite({ ...fields, proposed: "true" });
    assert.ok(picked.ok && picked.body.proposed === false);
    assert.deepEqual(traceWrite({ ...fields, row_number: 0 }), { ok: false });
    assert.deepEqual(traceWrite({ ...fields, file_id: "../x" }), {
      ok: false,
    });
    assert.equal(
      traceReadPath(
        new URLSearchParams({
          organization: ORG,
          project: PROJECT,
          control: CONTROL,
          requirement: ITEM,
        }),
      ),
      `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/evidence-requirements/${ITEM}/sample-trace`,
    );
    assert.equal(
      traceReadPath(new URLSearchParams({ organization: ORG })),
      null,
    );
  });

  it("says what went wrong in words the person can act on", () => {
    assert.equal(traceProblem(200, ""), null);
    assert.equal(
      traceProblem(409, "the proposal changed; look at the sample again"),
      "The evidence changed since the sample was proposed. Review the sample again.",
    );
    assert.equal(
      traceProblem(409, "that row is not in the population"),
      "That row is not in the population.",
    );
    assert.equal(
      traceProblem(403, ""),
      "Only a member of the engagement team can confirm the sample.",
    );
    assert.equal(
      traceProblem(0, ""),
      "The trace could not be loaded. Try again.",
    );
  });
});
