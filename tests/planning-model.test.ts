import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";

import {
  approvalHeldBy,
  factTitle,
  filterQueue,
  findingsByCode,
  type MasterPlan,
  neighbours,
  parseMasterPlan,
  parsePhaseProgress,
  parseQueue,
  phaseStatus,
  planningHref,
  planningProblem,
  planningWrite,
  related,
  releasable,
  releaseIsEarly,
  statementParts,
  TAB_LABELS,
  tabCounts,
  tabOfCode,
} from "../apps/web/src/planning-model.ts";

const ORG = "01a13253-ec1a-7604-8944-a06dd7633ce0";
const PROJECT = "01a1327d-b92a-7bd1-b34b-845a8d89c879";
const CONTROL = "01a13300-0000-7000-8000-000000000002";
const OTHER = "01a13300-0000-7000-8000-000000000003";
const ITEM = "01a13300-0000-7000-8000-000000000009";
const IDS = { organization_id: ORG, project_id: PROJECT };
const BASE = `/organizations/${ORG}/projects/${PROJECT}`;

function plan(overrides: Record<string, unknown> = {}): MasterPlan {
  const parsed = parseMasterPlan({
    control_id: CONTROL,
    plan_id: ITEM,
    control: { control_ref: "ITGC-AC-01", title: "New access is approved" },
    state: "DRAFT_READY",
    status: "PROPOSED",
    revision: 3,
    approved_revision: null,
    version: 7,
    understanding: { summary: "A summary." },
    facts: [
      {
        field: "FREQUENCY",
        label: "Frequency",
        value: "Event driven",
        basis: "SOURCE",
      },
      {
        field: "PERFORMER",
        label: "Performed by",
        value: "",
        basis: "MISSING",
        question: "Who?",
      },
    ],
    procedures: [
      {
        id: ITEM,
        code: "D1",
        phase: "DESIGN",
        text: "Walk one through.",
        attribute_codes: [],
        evidence_codes: ["E1"],
      },
      {
        id: ITEM,
        code: "I1",
        phase: "INTERIM",
        text: "Test each item.",
        attribute_codes: ["A1", "A2"],
        evidence_codes: ["E2"],
        method: "INSPECTION",
      },
    ],
    attributes: [
      {
        id: ITEM,
        code: "A1",
        text: "Approved",
        procedure_codes: ["I1"],
        evidence_codes: ["E2"],
        criteria_source: "LIBRARY",
      },
      {
        id: ITEM,
        code: "A2",
        text: "By an approver",
        procedure_codes: ["I1"],
        evidence_codes: [],
        criteria_source: "WHAT",
      },
    ],
    evidence: [
      {
        id: ITEM,
        code: "E1",
        phase: "DESIGN",
        title: "Procedure",
        attribute_codes: [],
        procedure_codes: ["D1"],
      },
      {
        id: ITEM,
        code: "E2",
        phase: "INTERIM",
        title: "Population",
        attribute_codes: ["A1"],
        procedure_codes: ["I1"],
      },
    ],
    findings: [
      {
        kind: "ATTRIBUTE_WITHOUT_EVIDENCE",
        code: "A2",
        detail: "A2 has no evidence.",
      },
    ],
    blockers: [],
    decisions: [],
    ...overrides,
  });
  assert.ok(parsed !== null);
  return parsed;
}

describe("the master test plan", () => {
  it("parses the four sections, their codes, and what each links to", () => {
    const found = plan();
    assert.equal(found.control.controlRef, "ITGC-AC-01");
    assert.equal(found.facts[1]?.basis, "MISSING");
    assert.equal(found.procedures[1]?.method, "INSPECTION");
    // An unknown criteria source is read as not stated, never as a person's.
    assert.equal(found.attributes[1]?.criteriaSource, "NONE");
    assert.equal(parseMasterPlan(null), null);
    assert.equal(parseMasterPlan({ state: "APPROVED" }), null);
  });

  it("never reads an unknown state as approved", () => {
    assert.equal(plan({ state: "SOMETHING_NEW" }).state, "NEEDS_CLARIFICATION");
  });

  it("traces an item to what it links to across the sections", () => {
    const found = plan();
    assert.deepEqual([...related(found, "I1")].sort(), ["A1", "A2", "E2"]);
    assert.deepEqual([...related(found, "A1")].sort(), ["E2", "I1"]);
    assert.deepEqual([...related(found, "E1")].sort(), ["D1"]);
    assert.equal(related(found, "X9").size, 0);
    assert.equal(tabOfCode("A12"), "attributes");
    assert.equal(tabOfCode("E3"), "evidence");
    assert.equal(tabOfCode("R2"), "procedures");
    assert.equal(tabOfCode("Z1"), null);
  });

  it("counts each section and what in it needs a look", () => {
    const counts = tabCounts(plan());
    assert.deepEqual(counts.understanding, { items: 2, attention: 1 });
    assert.deepEqual(counts.attributes, { items: 2, attention: 1 });
    assert.deepEqual(counts.procedures, { items: 2, attention: 0 });
    assert.equal(findingsByCode(plan()).get("A2")?.length, 1);
  });

  it("labels the review in short words a reviewer can scan", () => {
    assert.equal(TAB_LABELS.understanding, "Understanding");
    assert.equal(
      factTitle("DESCRIPTION", "Description and operation"),
      "How it operates",
    );
    assert.equal(factTitle("UNKNOWN", "As sent"), "As sent");
    assert.deepEqual(
      statementParts(
        "Active Directory enforces [the information security policy].",
      ),
      [
        { text: "Active Directory enforces ", placeholder: false, at: 0 },
        {
          text: "[the information security policy]",
          placeholder: true,
          at: 26,
        },
        { text: ".", placeholder: false, at: 59 },
      ],
    );
    assert.deepEqual(statementParts(""), [
      { text: "", placeholder: false, at: 0 },
    ]);
  });

  it("says what holds approval, from the API's own blockers", () => {
    assert.equal(approvalHeldBy(plan()), null);
    assert.equal(
      approvalHeldBy(
        plan({
          blockers: [
            {
              kind: "CLARIFICATION",
              detail: "Who performs it?",
              blocks: false,
            },
            {
              kind: "CLARIFICATION",
              detail: "1 proposed attribute waits for a decision.",
              blocks: true,
            },
          ],
        }),
      ),
      "1 proposed attribute waits for a decision.",
    );
    assert.equal(
      approvalHeldBy(plan({ plan_id: null })),
      "The control has no test plan yet.",
    );
  });
});

describe("the planning review queue", () => {
  const queue = parseQueue({
    total: 3,
    counts: { DRAFT_READY: 1, APPROVED: 1, NEEDS_CLARIFICATION: 1 },
    controls: [
      {
        control_id: CONTROL,
        control_ref: "ITGC-AC-01",
        title: "Access",
        state: "DRAFT_READY",
        approvable: true,
        version: 4,
      },
      {
        control_id: OTHER,
        control_ref: "ITGC-AC-02",
        title: "Removal",
        application: "SAP",
        state: "APPROVED",
      },
      {
        control_id: ITEM,
        control_ref: "ITGC-CM-01",
        title: "Changes",
        state: "NEEDS_CLARIFICATION",
      },
    ],
    next_control_id: CONTROL,
    viewer_can_decide: true,
  });

  it("parses every control, its state, and whether it can be approved now", () => {
    assert.ok(queue !== null);
    assert.equal(queue.counts.DRAFT_READY, 1);
    assert.equal(queue.counts.CHANGES_REQUESTED, 0);
    assert.equal(queue.controls[0]?.approvable, true);
    assert.equal(queue.controls[1]?.approvable, false);
    assert.equal(queue.viewerCanDecide, true);
    assert.equal(parseQueue({}), null);
  });

  it("filters by state and search", () => {
    assert.ok(queue !== null);
    assert.equal(filterQueue(queue.controls, [], "").length, 3);
    assert.deepEqual(
      filterQueue(queue.controls, ["APPROVED"], "").map(
        (row) => row.controlRef,
      ),
      ["ITGC-AC-02"],
    );
    assert.deepEqual(
      filterQueue(queue.controls, [], "sap").map((row) => row.controlRef),
      ["ITGC-AC-02"],
    );
  });

  it("finds the previous, next, and next waiting control", () => {
    assert.ok(queue !== null);
    const place = neighbours(queue, OTHER);
    assert.equal(place.previous, CONTROL);
    assert.equal(place.next, ITEM);
    // The next one waiting for review after it, wrapping round.
    assert.equal(place.nextPending, ITEM);
    assert.equal(neighbours(queue, CONTROL).previous, null);
  });

  it("links to the queue and to one control's plan", () => {
    assert.equal(
      planningHref(ORG, PROJECT, { control: CONTROL, tab: "evidence" }),
      `/?organization=${ORG}&project=${PROJECT}&section=planning&control=${CONTROL}&tab=evidence`,
    );
    assert.equal(
      planningHref(ORG, PROJECT, { filter: "APPROVED" }),
      `/?organization=${ORG}&project=${PROJECT}&section=planning&filter=APPROVED`,
    );
  });
});

describe("test plan actions", () => {
  it("builds each call and refuses what the API would refuse", () => {
    assert.deepEqual(
      planningWrite({
        ...IDS,
        intent: "approve",
        control_id: CONTROL,
        version: 7,
        comment: "",
      }),
      {
        intent: "approve",
        method: "POST",
        path: `${BASE}/controls/${CONTROL}/evidence-plan/approve`,
        body: { version: 7, comment: "" },
        slow: false,
      },
    );
    assert.deepEqual(
      planningWrite({
        ...IDS,
        intent: "request-changes",
        control_id: CONTROL,
        version: 7,
        comment: "No",
      }),
      { error: "invalid" },
    );
    const links = planningWrite({
      ...IDS,
      intent: "procedure-links",
      control_id: CONTROL,
      procedure_id: ITEM,
      attribute_ids: [OTHER, OTHER],
    });
    assert.ok(!("error" in links));
    assert.equal(links.method, "PUT");
    assert.deepEqual(links.body, { attribute_ids: [OTHER] });
    assert.deepEqual(
      planningWrite({
        ...IDS,
        intent: "procedure-links",
        control_id: CONTROL,
        procedure_id: ITEM,
        attribute_ids: ["x"],
      }),
      { error: "invalid" },
    );
    assert.deepEqual(
      planningWrite({
        ...IDS,
        intent: "procedure-add",
        control_id: CONTROL,
        phase: "INTERIM",
        text: "Short",
        method: "",
        attribute_ids: [],
      }),
      { error: "invalid" },
    );
    assert.deepEqual(
      planningWrite({
        ...IDS,
        intent: "procedure-edit",
        control_id: CONTROL,
        procedure_id: ITEM,
        version: 2,
        text: "Use password: hunter2 to inspect the setting.",
        method: "",
      }),
      { error: "invalid" },
    );
    const wording = planningWrite({
      ...IDS,
      intent: "evidence-edit",
      control_id: CONTROL,
      requirement_id: ITEM,
      version: 4,
      title: "Password configuration",
      description:
        "The configured password settings for every interactive sign-in.",
    });
    assert.ok(!("error" in wording));
    assert.equal(
      wording.path,
      `${BASE}/controls/${CONTROL}/evidence-requirements/${ITEM}/edit`,
    );
    assert.deepEqual(
      planningWrite({
        ...IDS,
        intent: "evidence-edit",
        control_id: CONTROL,
        requirement_id: ITEM,
        version: 4,
        title: "Ok",
        description: "Too short",
      }),
      { error: "invalid" },
    );
    const criteria = planningWrite({
      ...IDS,
      intent: "criteria",
      control_id: CONTROL,
      attribute_id: ITEM,
      version: 1,
      objective: "",
      condition: "Approved before granted.",
      pass_criteria: "Approval date on or before the grant.",
      fail_criteria: "No approval, or after the grant.",
      judgment_required: false,
      automatable: null,
      phases: ["INTERIM", "BOGUS"],
    });
    assert.ok(!("error" in criteria));
    assert.deepEqual(criteria.body.phases, ["INTERIM"]);
    assert.deepEqual(
      planningWrite({
        ...IDS,
        intent: "criteria",
        control_id: CONTROL,
        attribute_id: ITEM,
        version: 1,
        judgment_required: "yes",
      }),
      { error: "invalid" },
    );
  });

  it("approves only plans named one by one, each with its version", () => {
    const batch = planningWrite({
      ...IDS,
      intent: "batch-approve",
      comment: "",
      items: [
        { control_id: CONTROL, version: 4 },
        { control_id: OTHER, version: 2 },
      ],
    });
    assert.ok(!("error" in batch));
    assert.equal(batch.path, `${BASE}/planning-review/approve`);
    assert.deepEqual(
      planningWrite({ ...IDS, intent: "batch-approve", items: [] }),
      { error: "invalid" },
    );
    // A plan without its version is never approved with the others.
    assert.deepEqual(
      planningWrite({
        ...IDS,
        intent: "batch-approve",
        items: [{ control_id: CONTROL }],
      }),
      { error: "invalid" },
    );
    const replan = planningWrite({ ...IDS, intent: "replan" });
    assert.ok(!("error" in replan));
    assert.equal(replan.slow, true);
    assert.deepEqual(planningWrite({ intent: "replan" }), { error: "invalid" });
  });

  it("says what went wrong in words a person can act on", () => {
    assert.equal(planningProblem(200), null);
    assert.equal(
      planningProblem(409, "1 proposed attribute waits for a decision."),
      "1 proposed attribute waits for a decision.",
    );
    assert.match(planningProblem(409, "the plan changed") ?? "", /Refresh/);
    assert.match(
      planningProblem(409, "the request carrying it has gone for approval") ??
        "",
      /locked/,
    );
    assert.match(planningProblem(403) ?? "", /approves test plans/);
    assert.match(planningProblem(422) ?? "", /ten characters/);
  });

  it("has a route for the calls the page makes", () => {
    assert.ok(existsSync("apps/web/app/workspace/planning/route.ts"));
  });
});

describe("phase release", () => {
  const progress = parsePhaseProgress({
    controls: [
      {
        control_id: CONTROL,
        control_ref: "ITGC-AC-01",
        title: "Access",
        plan_status: "APPROVED",
        phases: [
          { phase: "DESIGN", step: "COMPLETE", step_label: "Complete" },
          { phase: "INTERIM", step: "READY", step_label: "Ready to release" },
          {
            phase: "ROLLFORWARD",
            step: "WAITING",
            waiting_for: "Interim testing is not signed off.",
          },
        ],
      },
    ],
    ready: { INTERIM: 1, ROLLFORWARD: 0 },
    released: { INTERIM: 0 },
    recommendation:
      "Design and implementation testing has been completed for 1 control.",
    viewer_can_release: true,
  });

  it("reads each control's phases and what is ready", () => {
    assert.ok(progress !== null);
    assert.equal(progress.ready.INTERIM, 1);
    assert.equal(progress.released.ROLLFORWARD, 0);
    assert.equal(progress.viewerCanRelease, true);
    assert.equal(parsePhaseProgress({}), null);
    const row = progress.controls[0];
    const interim = phaseStatus(row, "INTERIM");
    const roll = phaseStatus(row, "ROLLFORWARD");
    assert.ok(interim !== null && roll !== null);
    assert.equal(releasable(interim), true);
    assert.equal(releaseIsEarly(interim), false);
    // Waiting for interim testing: it can be released, early, with a reason.
    assert.equal(releasable(roll), true);
    assert.equal(releaseIsEarly(roll), true);
    // Design follows the plan's approval: it is never released by hand.
    assert.equal(releasable(phaseStatus(row, "DESIGN")), false);
  });

  it("builds the release calls, and refuses what the API would refuse", () => {
    const one = planningWrite({
      ...IDS,
      intent: "phase-release",
      control_id: CONTROL,
      phase: "INTERIM",
      reason: "",
    });
    assert.ok(!("error" in one));
    assert.equal(
      one.path,
      `${BASE}/controls/${CONTROL}/phases/INTERIM/release`,
    );
    assert.deepEqual(
      planningWrite({
        ...IDS,
        intent: "phase-release",
        control_id: CONTROL,
        phase: "DESIGN",
        reason: "",
      }),
      { error: "invalid" },
    );
    const many = planningWrite({
      ...IDS,
      intent: "phase-release-batch",
      phase: "ROLLFORWARD",
      control_ids: [CONTROL, OTHER, CONTROL],
      reason: "Agreed with the client to run both together.",
    });
    assert.ok(!("error" in many));
    assert.deepEqual(many.body.control_ids, [CONTROL, OTHER]);
    assert.deepEqual(
      planningWrite({
        ...IDS,
        intent: "phase-release-batch",
        phase: "INTERIM",
        control_ids: ["x"],
      }),
      { error: "invalid" },
    );
    assert.equal(
      planningHref(ORG, PROJECT, { view: "phases" }),
      `/?organization=${ORG}&project=${PROJECT}&section=planning&view=phases`,
    );
  });
});
