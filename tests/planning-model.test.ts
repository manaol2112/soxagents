import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";

import {
  answeredValues,
  approvalHeldBy,
  type Blocker,
  basisWords,
  changesSummary,
  decisionWords,
  describeQuestions,
  factTitle,
  filledLine,
  filterOptions,
  filterQueue,
  findingFix,
  findingsByCode,
  groupChanges,
  heldStep,
  holdGroups,
  holdHref,
  type MasterPlan,
  missingValueOf,
  NO_FILTERS,
  neighbours,
  nextRelease,
  nextStepOf,
  openValueFor,
  otherSystems,
  type PhaseStatus,
  parseMasterPlan,
  parsePhaseProgress,
  parseQueue,
  phaseNote,
  phaseStatus,
  planningHref,
  planningProblem,
  planningWrite,
  planQuestions,
  type QueueRow,
  questionsToSave,
  related,
  releasable,
  releaseIsEarly,
  standardStepsHref,
  statementParts,
  TAB_LABELS,
  tabCounts,
  tabOfCode,
  type ValueQuestion,
  valueQuestions,
  valuesItems,
} from "../apps/web/src/planning-model.ts";
import {
  joinAnswers,
  readAnswer,
  toggleSuggestion,
} from "../apps/web/src/value-suggestions.ts";

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
      `/?organization=${ORG}&project=${PROJECT}&section=testing&control=${CONTROL}&tab=evidence`,
    );
    assert.equal(
      planningHref(ORG, PROJECT, { filter: "APPROVED" }),
      `/?organization=${ORG}&project=${PROJECT}&section=testing&filter=APPROVED`,
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

  it("sends a group decision, a scope unit, coverage and a split only when well formed", () => {
    const hash = "b".repeat(64);
    const family = planningWrite({
      ...IDS,
      intent: "approve-family",
      control_ref: "ITGC-AC-01",
      items: [
        { control_id: CONTROL, version: 4 },
        { control_id: OTHER, version: 2 },
      ],
      presented_hash: hash,
      comment: "",
    });
    assert.ok(!("error" in family));
    assert.equal(family.path, `${BASE}/planning-review/families/approve`);
    assert.deepEqual(
      planningWrite({
        ...IDS,
        intent: "approve-family",
        control_ref: "ITGC-AC-01",
        items: [{ control_id: CONTROL, version: 4 }],
        presented_hash: "stale",
      }),
      { error: "invalid" },
    );
    const unit = planningWrite({
      ...IDS,
      intent: "scope-unit-add",
      kind: "SERVICE_CENTER",
      name: "  Krakow SSC ",
    });
    assert.ok(!("error" in unit));
    assert.equal(unit.path, `${BASE}/scope-units`);
    assert.deepEqual(unit.body, { kind: "SERVICE_CENTER", name: "Krakow SSC" });
    assert.deepEqual(
      planningWrite({
        ...IDS,
        intent: "scope-unit-add",
        kind: "PLANET",
        name: "x",
      }),
      { error: "invalid" },
    );
    const coverage = planningWrite({
      ...IDS,
      intent: "coverage",
      control_id: CONTROL,
      unit_ids: [OTHER, OTHER],
    });
    assert.ok(!("error" in coverage));
    assert.equal(coverage.path, `${BASE}/controls/${CONTROL}/coverage`);
    assert.deepEqual(coverage.body, { unit_ids: [OTHER] });
    // Covering nothing is allowed: a central control may name no unit it covers.
    assert.ok(
      !(
        "error" in
        planningWrite({
          ...IDS,
          intent: "coverage",
          control_id: CONTROL,
          unit_ids: [],
        })
      ),
    );
    const split = planningWrite({
      ...IDS,
      intent: "split",
      control_id: CONTROL,
      unit_ids: [CONTROL, OTHER],
      reason: "Each entity runs its own close.",
    });
    assert.ok(!("error" in split));
    assert.equal(split.path, `${BASE}/controls/${CONTROL}/split`);
    assert.equal(split.slow, true);
    // A split needs two units and a reason; it is never made on one unit or none.
    for (const fields of [
      { unit_ids: [OTHER], reason: "Each entity runs its own close." },
      { unit_ids: [CONTROL, OTHER], reason: "short" },
      { unit_ids: [CONTROL, "x"], reason: "Each entity runs its own close." },
    ]) {
      assert.deepEqual(
        planningWrite({
          ...IDS,
          intent: "split",
          control_id: CONTROL,
          ...fields,
        }),
        { error: "invalid" },
      );
    }
    assert.equal(
      planningHref(ORG, PROJECT, { view: "each" }),
      `/?organization=${ORG}&project=${PROJECT}&section=testing&view=each`,
    );
    assert.equal(
      planningHref(ORG, PROJECT, { view: "plans" }),
      `/?organization=${ORG}&project=${PROJECT}&section=testing`,
    );
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
      `/?organization=${ORG}&project=${PROJECT}&section=testing&view=phases`,
    );
  });
});

describe("the evidence release strip", () => {
  const status = (
    phase: "DESIGN" | "INTERIM" | "ROLLFORWARD",
    step: PhaseStatus["step"],
    extra: Partial<PhaseStatus> = {},
  ): PhaseStatus => ({
    phase,
    label: phase,
    applicability: "APPLICABLE",
    complete: step === "COMPLETE",
    step,
    stepLabel:
      step === "RELEASED"
        ? "Released"
        : step === "READY"
          ? "Ready to release"
          : step === "WAITING"
            ? "Waiting for the earlier phase"
            : step,
    releasedBy: null,
    releasedAt: null,
    early: false,
    reason: "",
    waitingFor: "",
    ...extra,
  });

  it("offers the first phase that can be released, in the audit's order", () => {
    assert.equal(
      nextRelease([
        status("DESIGN", "RELEASED"),
        status("INTERIM", "WAITING"),
        status("ROLLFORWARD", "WAITING"),
      ])?.phase,
      "INTERIM",
    );
    assert.equal(
      nextRelease([
        status("DESIGN", "RELEASED"),
        status("INTERIM", "RELEASED"),
        status("ROLLFORWARD", "READY"),
      ])?.phase,
      "ROLLFORWARD",
    );
    assert.equal(
      nextRelease([
        status("DESIGN", "RELEASED"),
        status("INTERIM", "COMPLETE"),
        status("ROLLFORWARD", "NOT_APPLICABLE"),
      ]),
      null,
    );
  });

  it("says where a phase stands in plain words", () => {
    assert.equal(phaseNote(status("DESIGN", "RELEASED")), "Released");
    assert.equal(
      phaseNote(status("INTERIM", "RELEASED", { early: true })),
      "Released early",
    );
    assert.equal(
      phaseNote(
        status("INTERIM", "WAITING", {
          waitingFor: "Waits for design testing to be prepared.",
        }),
      ),
      "Waits for design testing to be prepared.",
    );
    assert.equal(
      phaseNote(status("ROLLFORWARD", "WAITING")),
      "Waiting for the earlier phase",
    );
    assert.equal(phaseNote(status("INTERIM", "READY")), "Ready to release");
  });
});

describe("what holds approval, as work", () => {
  const blocker = (
    detail: string,
    blocks: boolean,
    resolve: Blocker["resolve"],
  ): Blocker => ({
    kind: "CLARIFICATION",
    detail,
    blocks,
    resolve,
    target: "",
  });

  it("gathers the blockers by where each is resolved, what holds approval first", () => {
    const groups = holdGroups([
      blocker("Performed by: who performs it?", false, "VALUES"),
      blocker("1 proposed attribute waits for a decision.", true, "ATTRIBUTES"),
      blocker("Control design to confirm: …", true, "ATTRIBUTES"),
      blocker(
        "The client's value for the roles is not recorded.",
        false,
        "VALUES",
      ),
    ]);
    assert.deepEqual(
      groups.map((group) => [group.resolve, group.blocks, group.items.length]),
      [
        ["ATTRIBUTES", true, 2],
        ["VALUES", false, 2],
      ],
    );
    assert.equal(groups[0]?.title, "Settle the control's attributes");
    assert.equal(groups[0]?.action, "Open the attributes");
    assert.deepEqual(holdGroups([]), []);
  });

  it("opens the place on the control's record where each is resolved", () => {
    const ids = { organizationId: "o", projectId: "p" };
    assert.equal(
      holdHref(ids, "c", "ATTRIBUTES"),
      "/?organization=o&project=p&section=controls&control=c&tab=design#step-definition-and-attributes",
    );
    assert.equal(
      holdHref(ids, "c", "VALUES"),
      "/?organization=o&project=p&section=controls&control=c&tab=design#step-control-statement",
    );
    assert.equal(
      holdHref(ids, "c", "PHASES"),
      "/?organization=o&project=p&section=controls&control=c&tab=evidence&ev=plan",
    );
    // The revision is decided on the review itself; the planner's drafting is waited on.
    assert.equal(holdHref(ids, "c", "REVISION"), null);
    assert.equal(holdHref(ids, "c", "WAIT"), null);
  });

  it("reads a blocker's place, and treats an unknown one as the understanding", () => {
    const plan = parseMasterPlan({
      control_id: "c1",
      blockers: [
        {
          kind: "CLARIFICATION",
          detail: "A",
          blocks: true,
          resolve: "PROCESS",
        },
        {
          kind: "CLARIFICATION",
          detail: "B",
          blocks: false,
          resolve: "SOMEWHERE",
        },
      ],
    });
    assert.deepEqual(
      plan?.blockers.map((item) => item.resolve),
      ["PROCESS", "UNDERSTANDING"],
    );
  });
});

describe("a plan that follows a standard pending review", () => {
  it("links the hold to the standard on the Library", () => {
    const ids = { organizationId: "o", projectId: "p" };
    assert.equal(
      holdHref(ids, "c", "LIBRARY", "access-termination"),
      "/?organization=o&section=library&project=p&control=access-termination",
    );
    assert.equal(holdHref(ids, "c", "LIBRARY"), null);
    const groups = holdGroups([
      {
        kind: "CLARIFICATION",
        detail: "The standard ITGC-AC-02 this plan follows is pending review.",
        blocks: false,
        resolve: "LIBRARY",
        target: "access-termination",
      },
    ]);
    assert.equal(groups[0]?.target, "access-termination");
    assert.equal(groups[0]?.action, "Open the standard");
  });

  it("names the plan's basis for the review header", () => {
    const control = {
      controlRef: "X",
      title: "",
      description: "",
      risk: "",
      frequency: "",
      nature: "",
      area: "",
      keyControl: false,
      application: "",
      classifications: [],
      source: "UPLOAD",
      testBasis: "STANDARD",
      libraryKey: "access-termination",
      libraryRef: "ITGC-AC-02",
      libraryStatus: "PENDING_REVIEW",
    };
    assert.equal(basisWords(control), "Standard ITGC-AC-02");
    assert.equal(
      basisWords({ ...control, testBasis: "CUSTOM" }),
      "Customized standard ITGC-AC-02",
    );
    assert.equal(
      basisWords({ ...control, testBasis: "CLIENT" }),
      "Client's own procedures",
    );
    assert.equal(
      basisWords({ ...control, testBasis: "CLIENT", source: "LIBRARY" }),
      "Client's procedures",
    );
  });
});

describe("the standard's steps behind a plan row", () => {
  it("opens the standard's procedure on the Library at its steps", () => {
    const href = standardStepsHref(ORG, PROJECT, "access-termination", "d-1");
    assert.ok(href.startsWith("/?"));
    assert.match(href, /section=library/);
    assert.match(href, /control=access-termination/);
    // Procedures is the Library's first tab, so the address does not name it.
    assert.doesNotMatch(href, /tab=/);
    assert.ok(href.endsWith("#lb-proc-d-1"));
  });

  it("reads which standard procedure a plan row follows", () => {
    const row = {
      id: ITEM,
      code: "I3",
      phase: "INTERIM",
      text: "Test each selected item.",
      method: null,
      origin: "RULES",
      person_edited: false,
      attribute_ids: [],
      attribute_codes: [],
      evidence_codes: [],
      version: 1,
    };
    const parsed = plan({
      procedures: [
        { ...row, standard_key: "o-3" },
        { ...row, id: OTHER, code: "I9" },
      ],
    });
    assert.equal(parsed.procedures[0]?.standardKey, "o-3");
    assert.equal(parsed.procedures[1]?.standardKey, "");
  });
});

describe("filtering the plan queue", () => {
  const row = (fields: Record<string, unknown>) => ({
    control_id: CONTROL,
    title: "t",
    state: "NEEDS_CLARIFICATION",
    ...fields,
  });
  const queue = parseQueue({
    total: 4,
    counts: {},
    controls: [
      row({
        control_ref: "ITGC-AC-01",
        application: "SAP S/4HANA",
        process: "Logical access",
        category: "ITGC",
        key_control: true,
        nature: "MANUAL",
        frequency: "EVENT_DRIVEN",
        test_basis: "STANDARD",
      }),
      row({
        control_ref: "ITGC-CM-01",
        application: "Active Directory",
        process: "Change management",
        category: "ITGC",
        key_control: true,
        nature: "MANUAL",
        frequency: "EVENT_DRIVEN",
        test_basis: "STANDARD",
      }),
      row({
        control_ref: "IPE-01",
        application: "SAP S/4HANA",
        process: "Key reports and IPE",
        category: "KEY_REPORT",
        key_control: false,
        nature: "IT_DEPENDENT_MANUAL",
        frequency: "QUARTERLY",
        test_basis: "CLIENT",
      }),
      row({
        control_ref: "RTR-01",
        application: "",
        process: "Month-end close",
        category: "BUSINESS",
        key_control: true,
        nature: "MANUAL",
        frequency: "MONTHLY",
        test_basis: "CLIENT",
      }),
    ],
    next_control_id: null,
  });

  it("filters by system, process, type, key, and basis together", () => {
    assert.ok(queue !== null);
    const refs = (filters: Partial<typeof NO_FILTERS>) =>
      filterQueue(queue.controls, [], "", { ...NO_FILTERS, ...filters }).map(
        (item) => item.controlRef,
      );
    assert.deepEqual(refs({ system: "SAP S/4HANA" }), ["ITGC-AC-01", "IPE-01"]);
    // A business process control runs on no system.
    assert.deepEqual(refs({ system: "None" }), ["RTR-01"]);
    assert.deepEqual(refs({ category: "KEY_REPORT" }), ["IPE-01"]);
    assert.deepEqual(refs({ key: "NON_KEY" }), ["IPE-01"]);
    assert.deepEqual(refs({ process: "Month-end close" }), ["RTR-01"]);
    assert.deepEqual(refs({ system: "SAP S/4HANA", basis: "CLIENT" }), [
      "IPE-01",
    ]);
    // The search covers the process too.
    assert.deepEqual(
      filterQueue(queue.controls, [], "month-end").map(
        (item) => item.controlRef,
      ),
      ["RTR-01"],
    );
  });

  it("offers each filter's values with counts under the other filters", () => {
    assert.ok(queue !== null);
    const groups = filterOptions(queue.controls, {
      ...NO_FILTERS,
      category: "ITGC",
    });
    const system = groups.find((group) => group.filter === "system");
    assert.deepEqual(
      system?.options.map((option) => [option.label, option.count]),
      [
        ["Active Directory", 1],
        ["None", 0],
        ["SAP S/4HANA", 1],
      ],
    );
    const category = groups.find((group) => group.filter === "category");
    // A filter's own value does not narrow its own options.
    assert.deepEqual(
      category?.options.map((option) => [option.label, option.count]),
      [
        ["Business process control", 1],
        ["IT general control", 2],
        ["Key report", 1],
      ],
    );
    assert.equal(
      groups.find((group) => group.filter === "key")?.options[0]?.label,
      "Key controls",
    );
  });
});

describe("the client values asked before approving", () => {
  it("reads the values the plan asks for and keeps only the answers given", () => {
    const found = plan({
      open_values: [
        {
          key: "admin-role",
          label: "the role that administers user access",
          why: "Testing checks that only this role grants access.",
          example: "IT service desk",
          blocks: true,
        },
        {
          key: "Not A Key",
          label: "dropped",
          why: "",
          example: "",
          blocks: false,
        },
      ],
    });
    assert.deepEqual(
      found.openValues.map((item) => [item.key, item.blocks]),
      [["admin-role", true]],
    );
    assert.deepEqual(plan().openValues, []);
    assert.deepEqual(
      answeredValues(found.openValues, {
        "admin-role": "  IT service desk ",
        "approver-role": "Not asked",
      }),
      { "admin-role": "IT service desk" },
    );
    assert.deepEqual(
      answeredValues(found.openValues, { "admin-role": "  " }),
      {},
    );
  });

  it("sends the answers with the approval and refuses what the API would refuse", () => {
    assert.deepEqual(
      planningWrite({
        ...IDS,
        intent: "approve",
        control_id: CONTROL,
        version: 7,
        comment: "",
        values: { "admin-role": " IT service desk " },
        everywhere: true,
      }),
      {
        intent: "approve",
        method: "POST",
        path: `${BASE}/controls/${CONTROL}/evidence-plan/approve`,
        body: {
          version: 7,
          comment: "",
          values: { "admin-role": "IT service desk" },
          everywhere: true,
        },
        slow: false,
      },
    );
    for (const values of [
      { "Bad Key": "x" },
      { "admin-role": "" },
      { "admin-role": "password=hunter22" },
      { "admin-role": 3 },
    ]) {
      assert.deepEqual(
        planningWrite({
          ...IDS,
          intent: "approve",
          control_id: CONTROL,
          version: 7,
          comment: "",
          values,
        }),
        { error: "invalid" },
        JSON.stringify(values),
      );
    }
  });
});

describe("answering the client values from the queue", () => {
  const ADMIN = {
    key: "admin-role",
    label: "the role that administers user access",
    why: "Who grants access.",
    example: "IT service desk",
    blocks: false,
  };
  const POLICY = {
    key: "access-policy",
    label: "the access management policy",
    why: "The approval criteria.",
    example: "",
    blocks: true,
  };
  const row = (
    controlId: string,
    controlRef: string,
    application: string,
    openValues: (typeof ADMIN)[],
  ): QueueRow =>
    ({
      controlId,
      controlRef,
      title: controlRef,
      application,
      openValues,
    }) as unknown as QueueRow;

  it("asks each value once per system, with every control it fills", () => {
    const rows = [
      row(CONTROL, "ITGC-AC-01", "Oracle", [ADMIN, POLICY]),
      row(OTHER, "ITGC-AC-02", "Oracle", [ADMIN]),
      row(ITEM, "ITGC-AC-01", "SAP", [ADMIN]),
    ];
    const questions = valueQuestions(rows);
    assert.deepEqual(
      questions.map((q) => [q.system, q.key, q.controls.map((c) => c.ref)]),
      [
        ["Oracle", "access-policy", ["ITGC-AC-01"]],
        ["Oracle", "admin-role", ["ITGC-AC-01", "ITGC-AC-02"]],
        ["SAP", "admin-role", ["ITGC-AC-01"]],
      ],
    );
    // One answer per system fills each control that asked; a blank one fills nothing.
    const items = valuesItems(
      questions,
      {
        "Oracle::admin-role": " Oracle service desk ",
        "Oracle::access-policy": "  ",
        "SAP::admin-role": "SAP security team",
      },
      (q) => `${q.system}::${q.key}`,
    );
    assert.deepEqual(items, [
      { control_id: CONTROL, values: { "admin-role": "Oracle service desk" } },
      { control_id: OTHER, values: { "admin-role": "Oracle service desk" } },
      { control_id: ITEM, values: { "admin-role": "SAP security team" } },
    ]);
  });

  it("asks a control split by entity for each entity's values on their own", () => {
    const split = (controlId: string, units: string): QueueRow =>
      ({ ...row(controlId, "RTR-02", "", [ADMIN]), units }) as QueueRow;
    const questions = valueQuestions([
      split(CONTROL, "Northwind UK Ltd"),
      split(OTHER, "Northwind US Inc."),
    ]);
    // Two questions, not one answer for both: each entity may name a different reviewer.
    assert.deepEqual(
      questions.map((q) => [q.system, q.controls.map((c) => c.id)]),
      [
        ["Northwind UK Ltd", [CONTROL]],
        ["Northwind US Inc.", [OTHER]],
      ],
    );
  });

  it("saves them in one call and refuses what the API would refuse", () => {
    assert.deepEqual(
      planningWrite({
        ...IDS,
        intent: "values-many",
        items: [{ control_id: CONTROL, values: { "admin-role": " IT " } }],
      }),
      {
        intent: "values-many",
        method: "PUT",
        path: `${BASE}/control-values`,
        body: {
          items: [{ control_id: CONTROL, values: { "admin-role": "IT" } }],
        },
        slow: false,
      },
    );
    for (const items of [
      [],
      [{ control_id: "not-a-uuid", values: { "admin-role": "IT" } }],
      [{ control_id: CONTROL, values: {} }],
      [{ control_id: CONTROL, values: { "admin-role": "token=abc123secret" } }],
    ]) {
      assert.deepEqual(
        planningWrite({ ...IDS, intent: "values-many", items }),
        { error: "invalid" },
        JSON.stringify(items),
      );
    }
  });
});

describe("the common answers for a client value", () => {
  it("reads the answers offered for each value, at most six", () => {
    const found = plan({
      open_values: [
        {
          key: "admin-role",
          label: "the role that administers user access",
          why: "",
          example: "",
          blocks: false,
          options: ["IT service desk", "IAM team", 3, "A", "B", "C", "D", "E"],
        },
      ],
    });
    assert.deepEqual(found.openValues[0]?.options, [
      "IT service desk",
      "IAM team",
      "A",
      "B",
      "C",
      "D",
    ]);
  });
});

describe("a client value answered by choosing", () => {
  const options = [
    "IT service desk administrator",
    "IT service desk",
    "Identity and access management team",
  ];

  it("writes several answers as one phrase the statement reads", () => {
    assert.equal(joinAnswers(["Line manager"]), "Line manager");
    assert.equal(
      joinAnswers(["Line manager", "Application owner"]),
      "Line manager and Application owner",
    );
    assert.equal(joinAnswers(["A", " ", "B", "C"]), "A, B and C");
  });

  it("reads the choices back from the phrase, the rest as the client's own", () => {
    assert.deepEqual(
      readAnswer(
        "IT service desk administrator, Identity and access management team and Security and compliance team",
        options,
      ),
      {
        // The longer answer is not mistaken for the shorter one inside it.
        chosen: [
          "IT service desk administrator",
          "Identity and access management team",
        ],
        other: "Security and compliance team",
      },
    );
    assert.deepEqual(readAnswer("it service desk", options), {
      chosen: ["IT service desk"],
      other: "",
    });
    assert.deepEqual(readAnswer("Regional IT team", options), {
      chosen: [],
      other: "Regional IT team",
    });
    assert.deepEqual(readAnswer("", options), { chosen: [], other: "" });
  });
});

describe("picking from the suggestions", () => {
  const options = [
    "Line manager",
    "Application owner",
    "Business process owner",
  ];

  it("adds and removes answers for a value that takes several", () => {
    assert.equal(
      toggleSuggestion("", "Application owner", options),
      "Application owner",
    );
    // Kept in the suggestions' order, with the client's own words last.
    assert.equal(
      toggleSuggestion("Application owner", "Line manager", options),
      "Line manager and Application owner",
    );
    assert.equal(
      toggleSuggestion(
        "Line manager and Regional HR",
        "Business process owner",
        options,
      ),
      "Line manager, Business process owner and Regional HR",
    );
    assert.equal(
      toggleSuggestion(
        "Line manager and Application owner",
        "Line manager",
        options,
      ),
      "Application owner",
    );
  });

  it("lets every value take several answers, and a second pick takes one out", () => {
    assert.equal(
      toggleSuggestion("Line manager", "Application owner", options),
      "Line manager and Application owner",
    );
    assert.equal(toggleSuggestion("Line manager", "Line manager", options), "");
  });
});

describe("one answer for the same question on other systems", () => {
  const value = {
    label: "the role that administers user access",
    why: "",
    example: "",
    blocks: false,
    options: [],
    question: "Who grants access?",
    hint: "",
  };
  const asked = (key: string, system: string, ref: string): ValueQuestion => ({
    ...value,
    key,
    system,
    controls: [{ id: ref, ref, title: ref }],
  });
  const oracle = asked("admin-role", "Oracle", "ITGC-AC-01");
  const sap = asked("admin-role", "SAP", "ITGC-AC-01");
  const workday = asked("admin-role", "Workday", "ITGC-AC-01");
  const policy = asked("access-policy", "SAP", "ITGC-AC-01");
  const all = [oracle, sap, workday, policy];
  const idOf = (question: ValueQuestion) =>
    `${question.system}::${question.key}`;

  it("finds the same question open for the other systems", () => {
    assert.deepEqual(
      otherSystems(oracle, all).map((item) => item.system),
      ["SAP", "Workday"],
    );
    assert.deepEqual(otherSystems(policy, all), []);
  });

  it("saves an answer copied to a system the filters hide", () => {
    const answers = {
      "Oracle::admin-role": "IT service desk",
      "SAP::admin-role": "IT service desk",
    };
    assert.deepEqual(questionsToSave([oracle], all, answers, idOf).map(idOf), [
      "Oracle::admin-role",
      "SAP::admin-role",
    ]);
  });
});

describe("a plan's next step in the queue", () => {
  const value = {
    key: "admin-role",
    label: "the role that administers user access",
    why: "",
    example: "",
    blocks: false,
    options: [],
    question: "Who grants access?",
    hint: "",
  };
  const row = (fields: Partial<QueueRow>): QueueRow =>
    ({
      state: "NEEDS_CLARIFICATION",
      heldBy: "",
      openValues: [],
      otherQuestions: 0,
      clarifications: 0,
      decisions: 0,
      findings: 0,
      ...fields,
    }) as unknown as QueueRow;

  it("leads with what holds approval, in a few words, the rest as counts", () => {
    const step = nextStepOf(
      row({
        heldBy:
          "Control design to confirm: This control is the quarterly review of privileged access.",
        openValues: [value],
        findings: 3,
      }),
    );
    assert.equal(step.kind, "held");
    assert.equal(step.label, "Confirm control design");
    assert.match(step.detail, /quarterly review/);
    assert.equal(
      nextStepOf(row({ heldBy: "1 proposed attribute waits for a decision." }))
        .label,
      "Decide 1 attribute",
    );
    assert.equal(
      heldStep("The planner proposed a revised understanding and procedures."),
      "Review planner's revision",
    );
    assert.equal(
      heldStep("2 proposed changes to the evidence to decide."),
      "Decide 2 evidence changes",
    );
    // An issue the rules do not name reads as one plain step, never a paragraph.
    assert.equal(
      heldStep(
        "Population source to confirm with the owner and the system administrator: which report",
      ),
      "Resolve open issue",
    );
  });

  it("asks for the client values, then the proposals, then the review", () => {
    const values = nextStepOf(
      row({
        openValues: [value, { ...value, key: "access-policy" }],
        findings: 2,
      }),
    );
    assert.equal(values.kind, "answer");
    assert.equal(values.label, "Answer 2 client values");
    assert.equal(nextStepOf(row({ decisions: 1 })).label, "Decide 1 proposal");
    assert.equal(
      nextStepOf(row({ otherQuestions: 1, findings: 2 })).label,
      "Review 3 open items",
    );
  });

  it("says when a plan is ready, or has nothing open", () => {
    assert.equal(nextStepOf(row({ state: "DRAFT_READY" })).kind, "ready");
    assert.equal(
      nextStepOf(row({ state: "APPROVED", openValues: [value] })).label,
      "Nothing open",
    );
    assert.equal(
      nextStepOf(row({ state: "ANALYZING" })).label,
      "Being planned",
    );
  });
});

describe("a client value answered where the plan shows it missing", () => {
  const value = {
    key: "approver-role",
    label: "the role that approves privileged access",
    why: "",
    example: "",
    blocks: false,
    options: [],
    question: "Who approves privileged access each quarter?",
    hint: "",
  };

  it("finds the value a placeholder stands for, however it is spaced or cased", () => {
    assert.equal(
      openValueFor([value], "[the role that approves privileged access]")?.key,
      "approver-role",
    );
    assert.equal(
      openValueFor([value], " The role  that approves privileged access ")?.key,
      "approver-role",
    );
    assert.equal(openValueFor([value], "[the system]"), undefined);
  });

  it("links a missing fact to the value it waits for, and nothing else", () => {
    const fact = {
      basis: "MISSING",
      value: "[the role that approves privileged access]",
    };
    assert.equal(missingValueOf(fact, [value])?.key, "approver-role");
    assert.equal(
      missingValueOf({ ...fact, basis: "SOURCE" }, [value]),
      undefined,
    );
    assert.equal(missingValueOf(fact, []), undefined);
  });

  it("asks a plan's values for its own control and system", () => {
    const plan = parseMasterPlan({
      control_id: "c1",
      control: {
        control_ref: "ITGC-AC-04",
        title: "Quarterly Privileged Access Review",
        application: "Active Directory",
      },
      open_values: [value],
      viewer_can_answer: true,
    });
    assert.ok(plan !== null);
    assert.equal(plan.viewerCanAnswer, true);
    const [question] = planQuestions(plan);
    assert.equal(question?.system, "Active Directory");
    assert.deepEqual(question?.controls, [
      {
        id: "c1",
        ref: "ITGC-AC-04",
        title: "Quarterly Privileged Access Review",
      },
    ]);
    assert.equal(parseMasterPlan({ control_id: "c1" })?.viewerCanAnswer, false);
  });
});

describe("client values filled into an approved plan", () => {
  it("reads them and says them in one line for the header", () => {
    const plan = parseMasterPlan({
      control_id: "c1",
      filled_since_approval: [
        {
          key: "review-deadline",
          label: "the deadline in the access review procedure",
          value: "30 days after quarter end",
          filled_by: "Robert John Manaol",
          filled_at: "2026-10-19T20:13:39+00:00",
        },
        "not a record",
      ],
    });
    assert.ok(plan !== null);
    assert.equal(plan.filledSinceApproval.length, 1);
    assert.equal(
      filledLine(plan.filledSinceApproval),
      "Client value filled since approval: the deadline in the access review procedure: 30 days after quarter end (Robert John Manaol)",
    );
    assert.equal(filledLine([]), "");
    assert.deepEqual(
      parseMasterPlan({ control_id: "c1" })?.filledSinceApproval,
      [],
    );
  });
});

describe("a plan approved before and changed since", () => {
  it("says what changed in a few words", () => {
    assert.equal(changesSummary(["Procedure I5 added"]), "Procedure I5 added");
    assert.equal(
      changesSummary([
        "Title changed",
        "Procedure I5 added",
        "Procedure D1 removed",
        "Evidence E2 reworded",
        "Understanding of the control revised",
      ]),
      "2 procedures, 1 evidence item, title, understanding of the control",
    );
    assert.equal(changesSummary([]), "Only client values filled in");
  });

  it("names the revision approved, so it does not read as the current state", () => {
    const row = {
      lastDecision: "APPROVED" as const,
      revisedSinceApproval: true,
      approvedRevision: 2,
    };
    assert.equal(decisionWords(row), "Approved revision 2");
    assert.equal(
      decisionWords({ ...row, revisedSinceApproval: false }),
      "Approved",
    );
    assert.equal(
      decisionWords({ ...row, lastDecision: "CHANGES_REQUESTED" }),
      "Changes requested",
    );
  });

  it("asks to re-approve the changes, and reads them from the plan and the queue", () => {
    const ready = {
      state: "DRAFT_READY",
      heldBy: "",
      openValues: [],
      otherQuestions: 0,
      decisions: 0,
      findings: 0,
    } as unknown as QueueRow;
    assert.equal(nextStepOf(ready).label, "Ready to approve");
    assert.equal(
      nextStepOf({ ...ready, revisedSinceApproval: true }).label,
      "Re-approve the changes",
    );
    const plan = parseMasterPlan({
      control_id: "c1",
      changes_since_approval: [
        {
          section: "PROCEDURE",
          code: "I5",
          change: "ADDED",
          detail: "Procedure I5 added",
        },
        { section: "X", code: "", change: "ODD", detail: "Something" },
      ],
    });
    assert.deepEqual(
      plan?.changesSinceApproval.map((item) => item.change),
      ["ADDED", "CHANGED"],
    );
  });
});

describe("the changes since approval, one line per part of the plan", () => {
  it("groups items by what happened to them, the control's own changes as said", () => {
    const item = (section: string, code: string, detail: string) => ({
      section,
      code,
      change: "CHANGED" as const,
      detail,
    });
    assert.deepEqual(
      groupChanges([
        item("CONTROL", "", "Title changed"),
        item("PROCEDURE", "D3", "Procedure D3 added"),
        item("PROCEDURE", "D4", "Procedure D4 added"),
        item("PROCEDURE", "D1", "Procedure D1 removed"),
        item("EVIDENCE", "E5", "Evidence E5 links changed"),
      ]),
      [
        { label: "The control", parts: [{ what: "Title changed", codes: [] }] },
        {
          label: "Procedures",
          parts: [
            { what: "added", codes: ["D3", "D4"] },
            { what: "removed", codes: ["D1"] },
          ],
        },
        {
          label: "Evidence",
          parts: [{ what: "links changed", codes: ["E5"] }],
        },
      ],
    );
    assert.deepEqual(groupChanges([]), []);
  });
});

describe("each finding says what resolves it", () => {
  it("offers the control that resolves it, where the plan can", () => {
    assert.equal(findingFix("UNMATCHED_ATTRIBUTE", false).action, "links");
    assert.equal(
      findingFix("EVIDENCE_WITHOUT_ATTRIBUTE", false).action,
      "links",
    );
    assert.equal(
      findingFix("PROCEDURE_WITHOUT_ATTRIBUTE", false).action,
      "links",
    );
    assert.equal(
      findingFix("ATTRIBUTE_WITHOUT_CRITERIA", false).action,
      "criteria",
    );
    assert.equal(
      findingFix("ATTRIBUTE_NOT_DOCUMENTED", false).action,
      "attributes",
    );
    assert.equal(findingFix("DEVIATES_FROM_STANDARD", false).action, "basis");
    const gap = findingFix("ATTRIBUTE_WITHOUT_PROCEDURE", false);
    assert.equal(gap.action, "replan");
    assert.equal(gap.label, "Plan again with the rules");
    // An approved plan is not planned again from a finding: it says how instead.
    const approved = findingFix("ATTRIBUTE_WITHOUT_EVIDENCE", true);
    assert.equal(approved.action, "evidence");
    assert.match(approved.hint, /goes back for approval/);
    assert.equal(
      findingFix("ATTRIBUTE_WITHOUT_PROCEDURE", true).action,
      "procedures",
    );
    assert.deepEqual(findingFix("SOMETHING_NEW", false), {
      hint: "",
      action: null,
      label: "",
    });
  });

  it("plans one control again with the rules", () => {
    const ok = planningWrite({
      organization_id: "11111111-1111-4111-8111-111111111111",
      project_id: "22222222-2222-4222-8222-222222222222",
      intent: "replan-control",
      control_id: "33333333-3333-4333-8333-333333333333",
    });
    assert.ok(!("error" in ok));
    assert.equal(ok.method, "POST");
    assert.match(ok.path, /\/controls\/33333333-[^/]+\/master-plan\/replan$/);
    assert.deepEqual(
      planningWrite({
        organization_id: "11111111-1111-4111-8111-111111111111",
        project_id: "22222222-2222-4222-8222-222222222222",
        intent: "replan-control",
        control_id: "nope",
      }),
      { error: "invalid" },
    );
  });
});

describe("describing a client's own control", () => {
  const fact = (
    field: string,
    label: string,
    basis: string,
    value = "",
    question = "",
  ) => ({
    field,
    label,
    value,
    basis,
    source: "",
    quote: "",
    question,
  });
  const plan = parseMasterPlan({
    control_id: "11111111-1111-4111-8111-111111111111",
    control: { control_ref: "BP-SAP-01", area: "PROCURE_TO_PAY" },
    facts: [
      fact(
        "OBJECTIVE",
        "Control objective",
        "PROPOSED",
        "Address the risk: X",
        "Confirm the control objective.",
      ),
      fact(
        "TYPE",
        "Preventive or detective",
        "MISSING",
        "",
        "Does the control prevent the error, or detect it after the fact?",
      ),
      fact(
        "PERFORMER",
        "Performed by",
        "MISSING",
        "",
        "Who performs the control at the client?",
      ),
      fact(
        "ASSERTIONS",
        "Assertions or IT risks",
        "MISSING",
        "",
        "Which assertions?",
      ),
      fact(
        "SYSTEM",
        "System or application",
        "JUDGMENT",
        "Not tied to one system.",
      ),
    ],
    blockers: [
      {
        kind: "CLARIFICATION",
        detail: "Preventive or detective: Does the control prevent?",
        blocks: false,
        resolve: "FACTS",
      },
      {
        kind: "CLARIFICATION",
        detail: "Performed by: Who performs?",
        blocks: false,
        resolve: "FACTS",
      },
      {
        kind: "CLARIFICATION",
        detail: "Assertions or IT risks: Which?",
        blocks: false,
        resolve: "FACTS",
      },
    ],
    suggested_standard: {
      library_key: "ptp-three-way-match",
      control_ref: "PTP-02",
      title: "Three-way match",
      status: "STRONG",
      rationale: "Same area",
    },
  });

  it("asks the missing facts first, then the planner's proposals to confirm", () => {
    assert.ok(plan !== null);
    const asked = describeQuestions(plan);
    assert.deepEqual(
      asked.map((item) => [item.field, item.input, item.proposal]),
      [
        ["TYPE", "type", ""],
        ["PERFORMER", "text", ""],
        ["ASSERTIONS", "assertions", ""],
        ["OBJECTIVE", "long", "Address the risk: X"],
      ],
    );
    assert.equal(plan.suggestedStandard?.controlRef, "PTP-02");
    const [facts] = holdGroups(plan.blockers);
    assert.equal(facts?.title, "Describe the control");
    assert.equal(facts?.action, "Describe the control");
  });

  it("asks an IT control's risks in words", () => {
    assert.ok(plan !== null);
    const it = { ...plan, control: { ...plan.control, area: "ACCESS" } };
    assert.equal(
      describeQuestions(it).find((item) => item.field === "ASSERTIONS")?.input,
      "text",
    );
  });

  it("saves the stated facts, and follows a standard as customized", () => {
    const ids = {
      organization_id: "22222222-2222-4222-8222-222222222222",
      project_id: "33333333-3333-4333-8333-333333333333",
    };
    const control = "11111111-1111-4111-8111-111111111111";
    const saved = planningWrite({
      ...ids,
      intent: "facts",
      control_id: control,
      facts: { TYPE: "Detective" },
    });
    assert.ok(!("error" in saved));
    assert.equal(saved.method, "PUT");
    assert.match(saved.path, /\/master-plan\/facts$/);
    assert.deepEqual(
      planningWrite({
        ...ids,
        intent: "facts",
        control_id: control,
        facts: { RISK: "x" },
      }),
      { error: "invalid" },
    );
    const used = planningWrite({
      ...ids,
      intent: "use-standard",
      control_id: control,
      library_key: "ptp-three-way-match",
    });
    assert.ok(!("error" in used));
    assert.deepEqual(used.body, {
      basis: "CUSTOM",
      library_key: "ptp-three-way-match",
      note: "",
    });
    assert.match(used.path, /\/test-basis$/);
  });
});
