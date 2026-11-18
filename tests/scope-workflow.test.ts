import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  areaOf,
  scopeSteps,
  selectionCategory,
  workStartLine,
} from "../apps/web/src/controls-guide-model.ts";
import {
  inScopeSystems,
  type Onboarding,
  parseOnboarding,
  processDraftBody,
  wizardWrite,
} from "../apps/web/src/onboarding-model.ts";

// The Systems & Processes workflow's processes (SP3) and control selection (SP4), decided by
// the product owner on 24 October 2026. Review and finalize (SP6) is removed: on 17 November
// 2026 the product owner decided "Remove the requirement to finalize the scope. Scope keeps
// changing so it will never be finalized." Each control's work starts when it is selected on a
// launched engagement, and at the launch for a control selected before it.

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

describe("selecting controls", () => {
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

  // Rewritten 17 November 2026 (the product owner: the scope is never finalized). Old:
  // "finalizes only with the counts reviewed and at least one control" (scope-finalize wrote
  // POST .../scope/finalize). New: the finalize step and its route are removed, so the
  // intent is refused like any unknown one and nothing can call the route.
  it("has no finalize write: the work starts when a control is selected", () => {
    assert.deepEqual(
      wizardWrite({
        organization_id: org,
        project_id: project,
        intent: "scope-finalize",
        systems: 1,
        processes: 1,
        controls: 3,
      }),
      { error: "invalid" },
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

// Rewritten 17 November 2026 (the product owner: the scope is never finalized). Old:
// "Review and finalize" checked scopeReview (blocked before a control or the launch; the
// counts and notes the person confirmed) and that finalizing marked the workflow's fourth
// step done. scopeReview fed only the Review and finalize drawer, which is removed with the
// step, so its two tests are retired with it. New: selecting the controls is the last of
// three steps, and the steps read nothing about a finalization.
describe("the workflow's steps", () => {
  it("ends with selecting the controls, with no finalize step", () => {
    const empty = engagement();
    assert.deepEqual(
      scopeSteps(empty).map((step) => `${step.key}:${step.state}`),
      ["systems:done", "processes:done", "controls:now"],
    );
    const selected = engagement({
      controls: [control("ITGC-AC-01", "ACCESS", { application_id: sap })],
    });
    assert.ok(
      scopeSteps(selected).every((step) => step.state === "done"),
      "every step is done once a control is selected",
    );
    assert.ok(
      !scopeSteps(selected).some((step) => step.title.includes("final")),
    );
    // An engagement finalized under SP6 reads the same: the field is not read any more.
    const final = engagement({
      settings: {
        period_end: "2027-12-31",
        kicked_off_at: "2026-10-25T10:00:00Z",
        scope_finalized_at: "2026-10-26T10:00:00Z",
        version: 3,
      },
    });
    assert.ok(!("scopeFinalizedAt" in final));
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

// Added 18 November 2026 (design review): scope_changes.reconcile_scope creates a control's
// work only once the engagement is launched. Old: the copy said the work starts when a
// control is selected on every engagement, and an engagement not launched with controls
// selected showed neither the steps nor a banner. New: each screen says the work starts at
// the launch until the engagement is launched, and Systems & Processes says so with the way
// to the launch.
describe("when a control's work starts, before and after the launch", () => {
  const read = (path: string) =>
    readFileSync(path, "utf8").replace(/\r\n/g, "\n");

  it("is said once, from whether the engagement is launched", () => {
    assert.equal(
      workStartLine(true),
      "Each control's walkthrough, evidence request, test, and review are created when it is selected.",
    );
    assert.equal(
      workStartLine(false),
      "Each control's walkthrough, evidence request, test, and review are created when the engagement is launched.",
    );
  });

  it("shows Systems & Processes not launched with controls a banner to the launch", () => {
    const view = read("apps/web/src/setup-view.tsx");
    const page = view.slice(view.indexOf("export function ScopePage("));
    assert.match(
      page,
      /\{!importing && !onboarding\.started && controls\.length > 0 \? \(\n\s*<Banner tone="info">\n\s*<span className="fz-banner">/,
    );
    assert.match(page, /work starts\n\s*when the engagement is launched\./);
    assert.match(
      page,
      // "Go to launch", as the launched banner's "Go to Planning": "review" already means a
      // system's decision on this screen (design review, 18 November 2026).
      /<a className="text-link" href=\{setupHref\(model, "launch"\)\}>\n\s*Go to launch/,
    );
    // The launched banner is kept, and the steps still give way once a control is selected.
    assert.match(
      page,
      /\{!importing && onboarding\.started && controls\.length > 0 \? \(/,
    );
    assert.match(
      page,
      /steps=\{controls\.length > 0 \? null : scopeSteps\(onboarding\)\}/,
    );
    // The Controls empty state words the work from the launch as well.
    assert.match(
      view,
      /upload the organization's RCM\. \$\{workStartLine\(onboarding\.started\)\}`/,
    );
    assert.doesNotMatch(view, /review are created when it is selected\."/);
  });

  it("words the Select controls note from the launch", () => {
    const view = read("apps/web/src/setup-view.tsx");
    assert.equal(
      view.match(
        /rcm=\{controls\.length === 0\}\n\s*started=\{onboarding\.started\}/g,
      )?.length,
      2,
    );
    const actions = read("apps/web/src/scope-actions.tsx");
    assert.match(
      actions,
      // In the Controls page's and the tour's words (design review, 18 November 2026).
      /\{workStartLine\(started\)\}/,
    );
    // The standard's note already said so; the screens agree.
    const matches = read("apps/web/src/standard-matches.tsx");
    assert.match(matches, /when the engagement is launched\./);
  });
});
