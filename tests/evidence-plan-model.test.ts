import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  type EvidencePlan,
  filterRequirements,
  groupByCategory,
  NO_FILTER,
  owners,
  PHASE_STATE_EXPLAINED,
  PHASE_STATES,
  parsePlan,
  phaseOfTab,
  planAwaitsApproval,
  planProblem,
  planWrite,
  requestProgress,
  requestsOfPhase,
  requirementStatus,
  shownRequirements,
  stepStateOf,
} from "../apps/web/src/evidence-plan-model.ts";

const ORG = "01a13253-ec1a-7604-8944-a06dd7633ce0";
const PROJECT = "01a1327d-b92a-7bd1-b34b-845a8d89c879";
const CONTROL = "01a13300-0000-7000-8000-000000000002";
const ITEM = "01a13300-0000-7000-8000-000000000009";
const IDS = { organization_id: ORG, project_id: PROJECT, control_id: CONTROL };
const BASE = `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}`;

function requirement(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: ITEM,
    phase: "INTERIM",
    key: "interim-population",
    title: "Every change in the window",
    description: "A complete list of every production change.",
    categories: ["POPULATION"],
    objective: "Test operation",
    attributes: [],
    rationale: "The sample is drawn from it.",
    necessity: "REQUIRED",
    period_label: "1 January 2026 to 30 September 2026",
    population_kind: "TRANSACTIONS",
    sample_selection: "",
    depends_on: null,
    depends_on_title: null,
    status: "REQUESTED",
    state: "RECEIVED",
    state_label: "Received, not yet reviewed",
    request_id: "r1",
    request_reference: "PBC-1A2B3C4D",
    request_recipient: "owner@client.example",
    sufficiency: "NOT_REVIEWED",
    sufficiency_note: "",
    sufficiency_by: null,
    waive_reason: "",
    origin: "RULES",
    person_edited: false,
    pending_change: null,
    needs_review: false,
    coverage_note: "",
    version: 2,
    ...over,
  };
}

function sample(): EvidencePlan {
  const plan = parsePlan({
    control_id: CONTROL,
    plan_id: "p1",
    status: "CHANGES_PROPOSED",
    source: "RULES",
    provisional: false,
    note: "",
    understanding: {
      summary: "A change approval control.",
      control_type: "POPULATION",
      missing_information: [],
      assumptions: ["Sample sizes follow the table."],
      exceptions: ["Process change on 15 November 2026"],
      approvals_required: ["Review the roll-forward approach."],
      process_understanding_needed: false,
    },
    generated_at: "2026-10-15T10:00:00Z",
    approved_by: "Dana Reviewer",
    pending_changes: 1,
    needs_review: 1,
    phases: [
      {
        phase: "ROLLFORWARD",
        applicability: "CONDITIONAL",
        rationale: "The rest of the period is not covered.",
        condition: "After interim sign-off.",
        state: "CONDITIONAL",
        state_label: "Planned; requests wait for a condition",
        requirements: [
          requirement({
            id: "rf1",
            phase: "ROLLFORWARD",
            key: "rollforward-population",
            state: "NOT_GENERATED",
            request_id: null,
            request_reference: null,
            request_recipient: null,
          }),
        ],
        requests: [],
        version: 1,
      },
      {
        phase: "DESIGN",
        applicability: "APPLICABLE",
        rationale: "Every in-scope control is assessed for design.",
        state: "OUTSTANDING",
        requirements: [
          requirement({
            id: "d1",
            phase: "DESIGN",
            key: "design-procedure",
            categories: ["PROCESS_DOCUMENTATION"],
            state: "SENT",
            request_recipient: "coordinator@client.example",
          }),
          requirement({
            id: "d2",
            phase: "DESIGN",
            key: "design-walkthrough",
            categories: ["CONTROL_EXECUTION"],
            state: "REMOVED",
          }),
        ],
        requests: [{ id: "r0", reference: "PBC-00000001", status: "SENT" }],
        version: 3,
      },
      {
        phase: "INTERIM",
        applicability: "APPLICABLE",
        rationale: "The control operates in the interim period.",
        state: "RECEIVED_NOT_VALIDATED",
        testing_complete: false,
        requirements: [
          requirement({}),
          requirement({
            id: "i2",
            key: "interim-sample-evidence",
            categories: ["SAMPLE", "CONTROL_EXECUTION"],
            state: "AWAITING_DEPENDENCY",
            depends_on: "interim-population",
            depends_on_title: "Every change in the window",
            request_id: null,
            request_reference: null,
            request_recipient: null,
            pending_change: {
              title: "Evidence for each selected change",
              description: "The ticket, test, and approvals.",
            },
          }),
        ],
        requests: [{ id: "r1", reference: "PBC-1A2B3C4D", status: "RECEIVED" }],
        version: 2,
      },
    ],
    changes: [
      {
        id: "c1",
        effective_on: "2026-11-15",
        kind: "PROCESS",
        description: "New approver",
      },
    ],
    runs: [
      {
        created_at: "2026-10-15T10:00:00Z",
        source: "RULES",
        note: "",
        changes: {
          added: ["a", "b"],
          updated: [],
          flagged: ["c"],
          removed: [],
        },
      },
    ],
    version: 4,
  });
  assert.ok(plan !== null);
  return plan;
}

describe("evidence plan", () => {
  it("parses every phase, in order, with its items and their states", () => {
    const plan = sample();
    assert.deepEqual(
      plan.phases.map((phase) => phase.phase),
      ["DESIGN", "INTERIM", "ROLLFORWARD"],
    );
    assert.equal(plan.status, "CHANGES_PROPOSED");
    assert.equal(plan.controlType, "POPULATION");
    assert.deepEqual(plan.exceptions, ["Process change on 15 November 2026"]);
    const interim = plan.phases[1];
    assert.ok(interim !== undefined);
    assert.equal(interim.state, "RECEIVED_NOT_VALIDATED");
    const waiting = interim.requirements[1];
    assert.ok(waiting !== undefined);
    assert.equal(waiting.state, "AWAITING_DEPENDENCY");
    assert.equal(waiting.dependsOnTitle, "Every change in the window");
    assert.deepEqual(waiting.pendingChange, {
      remove: false,
      title: "Evidence for each selected change",
      description: "The ticket, test, and approvals.",
    });
    assert.equal(plan.runs[0]?.added, 2);
    assert.equal(plan.runs[0]?.flagged, 1);
    assert.equal(plan.changes[0]?.kind, "PROCESS");
  });

  it("refuses what is not a plan and fills a phase the API left out", () => {
    assert.equal(parsePlan(null), null);
    // Whether it took effect on its own, and what waits for a person.
    const automatic = parsePlan({
      control_id: CONTROL,
      status: "APPROVED",
      phases: [],
      approved_automatically: true,
      attention: ["Missing: the population source", 3],
    });
    assert.equal(automatic?.approvedAutomatically, true);
    assert.deepEqual(automatic?.attention, ["Missing: the population source"]);
    assert.equal(
      parsePlan({ control_id: CONTROL, status: "APPROVED", phases: [] })
        ?.approvedAutomatically,
      false,
    );
    assert.equal(parsePlan({ status: "PROPOSED" }), null);
    const empty = parsePlan({ control_id: CONTROL, status: "NOT_PLANNED" });
    assert.ok(empty !== null);
    assert.deepEqual(
      empty.phases.map((phase) => [phase.phase, phase.state]),
      [
        ["DESIGN", "NOT_PLANNED"],
        ["INTERIM", "NOT_PLANNED"],
        ["ROLLFORWARD", "NOT_PLANNED"],
      ],
    );
  });

  it("explains every phase state so none reads as another", () => {
    const lines = PHASE_STATES.map((state) => PHASE_STATE_EXPLAINED[state]);
    assert.equal(new Set(lines).size, PHASE_STATES.length);
    assert.match(PHASE_STATE_EXPLAINED.NOT_APPLICABLE, /does not apply/);
    assert.match(PHASE_STATE_EXPLAINED.NOT_PLANNED, /not been planned/);
    assert.match(
      PHASE_STATE_EXPLAINED.EVIDENCE_ACCEPTED,
      /once its testing is/,
    );
  });

  it("never shows a phase done because of its requests", () => {
    assert.equal(stepStateOf("COMPLETE"), "done");
    assert.equal(stepStateOf("EVIDENCE_ACCEPTED"), "done");
    assert.equal(stepStateOf("RECEIVED_NOT_VALIDATED"), "active");
    assert.equal(stepStateOf("AWAITING_CLARIFICATION"), "issue");
    assert.equal(stepStateOf("NOT_APPLICABLE"), "todo");
    assert.equal(stepStateOf("CONDITIONAL"), "todo");
    assert.equal(stepStateOf("NOT_PLANNED"), "todo");
  });

  it("groups a phase's items by category and leaves removed ones out", () => {
    const plan = sample();
    const design = plan.phases[0];
    assert.ok(design !== undefined);
    assert.deepEqual(
      shownRequirements(design).map((item) => item.id),
      ["d1"],
    );
    const interim = plan.phases[1];
    assert.ok(interim !== undefined);
    assert.deepEqual(
      groupByCategory(interim.requirements).map((group) => [
        group.category,
        group.items.length,
      ]),
      [
        ["POPULATION", 1],
        ["SAMPLE", 1],
      ],
    );
  });

  it("filters every item by phase, category, status, and owner", () => {
    const plan = sample();
    assert.equal(filterRequirements(plan, NO_FILTER).length, 4);
    assert.deepEqual(
      filterRequirements(plan, { ...NO_FILTER, phase: "INTERIM" }).map(
        (item) => item.id,
      ),
      [ITEM, "i2"],
    );
    assert.deepEqual(
      filterRequirements(plan, {
        ...NO_FILTER,
        category: "CONTROL_EXECUTION",
      }).map((item) => item.id),
      ["i2"],
    );
    assert.deepEqual(
      filterRequirements(plan, { ...NO_FILTER, state: "NOT_GENERATED" }).map(
        (item) => item.id,
      ),
      ["rf1"],
    );
    assert.deepEqual(owners(plan), [
      "coordinator@client.example",
      "owner@client.example",
    ]);
    assert.deepEqual(
      filterRequirements(plan, {
        ...NO_FILTER,
        owner: "coordinator@client.example",
      }).map((item) => item.id),
      ["d1"],
    );
  });

  it("reads each request's phase, counting older requests as interim", () => {
    const requests = [
      { id: "a", status: "RECEIVED", phase: "DESIGN" },
      { id: "b", status: "SENT", phase: "INTERIM" },
      { id: "c", status: "DRAFT", phase: null },
      { id: "d", status: "CANCELLED", phase: "INTERIM" },
    ];
    assert.deepEqual(
      requestsOfPhase(requests, "INTERIM").map((item) => item.id),
      ["b", "c", "d"],
    );
    assert.deepEqual(requestProgress(requestsOfPhase(requests, "INTERIM")), {
      state: "active",
      note: "0 of 2 received",
    });
    assert.deepEqual(requestProgress(requestsOfPhase(requests, "DESIGN")), {
      state: "done",
      note: "1 of 1 received",
    });
    assert.deepEqual(requestProgress([]), {
      state: "todo",
      note: "No requests yet",
    });
    assert.equal(phaseOfTab("rollforward"), "ROLLFORWARD");
    assert.equal(phaseOfTab("review"), null);
  });
});

describe("evidence plan actions", () => {
  it("builds each call, and refuses what the API would refuse", () => {
    assert.deepEqual(planWrite({ ...IDS, intent: "generate" }), {
      intent: "generate",
      path: `${BASE}/evidence-plan/generate`,
      body: {},
      slow: true,
    });
    assert.deepEqual(planWrite({ ...IDS, intent: "approve", version: 4 }), {
      intent: "approve",
      path: `${BASE}/evidence-plan/approve`,
      body: { version: 4 },
      slow: false,
    });
    const notApplicable = planWrite({
      ...IDS,
      intent: "phase",
      phase: "ROLLFORWARD",
      applicability: "NOT_APPLICABLE",
      rationale: "Too short",
      version: 1,
    });
    assert.deepEqual(notApplicable, { error: "invalid" });
    const decided = planWrite({
      ...IDS,
      intent: "phase",
      phase: "ROLLFORWARD",
      applicability: "PENDING",
      rationale: "We need the client's answer first.",
      open_question: "Was the control replaced in November?",
      version: 2,
    });
    assert.ok(!("error" in decided));
    assert.equal(decided.path, `${BASE}/evidence-plan/phases/ROLLFORWARD`);
    assert.deepEqual(
      planWrite({
        ...IDS,
        intent: "phase",
        phase: "INTERIM",
        applicability: "CONDITIONAL",
        rationale: "Only after the system goes live.",
        version: 2,
      }),
      { error: "invalid" },
    );
    // Judging what arrived: a shortfall needs a note.
    assert.deepEqual(
      planWrite({
        ...IDS,
        intent: "sufficiency",
        requirement_id: ITEM,
        sufficiency: "INSUFFICIENT",
        version: 2,
      }),
      { error: "invalid" },
    );
    const accepted = planWrite({
      ...IDS,
      intent: "sufficiency",
      requirement_id: ITEM,
      sufficiency: "ACCEPTED",
      version: 2,
    });
    assert.ok(!("error" in accepted));
    assert.equal(
      accepted.path,
      `${BASE}/evidence-requirements/${ITEM}/sufficiency`,
    );
    assert.deepEqual(
      planWrite({
        ...IDS,
        intent: "waive",
        requirement_id: ITEM,
        reason: "password: hunter22",
        version: 2,
      }),
      { error: "invalid" },
    );
    assert.deepEqual(
      planWrite({
        ...IDS,
        intent: "change",
        requirement_id: ITEM,
        decision: "MAYBE",
        version: 2,
      }),
      { error: "invalid" },
    );
    const change = planWrite({
      ...IDS,
      intent: "control-change",
      kind: "CONFIGURATION",
      effective_on: "2026-11-15",
      description: "MFA moved to a new provider",
    });
    assert.ok(!("error" in change));
    assert.equal(change.path, `${BASE}/control-changes`);
    assert.deepEqual(
      planWrite({ ...IDS, control_id: "nope", intent: "generate" }),
      { error: "invalid" },
    );
    assert.deepEqual(planWrite({ ...IDS, intent: "delete" }), {
      error: "invalid",
    });
  });

  it("says what went wrong in words a person can act on", () => {
    assert.equal(planProblem(200), null);
    assert.match(
      planProblem(
        409,
        "missing evidence is not a reason a phase does not apply",
      ) ?? "",
      /Missing evidence is not a reason/,
    );
    assert.match(
      planProblem(409, "nothing has been received for this requirement yet") ??
        "",
      /Nothing has arrived/,
    );
    assert.match(planProblem(409, "other") ?? "", /changed while you were/);
    assert.match(planProblem(403) ?? "", /role/);
  });

  it("has a route for the calls the plan panel makes", () => {
    const view = readFileSync(
      new URL("../apps/web/src/evidence-plan-view.tsx", import.meta.url),
      "utf8",
    );
    assert.match(view, /fetch\("\/workspace\/evidence-plan"/);
    const route = new URL(
      "../apps/web/app/workspace/evidence-plan/route.ts",
      import.meta.url,
    );
    assert.ok(existsSync(route));
    assert.match(readFileSync(route, "utf8"), /export async function POST/);
  });
});

describe("a plan that waits for approval", () => {
  it("knows when the plan waits for a person", () => {
    assert.equal(planAwaitsApproval({ status: "PROPOSED" }), true);
    assert.equal(planAwaitsApproval({ status: "CHANGES_PROPOSED" }), true);
    assert.equal(planAwaitsApproval({ status: "APPROVED" }), false);
    assert.equal(planAwaitsApproval(null), false);
  });

  it("shows its items as proposed, never as a request's progress", () => {
    for (const state of [
      "NOT_GENERATED",
      "DRAFT",
      "READY_FOR_REVIEW",
      "APPROVAL_PENDING",
    ] as const) {
      assert.equal(requirementStatus(state, true).label, "Proposed");
    }
    // Once approved, the item reads as its request's progress.
    assert.equal(
      requirementStatus("READY_FOR_REVIEW", false).label,
      "Ready for review",
    );
    // What already happened is never hidden by the proposal.
    assert.equal(requirementStatus("ACCEPTED", true).label, "Accepted");
    assert.equal(
      requirementStatus("NOT_APPLICABLE", true).label,
      "Not applicable",
    );
  });
});

describe("master test plan review", () => {
  it("reads a plan returned for changes as waiting for a person", () => {
    const plan = parsePlan({
      control_id: CONTROL,
      status: "CHANGES_REQUESTED",
      revision: 4,
      approved_revision: 3,
      pending_revision: true,
      phases: [],
    });
    assert.ok(plan !== null);
    assert.equal(plan.status, "CHANGES_REQUESTED");
    assert.equal(plan.revision, 4);
    assert.equal(plan.approvedRevision, 3);
    assert.equal(plan.pendingRevision, true);
    assert.equal(planAwaitsApproval(plan), true);
    const fresh = parsePlan({
      control_id: CONTROL,
      status: "PROPOSED",
      phases: [],
    });
    assert.ok(fresh !== null);
    assert.equal(fresh.approvedRevision, null);
    assert.equal(fresh.pendingRevision, false);
  });

  it("checks the reviewer's and the preparer's actions before they are sent", () => {
    assert.deepEqual(
      planWrite({
        ...IDS,
        intent: "request-changes",
        version: 5,
        comment: "Add the timeliness procedure.",
      }),
      {
        intent: "request-changes",
        path: `${BASE}/evidence-plan/request-changes`,
        body: { version: 5, comment: "Add the timeliness procedure." },
        slow: false,
      },
    );
    // A return needs a comment that stands on its own.
    assert.deepEqual(
      planWrite({
        ...IDS,
        intent: "request-changes",
        version: 5,
        comment: "No",
      }),
      { error: "invalid" },
    );
    assert.deepEqual(
      planWrite({ ...IDS, intent: "submit", version: 5, note: "" }),
      {
        intent: "submit",
        path: `${BASE}/evidence-plan/submit`,
        body: { version: 5, note: "" },
        slow: false,
      },
    );
    assert.deepEqual(
      planWrite({ ...IDS, intent: "submit", version: 5, note: "password: x1" }),
      { error: "invalid" },
    );
    assert.deepEqual(
      planWrite({ ...IDS, intent: "revision", version: 2, decision: "ACCEPT" }),
      {
        intent: "revision",
        path: `${BASE}/evidence-plan/pending-revision`,
        body: { version: 2, decision: "ACCEPT" },
        slow: false,
      },
    );
    assert.deepEqual(
      planWrite({ ...IDS, intent: "revision", version: 2, decision: "MAYBE" }),
      { error: "invalid" },
    );
  });

  it("says what holds an approval in the API's own words", () => {
    assert.equal(
      planProblem(409, "1 proposed attribute waits for a decision."),
      "1 proposed attribute waits for a decision.",
    );
    assert.equal(
      planProblem(409, "The planner is still drafting the plan."),
      "The planner is still drafting the plan.",
    );
    assert.equal(
      planProblem(409, "the plan changed"),
      "This changed while you were working. Refresh and try again.",
    );
    assert.equal(
      planProblem(403),
      "Your role cannot change this control's plan.",
    );
  });
});
