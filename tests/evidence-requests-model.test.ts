import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ActivityItem } from "../apps/web/src/control-workspace-model.ts";
import {
  type EvidencePlan,
  parsePlan,
} from "../apps/web/src/evidence-plan-model.ts";
import {
  attributeCoverage,
  evidenceRequests,
  filterRequests,
  itemStatus,
  itemSummary,
  mappingLine,
  NO_FILTER,
  procedureCoverage,
  progressOf,
  requestActivity,
  UNASSIGNED,
  wordingOf,
} from "../apps/web/src/evidence-requests-model.ts";
import type { RequestRow } from "../apps/web/src/evidence-workspace-model.ts";
import type { MasterPlan } from "../apps/web/src/planning-model.ts";

const CONTROL = "33333333-3333-4333-8333-333333333333";

/** The request at an index, which the test expects to be there. */
function at<T>(list: readonly T[], index: number): T {
  const found = list[index];
  assert.ok(found !== undefined);
  return found;
}

function item(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    title: "An item",
    description: "What the item asks for, in full.",
    categories: ["POPULATION"],
    objective: "Objective of the item",
    rationale: "Why it is needed.",
    necessity: "REQUIRED",
    status: "PLANNED",
    state: "NOT_GENERATED",
    version: 1,
    ...fields,
  };
}

const SUITE =
  "The window tested (from 1 January 2027 to 30 September 2027). Include: User ID and name; " +
  "Role granted; Date granted; Granted by; Report or query name. Completeness: Taken from the " +
  "system's own records. Not sufficient: A list of closed tickets. If not available: The user " +
  "master export.";

/** A lean plan (27 October 2026): design's two items, then each operating phase's list
 * and the one item for its selected samples. */
function plan(
  status = "APPROVED",
  states: Record<string, string> = {},
): EvidencePlan {
  const state = (id: string, fallback: string) => states[id] ?? fallback;
  const parsed = parsePlan({
    control_id: CONTROL,
    status,
    phases: [
      {
        phase: "DESIGN",
        applicability: "APPLICABLE",
        period_start: "2027-01-01",
        period_end: "2027-12-31",
        requirements: [
          item({
            id: "d1",
            phase: "DESIGN",
            title: "Access management policy",
            categories: ["PROCESS_DOCUMENTATION"],
            state: state("d1", "SENT"),
            request_id: "r-design",
            request_recipient: "Dana Lee",
          }),
          item({
            id: "d2",
            phase: "DESIGN",
            title: "One access request traced end to end",
            categories: ["CONTROL_EXECUTION"],
            state: state("d2", "SENT"),
            request_id: "r-design",
            request_recipient: "Dana Lee",
          }),
        ],
      },
      {
        phase: "INTERIM",
        applicability: "APPLICABLE",
        period_start: "2027-01-01",
        period_end: "2027-09-30",
        requirements: [
          item({
            id: "i1",
            phase: "INTERIM",
            title: "All access grants, January to September",
            description: SUITE,
            categories: ["POPULATION", "REPORT_RELIABILITY"],
            state: state("i1", "RECEIVED"),
            request_id: "r-interim",
          }),
          item({
            id: "i2",
            phase: "INTERIM",
            title: "Evidence for each selected grant",
            categories: ["SAMPLE", "CONTROL_EXECUTION"],
            depends_on_title: "All access grants, January to September",
            state: state("i2", "AWAITING_DEPENDENCY"),
          }),
        ],
      },
      {
        phase: "ROLLFORWARD",
        applicability: "NOT_APPLICABLE",
        rationale: "The interim period runs to period end for this control.",
        requirements: [],
      },
    ],
  });
  assert.ok(parsed !== null);
  return parsed;
}

const MASTER = {
  controlId: CONTROL,
  attributes: [
    {
      id: "a1",
      code: "A1",
      text: "The request names the access",
      passCriteria: "",
    },
    {
      id: "a2",
      code: "A2",
      text: "The approval precedes the grant",
      passCriteria: "",
    },
    { id: "a3", code: "A3", text: "Nothing tests this one", passCriteria: "" },
  ],
  procedures: [
    {
      id: "p1",
      code: "P1",
      phase: "INTERIM",
      text: "Inspect each selected grant",
    },
    { id: "p2", code: "P2", phase: "DESIGN", text: "Walk one request through" },
  ],
  evidence: [
    { id: "d1", code: "E1", attributeCodes: [], procedureCodes: [] },
    { id: "d2", code: "E2", attributeCodes: ["A1"], procedureCodes: ["P2"] },
    { id: "i1", code: "E3", attributeCodes: [], procedureCodes: [] },
    {
      id: "i2",
      code: "E4",
      attributeCodes: ["A1", "A2"],
      procedureCodes: ["P1"],
    },
  ],
} as unknown as MasterPlan;

const ROWS = [
  {
    id: "r-design",
    kind: "EVIDENCE",
    phase: "DESIGN",
    recipient: "Dana Lee",
    status: "SENT",
  },
  { id: "r-interim", kind: "EVIDENCE", phase: "INTERIM", status: "SENT" },
] as unknown as RequestRow[];

describe("the Request step's list of requests", () => {
  it("groups each phase into what it asks first and the samples that follow", () => {
    const requests = evidenceRequests(plan(), ROWS, MASTER);
    assert.deepEqual(
      requests.map((r) => [r.number, r.phase, r.part, r.items.length]),
      [
        [1, "DESIGN", "MAIN", 2],
        [2, "INTERIM", "MAIN", 1],
        [3, "INTERIM", "SAMPLES", 1],
      ],
    );
    // A phase that does not apply asks for nothing.
    assert.ok(requests.every((r) => r.phase !== "ROLLFORWARD"));
    const [design, list, samples] = requests;
    assert.equal(design?.title, "How the control is designed and works");
    assert.equal(list?.title, "All access grants, January to September");
    assert.equal(samples?.title, "Evidence for each selected grant");
    // The plan's codes and links come from the test plan.
    assert.deepEqual(samples?.attributeCodes, ["A1", "A2"]);
    assert.deepEqual(samples?.procedureCodes, ["P1"]);
    assert.equal(samples?.items[0]?.code, "E4");
    assert.equal(design?.recipient, "Dana Lee");
  });

  it("says where each request stands, and never reads received as accepted", () => {
    const [design, list, samples] = evidenceRequests(plan(), ROWS, MASTER);
    assert.equal(design?.status, "AWAITING_EVIDENCE");
    // Something arrived and no one has judged it: a person reviews it.
    assert.equal(list?.status, "NEEDS_REVIEW");
    assert.equal(samples?.status, "WAITING");
    const done = evidenceRequests(
      plan("APPROVED", { d1: "ACCEPTED", d2: "ACCEPTED" }),
      ROWS,
      MASTER,
    );
    assert.equal(done[0]?.status, "COMPLETE");
    const partly = evidenceRequests(
      plan("APPROVED", { d1: "ACCEPTED" }),
      ROWS,
      MASTER,
    );
    assert.equal(partly[0]?.status, "IN_PROGRESS");
    assert.equal(
      progressOf(partly[0] ?? { total: 0, provided: 0 }).line,
      "1 of 2 provided (50%)",
    );
    // Before the plan is approved nothing is requested: the requests are proposed.
    const proposed = evidenceRequests(
      plan("PROPOSED", { d1: "NOT_GENERATED", d2: "NOT_GENERATED" }),
      [],
      MASTER,
    );
    assert.equal(proposed[0]?.status, "PROPOSED");
    assert.equal(itemStatus("RECEIVED"), "PROVIDED");
    assert.equal(itemStatus("ACCEPTED"), "ACCEPTED");
    assert.equal(itemStatus("SENT"), "MISSING");
    assert.equal(itemStatus("AWAITING_DEPENDENCY"), "WAITING");
  });

  it("filters by phase, status, assignee, and words", () => {
    const requests = evidenceRequests(plan(), ROWS, MASTER);
    const keys = (filter: Partial<typeof NO_FILTER>) =>
      filterRequests(requests, { ...NO_FILTER, ...filter }).map((r) => r.key);
    assert.deepEqual(keys({ phase: "INTERIM" }), [
      "INTERIM-MAIN",
      "INTERIM-SAMPLES",
    ]);
    assert.deepEqual(keys({ status: "needs-review" }), ["INTERIM-MAIN"]);
    assert.deepEqual(keys({ assignee: "Dana Lee" }), ["DESIGN-MAIN"]);
    assert.deepEqual(keys({ assignee: UNASSIGNED }), [
      "INTERIM-MAIN",
      "INTERIM-SAMPLES",
    ]);
    assert.deepEqual(keys({ search: "POLICY" }), ["DESIGN-MAIN"]);
    assert.deepEqual(keys({ search: "nothing like this" }), []);
  });

  it("reads a standard's wording into what the item must show", () => {
    const wording = wordingOf(SUITE);
    assert.ok(wording !== null);
    assert.deepEqual(wording.include.slice(0, 2), [
      "User ID and name",
      "Role granted",
    ]);
    assert.equal(wording.notSufficient, "A list of closed tickets.");
    assert.deepEqual(wording.alternatives, ["The user master export"]);
    assert.equal(
      itemSummary(SUITE),
      "The window tested (from 1 January 2027 to 30 September 2027). Showing user ID and " +
        "name, Role granted, Date granted, Granted by, and 1 more.",
    );
    // Any other wording reads as written.
    assert.equal(wordingOf("Provide the current policy."), null);
    assert.equal(
      itemSummary("Provide the current policy."),
      "Provide the current policy.",
    );
  });

  it("maps each request to the test plan, and shows coverage by attribute and procedure", () => {
    const requests = evidenceRequests(plan(), ROWS, MASTER);
    assert.equal(
      mappingLine(at(requests, 2)),
      "These evidence items support 2 attributes across 1 procedure.",
    );
    assert.equal(
      mappingLine(at(requests, 1)),
      "These evidence items are not linked to an attribute or procedure yet.",
    );
    const coverage = attributeCoverage(requests, MASTER);
    assert.deepEqual(
      coverage.map((a) => [a.code, a.covered]),
      [
        ["A1", true],
        ["A2", true],
        ["A3", false],
      ],
    );
    assert.deepEqual(
      coverage[0]?.byPhase.DESIGN.map((i) => i.code),
      ["E2"],
    );
    const procedures = procedureCoverage(requests, MASTER);
    assert.deepEqual(
      procedures.map((p) => [p.code, p.items.map((i) => i.code)]),
      [
        ["P1", ["E4"]],
        ["P2", ["E2"]],
      ],
    );
  });

  it("shows the request's own activity, newest first, or the control's evidence activity", () => {
    const requests = evidenceRequests(plan(), ROWS, MASTER);
    const activity = [
      {
        id: "1",
        at: "2026-10-01T10:00:00Z",
        category: "evidence",
        title: "Access management policy received",
        detail: "",
        actor: "Dana",
        by: "person",
        action: "x",
      },
      {
        id: "2",
        at: "2026-10-02T10:00:00Z",
        category: "evidence",
        title: "Something else",
        detail: "",
        actor: "Sam",
        by: "person",
        action: "x",
      },
      {
        id: "3",
        at: "2026-10-03T10:00:00Z",
        category: "testing",
        title: "Access management policy tested",
        detail: "",
        actor: "Sam",
        by: "person",
        action: "x",
      },
    ] as ActivityItem[];
    assert.deepEqual(
      requestActivity(at(requests, 0), activity).map((a) => a.id),
      ["1"],
    );
    assert.deepEqual(
      requestActivity(at(requests, 2), activity).map((a) => a.id),
      ["2", "1"],
    );
    assert.deepEqual(requestActivity(at(requests, 0), null), []);
  });
});
