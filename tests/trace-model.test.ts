import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseJourney } from "../apps/web/src/control-journey-model.ts";
import type { EvidencePlan } from "../apps/web/src/evidence-plan-model.ts";
import type { ControlReview } from "../apps/web/src/review-model.ts";
import type { TestSheet } from "../apps/web/src/sheet-model.ts";
import {
  type TraceInput,
  traceOf,
  traceRows,
  traceSummary,
  unsupportedLinks,
} from "../apps/web/src/trace-model.ts";

const hrefs = {
  PLAN: "/plan",
  REQUEST: "/request",
  TEST: "/test",
  CONCLUDE: "/conclude",
  REVIEW: "/review",
} as const;

const journey = parseJourney({
  step: "TEST",
  step_phase: "INTERIM",
  phases: [],
  blockers: [],
  not_final_because: [],
  conflicts: [],
});

const cell = (index: number, result: string | null, file?: string) => ({
  index,
  proposed: result,
  note: "",
  final: null,
  overrideReason: "",
  overriddenBy: null,
  citations:
    file === undefined
      ? []
      : [
          {
            fileId: "f",
            fileName: file,
            quote: "q",
            found: true,
            location: "",
            page: null,
            box: null,
            label: "",
          },
        ],
});

const sheet = {
  id: "s1",
  controlId: "c1",
  attributes: ["A request exists", "The request was approved"],
  status: "OPEN",
  running: false,
  conclusion: null,
  signedBy: null,
  items: [
    {
      id: "i1",
      label: "u0001",
      cells: [cell(0, "PASS", "tickets.csv"), cell(1, "PASS", "tickets.csv")],
    },
    {
      id: "i2",
      label: "u0002",
      cells: [cell(0, "EXCEPTION", "tickets.csv"), cell(1, null)],
    },
    { id: "i3", label: "u0003", cells: [] },
  ],
  counts: {
    items: 3,
    tested: 2,
    noEvidence: 1,
    exceptions: 1,
    unable: 0,
    review: 0,
    unplaced: 0,
  },
  proposal: {
    title: "Approval missing",
    condition: "",
    criteria: "",
    cause: "",
    effect: "",
    severity: "CONTROL_DEFICIENCY",
    severityReason: "",
  },
  proposalStatus: "PROPOSED",
  proposalReason: "",
} as unknown as TestSheet;

const plan = {
  controlId: "c1",
  phases: [
    {
      phase: "INTERIM",
      label: "Interim operating effectiveness",
      objectives: ["Access is granted only when approved."],
      procedures: [
        "Inspect the request for approval.",
        "Compare granted access to the request.",
      ],
      requirements: [
        { title: "Access population", files: [{ name: "population.csv" }] },
        { title: "Access tickets", files: [{ name: "tickets.csv" }] },
        { title: "Policy", files: [] },
      ],
    },
  ],
} as unknown as EvidencePlan;

const input = (over: Partial<TraceInput> = {}): TraceInput => ({
  journey,
  risk: "Unauthorized access is granted to SAP ERP.",
  statement: "",
  attributes: [],
  plan,
  sheet,
  review: null,
  deficiencies: [],
  conclusion: "NOT_CONCLUDED",
  hrefs,
  ...over,
});

describe("the trace rail", () => {
  it("builds the chain from records only and marks what is missing or partial", () => {
    const nodes = traceOf(input());
    assert.deepEqual(
      nodes.map((node) => `${node.kind}:${node.state}`),
      [
        "objective:recorded",
        "risk:recorded",
        "procedure:recorded",
        "attribute:recorded",
        "evidence:partial",
        "result:partial",
        "exception:partial",
        "conclusion:missing",
        "review:missing",
      ],
    );
    assert.equal(nodes[0]?.summary, "Access is granted only when approved.");
    assert.equal(
      nodes[2]?.summary,
      "2 test procedures for interim operating effectiveness",
    );
    assert.match(
      nodes[4]?.summary ?? "",
      /^2 files on 3 evidence requirements \(2 with evidence\); 1 file cited by results/,
    );
    assert.equal(
      nodes[5]?.summary,
      "2 of 3 samples tested: 2 pass, 1 exception, 0 insufficient evidence, 0 for review",
    );
    assert.match(
      nodes[6]?.summary ?? "",
      /1 exception; a deficiency is proposed \(Approval missing\), not yet logged/,
    );
    assert.deepEqual(nodes[6]?.items, ["A1: u0002"]);
    assert.equal(unsupportedLinks(nodes).length, 5);
    assert.equal(traceSummary(nodes), "2 links without a record");
    assert.equal(
      traceSummary(
        nodes.map((node) =>
          node.state === "missing"
            ? { ...node, state: "partial" as const }
            : node,
        ),
      ),
      "5 links partly on record",
    );
    assert.equal(
      traceSummary(
        nodes.map((node) => ({ ...node, state: "recorded" as const })),
      ),
      "Every link has a record",
    );
  });

  it("never fills a missing link", () => {
    const nodes = traceOf(
      input({
        plan: null,
        risk: "   ",
        sheet: null,
        attributes: ["Only attribute"],
      }),
    );
    assert.equal(nodes[0]?.state, "missing");
    assert.match(nodes[0]?.summary ?? "", /No control objective is recorded/);
    assert.equal(nodes[1]?.state, "missing");
    assert.equal(nodes[2]?.state, "missing");
    assert.equal(nodes[3]?.state, "recorded");
    assert.match(
      nodes[3]?.summary ?? "",
      /1 test attribute \(approved; not yet on a test sheet\)/,
    );
    assert.equal(nodes[4]?.state, "missing");
    assert.equal(nodes[5]?.summary, "No test sheet: nothing tested yet.");
    assert.equal(nodes[6]?.summary, "No results, so no exceptions yet.");
  });

  it("reads the conclusion and the review from their records", () => {
    const review = {
      id: "r1",
      status: "SIGNED_OFF",
      signedBy: "Riley Okafor",
      notes: [{ number: 1, status: "DISMISSED", text: "Sample size." }],
      blocking: [],
    } as unknown as ControlReview;
    const nodes = traceOf(
      input({
        sheet: {
          ...sheet,
          status: "SIGNED_OFF",
          conclusion: "NOT_EFFECTIVE",
          signedBy: "Dana Whitfield",
          proposalStatus: "DISMISSED",
          proposalReason: "Decided.",
        } as unknown as TestSheet,
        conclusion: "EFFECTIVE",
        review,
      }),
    );
    assert.equal(nodes[7]?.state, "recorded");
    assert.equal(nodes[7]?.summary, "Effective, on the signed-off review");
    assert.equal(
      nodes[8]?.summary,
      "Signed off by Riley Okafor; 1 note decided",
    );
    assert.match(nodes[6]?.summary ?? "", /dismissed by a person: Decided\./);
    const waiting = traceOf(
      input({
        sheet: {
          ...sheet,
          status: "SIGNED_OFF",
          conclusion: "NOT_EFFECTIVE",
          signedBy: "Dana Whitfield",
        } as unknown as TestSheet,
        deficiencies: [
          {
            reference: "D-001",
            title: "Approval missing",
            status: "REMEDIATION_IN_PROGRESS",
          } as never,
        ],
      }),
    );
    assert.equal(waiting[7]?.state, "partial");
    assert.match(
      waiting[7]?.summary ?? "",
      /Testing signed off not effective by Dana Whitfield; the conclusion waits for the review/,
    );
    assert.match(
      waiting[6]?.summary ?? "",
      /1 exception → D-001 \(remediation in progress\)/,
    );
  });

  it("gives each attribute the evidence its results cite and what they found", () => {
    const rows = traceRows(input());
    assert.deepEqual(
      rows.map((row) => [
        row.code,
        row.evidence,
        row.pass,
        row.exceptions,
        row.untested,
        row.exceptionItems,
      ]),
      [
        ["A1", ["tickets.csv"], 1, 1, 1, ["u0002"]],
        ["A2", ["tickets.csv"], 1, 0, 2, []],
      ],
    );
  });

  it("never presents the interim plan as a retest's", () => {
    const atRetest = parseJourney({
      step: "TEST",
      step_phase: "RETEST",
      phases: [],
      blockers: [],
      not_final_because: [],
      conflicts: [],
    });
    const retestSheet = {
      ...sheet,
      items: [
        {
          id: "r1",
          label: "u1001",
          files: [{ id: "f9", fileName: "after the fix.csv" }],
          cells: [],
        },
      ],
      counts: {
        items: 1,
        tested: 0,
        noEvidence: 0,
        exceptions: 0,
        unable: 0,
        review: 0,
        unplaced: 0,
      },
      proposal: null,
      proposalStatus: "NONE",
    } as unknown as TestSheet;
    const nodes = traceOf(
      input({
        journey: atRetest,
        sheet: retestSheet,
        round: {
          kind: "RETEST",
          number: 1,
          deficiencyReference: "D-001",
          requestStatus: "RECEIVED",
        },
      }),
    );
    assert.equal(nodes[0]?.state, "partial");
    assert.match(
      nodes[0]?.summary ?? "",
      /^Retest round 1 of D-001: the round record states what is retested; no retest-specific objective/,
    );
    assert.equal(nodes[2]?.state, "missing");
    assert.match(
      nodes[2]?.summary ?? "",
      /No retest-specific procedures are approved on the plan; the interim procedures are not shown/,
    );
    assert.match(
      nodes[3]?.summary ?? "",
      /on the retest sheet, carried from the control's approved set/,
    );
    assert.equal(nodes[4]?.state, "recorded");
    assert.match(
      nodes[4]?.summary ?? "",
      /^1 file on the retest samples; 0 files cited by results\. The interim evidence requirements are not the retest's\./,
    );
    assert.deepEqual(nodes[4]?.items, ["after the fix.csv"]);
    // A roll-forward has its own plan phase, so nothing changes for it.
    const atRollForward = parseJourney({
      step: "TEST",
      step_phase: "ROLLFORWARD",
      phases: [],
      blockers: [],
      not_final_because: [],
      conflicts: [],
    });
    const rolled = traceOf(
      input({
        journey: atRollForward,
        round: {
          kind: "ROLLFORWARD",
          number: 1,
          deficiencyReference: null,
          requestStatus: "RECEIVED",
        },
      }),
    );
    assert.equal(rolled[2]?.state, "recorded");
  });
});
