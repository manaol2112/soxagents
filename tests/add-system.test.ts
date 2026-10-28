import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseAreaSuggestions,
  parseOnboarding,
  systemDraftBody,
  wizardWrite,
} from "../apps/web/src/onboarding-model.ts";

// The Add system wizard (decided by the product owner, SP2 of the Systems & Processes
// workflow, 24 October 2026): the agent suggests control areas, a person approves them,
// and the system is added in one call that puts no control in scope.

const org = "11111111-1111-7111-8111-111111111111";
const project = "22222222-2222-7222-8222-222222222222";
const other = "33333333-3333-7333-8333-333333333333";
const process = "44444444-4444-7444-8444-444444444444";

const draft = {
  organization_id: org,
  project_id: project,
  name: " Workday ",
  layer: "APPLICATION",
  description: "HR and payroll",
  owner: "HR Director",
  environment: "PRODUCTION",
  purpose: "Pays employees",
  hosting: "SAAS",
  processes: "Payroll",
  integration_ids: [other],
  process_ids: [process],
};

describe("the Add system wizard's calls", () => {
  it("asks the agent for areas with the documented facts, writing nothing", () => {
    const write = wizardWrite({ ...draft, intent: "areas" });
    assert.ok(!("error" in write));
    assert.equal(write.method, "POST");
    assert.equal(
      write.path,
      `/organizations/${org}/projects/${project}/onboarding/systems/areas`,
    );
    assert.deepEqual(write.body, {
      name: "Workday",
      layer: "APPLICATION",
      description: "HR and payroll",
      purpose: "Pays employees",
      processes: "Payroll",
      owner: "HR Director",
      environment: "PRODUCTION",
      hosting: "SAAS",
      integration_ids: [other],
      process_ids: [process],
    });
  });

  it("adds the system with only the areas a person approved", () => {
    const write = wizardWrite({
      ...draft,
      intent: "add",
      approved_areas: ["ITGC", "IPE", "ITGC"],
    });
    assert.ok(!("error" in write));
    assert.equal(
      write.path,
      `/organizations/${org}/projects/${project}/onboarding/systems`,
    );
    assert.deepEqual(
      (write.body as { approved_areas: string[] }).approved_areas,
      ["ITGC", "IPE"],
    );
    // The agent's suggestion is never sent: the API recomputes it.
    assert.equal("suggested" in (write.body as object), false);
  });

  it("refuses a draft it cannot trust", () => {
    for (const change of [
      { name: "" },
      { layer: "MAINFRAME" },
      { environment: "STAGING" },
      { hosting: "CLOUD" },
      { integration_ids: ["not-a-uuid"] },
      { process_ids: "x" },
      { description: "x".repeat(501) },
      { owner: "password=hunter2hunter2" },
    ]) {
      assert.equal(
        systemDraftBody({ ...draft, ...change }),
        null,
        JSON.stringify(change),
      );
    }
    assert.ok("error" in wizardWrite({ ...draft, intent: "add" }));
    assert.ok(
      "error" in
        wizardWrite({
          ...draft,
          intent: "add",
          approved_areas: ["EVERYTHING"],
        }),
    );
  });

  it("leaves out what was not stated", () => {
    const body = systemDraftBody({ name: "Oracle", layer: "DATABASE" });
    assert.deepEqual(body, {
      name: "Oracle",
      layer: "DATABASE",
      description: "",
      purpose: "",
      processes: "",
      owner: "",
      integration_ids: [],
      process_ids: [],
    });
  });
});

describe("the agent's suggested areas and the approved ones", () => {
  it("reads the suggestion and drops what it does not know", () => {
    const parsed = parseAreaSuggestions({
      source: "RULES",
      library_version: 4,
      areas: [
        {
          area: "ITGC",
          suggested: true,
          controls: 31,
          reason: "Every system.",
        },
        { area: "NEW", suggested: true, controls: 1, reason: "?" },
      ],
    });
    assert.deepEqual(parsed, {
      source: "RULES",
      libraryVersion: 4,
      areas: [
        {
          area: "ITGC",
          suggested: true,
          controls: 31,
          reason: "Every system.",
        },
      ],
    });
    assert.equal(parseAreaSuggestions(null), null);
  });

  it("keeps a system's approved areas apart from the suggestion", () => {
    const onboarding = parseOnboarding({
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
        version: 3,
      },
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
      applications: [
        {
          id: other,
          name: "Workday",
          description: "",
          environment: "PRODUCTION",
          integration_ids: [],
          process_ids: [process],
          control_areas: ["ITGC", "BOGUS"],
          control_areas_suggested: {
            source: "RULES",
            library_version: 4,
            areas: [
              { area: "ITAC", suggested: true, controls: 4, reason: "x" },
            ],
          },
          control_areas_decided_at: "2026-10-24T10:00:00Z",
        },
        { id: process, name: "Oracle", description: "" },
      ],
      processes: [
        {
          id: process,
          name: "Payroll",
          domain: "HIRE_TO_RETIRE",
          domain_label: "Hire to retire",
          version: 1,
          system_ids: [other],
        },
      ],
    });
    assert.ok(onboarding);
    const [workday, oracle] = onboarding.applications;
    assert.deepEqual(workday?.controlAreas, ["ITGC"]);
    assert.equal(workday?.controlAreasSuggested?.areas[0]?.area, "ITAC");
    assert.equal(workday?.environment, "PRODUCTION");
    assert.deepEqual(workday?.processIds, [process]);
    // No decision yet: null, not an empty approval.
    assert.equal(oracle?.controlAreas, null);
    assert.equal(oracle?.controlAreasSuggested, null);
    assert.deepEqual(onboarding.processes[0]?.systemIds, [other]);
  });

  it("reads what each catalog system is, for the picker", () => {
    const onboarding = parseOnboarding({
      project_id: project,
      project_name: "SOX FY27",
      project_status: "ACTIVE",
      scope: "",
      settings: { period_end: "2027-12-31", version: 1 },
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
      applications: [],
      known_systems: [
        { name: "Workday", layer: "APPLICATION", category: "HR" },
        { name: "Linux", layer: "OPERATING_SYSTEM" },
      ],
    });
    assert.deepEqual(onboarding?.knownSystems, [
      { name: "Workday", layer: "APPLICATION", category: "HR" },
      { name: "Linux", layer: "OPERATING_SYSTEM", category: "" },
    ]);
  });
});
