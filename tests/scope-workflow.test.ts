import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  areaOf,
  scopeReview,
  scopeSteps,
  selectionCategory,
} from "../apps/web/src/controls-guide-model.ts";
import {
  inScopeSystems,
  type Onboarding,
  parseOnboarding,
  processDraftBody,
  wizardWrite,
} from "../apps/web/src/onboarding-model.ts";

// The Systems & Processes workflow's processes (SP3), control selection (SP4), and Review
// and finalize (SP6), decided by the product owner on 24 October 2026.

const org = "11111111-1111-7111-8111-111111111111";
const project = "22222222-2222-7222-8222-222222222222";
const sap = "33333333-3333-7333-8333-333333333333";
const payroll = "44444444-4444-7444-8444-444444444444";
const base = `/organizations/${org}/projects/${project}/onboarding`;

function engagement(extra: Record<string, unknown> = {}): Onboarding {
  const parsed = parseOnboarding({
    project_id: project,
    project_name: "SOX FY27",
    project_status: "ACTIVE",
    scope: "SOX testing",
    settings: {
      period_end: "2027-12-31",
      client_coordinator_name: "",
      client_coordinator_email: "",
      client_domains: [],
      pbc_due_days: 10,
      pbc_follow_up_days: 3,
      pbc_max_follow_ups: 2,
      templates_confirmed_at: null,
      kicked_off_at: "2026-10-25T10:00:00Z",
      scope_finalized_at: null,
      version: 3,
    },
    applications: [
      {
        id: sap,
        name: "SAP ERP",
        description: "",
        control_areas: ["ITGC", "ITAC"],
        control_areas_decided_at: "2026-10-25T10:00:00Z",
      },
    ],
    processes: [
      {
        id: payroll,
        name: "Payroll",
        domain: "HIRE_TO_RETIRE",
        domain_label: "Hire to retire",
        version: 1,
        owner: "HR Director",
        description: "Pays employees",
        system_ids: [],
        primary_system_id: null,
        control_areas: null,
      },
    ],
    team: [],
    candidates: [],
    controls: [],
    templates: [],
    agents: [],
    library: [],
    readiness: [],
    ready: false,
    plan: null,
    started: true,
    ...extra,
  });
  assert.ok(parsed);
  return parsed;
}

function control(id: string, domain: string, extra: Record<string, unknown>) {
  return {
    id,
    control_ref: id,
    title: id,
    domain,
    included: true,
    ...extra,
  };
}

describe("the Add business process wizard's calls", () => {
  const draft = {
    organization_id: org,
    project_id: project,
    name: " Procure to pay ",
    domain: "PROCURE_TO_PAY",
    description: "Buying and paying",
    owner: "AP Lead",
    system_ids: [sap],
    primary_system_id: sap,
  };

  it("asks for areas, then adds the process with the approved ones", () => {
    const areas = wizardWrite({ ...draft, intent: "process-areas" });
    assert.ok(!("error" in areas));
    assert.equal(areas.path, `${base}/processes/areas`);
    assert.deepEqual(areas.body, {
      name: "Procure to pay",
      domain: "PROCURE_TO_PAY",
      description: "Buying and paying",
      owner: "AP Lead",
      system_ids: [sap],
      primary_system_id: sap,
    });
    const add = wizardWrite({
      ...draft,
      intent: "process-add",
      approved_areas: ["BUSINESS", "BUSINESS"],
    });
    assert.ok(!("error" in add));
    assert.equal(add.path, `${base}/processes/setup`);
    assert.deepEqual(
      (add.body as { approved_areas: string[] }).approved_areas,
      ["BUSINESS"],
    );
  });

  it("needs no system, and refuses what it cannot trust", () => {
    assert.deepEqual(
      processDraftBody({ name: "Treasury", domain: "TREASURY" }),
      {
        name: "Treasury",
        domain: "TREASURY",
        description: "",
        owner: "",
        system_ids: [],
      },
    );
    for (const change of [
      { name: "" },
      { domain: "ACCESS" },
      { system_ids: ["x"] },
      { primary_system_id: payroll },
      { owner: "password=hunter2hunter2" },
    ]) {
      assert.equal(processDraftBody({ ...draft, ...change }), null);
    }
  });
});

describe("selecting controls and finalizing the scope", () => {
  it("reads what a system or a process can select, then selects", () => {
    const options = wizardWrite({
      organization_id: org,
      project_id: project,
      intent: "scope-options",
      system_id: sap,
    });
    assert.ok(!("error" in options));
    assert.equal(options.method, "GET");
    assert.equal(options.path, `${base}/scope/options?system_id=${sap}`);
    const forProcess = wizardWrite({
      organization_id: org,
      project_id: project,
      intent: "scope-select",
      target_process_id: payroll,
      library_keys: ["payroll-review", "payroll-review"],
    });
    assert.ok(!("error" in forProcess));
    assert.deepEqual(forProcess.body, {
      process_id: payroll,
      library_keys: ["payroll-review"],
    });
    for (const fields of [
      { system_id: sap, target_process_id: payroll, library_keys: ["a"] },
      { library_keys: ["a"] },
      { system_id: sap, library_keys: [] },
      { system_id: sap, library_keys: ["Not A Key"] },
    ]) {
      assert.ok(
        "error" in
          wizardWrite({
            organization_id: org,
            project_id: project,
            intent: "scope-select",
            ...fields,
          }),
      );
    }
  });

  it("finalizes only with the counts reviewed and at least one control", () => {
    const write = wizardWrite({
      organization_id: org,
      project_id: project,
      intent: "scope-finalize",
      systems: 1,
      processes: 1,
      controls: 3,
    });
    assert.ok(!("error" in write));
    assert.equal(write.path, `${base}/scope/finalize`);
    assert.deepEqual(write.body, { systems: 1, processes: 1, controls: 3 });
    assert.ok(
      "error" in
        wizardWrite({
          organization_id: org,
          project_id: project,
          intent: "scope-finalize",
          systems: 1,
          processes: 0,
          controls: 0,
        }),
    );
  });

  it("files each library control under its category", () => {
    assert.equal(areaOf("ACCESS"), "ITGC");
    assert.equal(areaOf("IPE"), "IPE");
    assert.equal(areaOf("ORDER_TO_CASH"), "BUSINESS");
    assert.deepEqual(selectionCategory("ENTITY"), {
      key: "ENTITY",
      label: "Entity-level controls",
    });
    assert.equal(selectionCategory("CHANGE").label, "IT general controls");
  });
});

describe("Review and finalize", () => {
  it("cannot finalize before a control is selected, or before launch", () => {
    assert.equal(
      scopeReview(engagement()).blocked,
      "Select at least one control first.",
    );
    assert.equal(
      scopeReview(engagement({ started: false })).blocked,
      "Launch the engagement from onboarding first.",
    );
  });

  it("counts the scope and says what deserves a look", () => {
    const review = scopeReview(
      engagement({
        controls: [
          control("ITGC-AC-01", "ACCESS", { application_id: sap }),
          control("HR-01", "HIRE_TO_RETIRE", { process_id: payroll }),
          control("OUT-01", "ACCESS", {
            application_id: sap,
            included: false,
          }),
        ],
      }),
    );
    assert.equal(review.blocked, null);
    assert.deepEqual(review.totals, { systems: 1, processes: 1, controls: 2 });
    assert.deepEqual(
      review.byArea.map((area) => `${area.area}:${area.controls}`),
      ["ITGC:1", "ITAC:0", "IPE:0", "BUSINESS:1"],
    );
    assert.deepEqual(review.notes, [
      "SAP ERP: no control selected yet in application controls.",
      "Payroll is linked to no system.",
    ]);
  });

  it("is the workflow's last step until the scope is final", () => {
    const final = engagement({
      settings: {
        period_end: "2027-12-31",
        kicked_off_at: "2026-10-25T10:00:00Z",
        scope_finalized_at: "2026-10-26T10:00:00Z",
        version: 3,
      },
    });
    assert.equal(final.scopeFinalizedAt, "2026-10-26T10:00:00Z");
    assert.equal(engagement().scopeFinalizedAt, null);
    const steps = scopeSteps(final, true);
    assert.equal(steps[3]?.state, "done");
    assert.equal(engagement().processes[0]?.owner, "HR Director");
    assert.equal(engagement().processes[0]?.controlAreas, null);
  });
});

describe("a system taken out of scope (migration 0114)", () => {
  it("is left out of the systems in scope", () => {
    const onboarding = {
      applications: [
        { id: "a", name: "SAP ERP", outOfScope: null },
        {
          id: "b",
          name: "Workday",
          outOfScope: { at: "2026-10-25", reason: "Retired" },
        },
      ],
    } as unknown as Onboarding;
    assert.deepEqual(
      inScopeSystems(onboarding).map((system) => system.name),
      ["SAP ERP"],
    );
  });
});
