import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  controlsBrief,
  controlsSetupState,
  controlsTiles,
  controlsTourSteps,
  listOf,
  parseControlsPane,
  scopeSteps,
} from "../apps/web/src/controls-guide-model.ts";
import {
  type Onboarding,
  parseOnboarding,
} from "../apps/web/src/onboarding-model.ts";

// The setup agent in Controls (decided by the product owner, 25 October 2026): once an
// engagement runs without controls, its systems, controls, and templates are set up
// there, with a tour and an agent panel.

const projectId = "33333333-3333-7333-8333-333333333333";
const appId = "44444444-4444-7444-8444-444444444444";

function running(extra: Record<string, unknown> = {}): Onboarding {
  const parsed = parseOnboarding({
    project_id: projectId,
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
    applications: [],
    team: [],
    candidates: [],
    controls: [],
    templates: [],
    agents: [],
    library: [
      { domain: "ACCESS", controls: 12, loaded: 0 },
      { domain: "ORDER_TO_CASH", controls: 8, loaded: 0 },
    ],
    readiness: [],
    ready: false,
    plan: null,
    started: true,
    ...extra,
  });
  assert.ok(parsed);
  return parsed;
}

const withSystem = () =>
  running({ applications: [{ id: appId, name: "SAP ERP", description: "" }] });

describe("the Controls tour", () => {
  it("walks the systems, the processes, the selection of controls, and the finalization", () => {
    const steps = controlsTourSteps(running());
    assert.deepEqual(
      steps.map((step) => step.id),
      ["welcome", "systems", "processes", "library", "finalize", "done"],
    );
    assert.deepEqual(steps[0]?.targets, [".cs-tiles"]);
    assert.deepEqual(steps[1]?.targets, ["#cs-pane-systems > :first-child"]);
    // The controls are selected on their own page: the tour points at the workflow's
    // Select controls step, then at Review and finalize (SP6).
    assert.deepEqual(steps[3]?.targets, [".sp-step.is-controls"]);
    assert.deepEqual(steps[4]?.targets, [".sp-step.is-finalize"]);
  });

  it("opens each stop's tab before pointing at it", () => {
    assert.deepEqual(
      controlsTourSteps(running()).map((step) => step.pane ?? null),
      [null, "systems", "processes", "systems", null, null],
    );
  });

  it("starts with the systems, then selects controls for them", () => {
    const empty = controlsTourSteps(running());
    assert.equal(empty[1]?.done, false);
    assert.match(empty[1]?.body[0] ?? "", /^Start with the systems/);
    assert.match(empty[3]?.body[0] ?? "", /20 reviewed controls/);
    assert.match(empty[3]?.body[1] ?? "", /add one first/);
    const one = controlsTourSteps(withSystem());
    assert.equal(one[1]?.done, true);
    assert.equal(one[1]?.body[0], "1 system in scope: SAP ERP.");
    assert.match(one[3]?.body[1] ?? "", /areas approved/);
  });

  it("keeps the product's neutral voice", () => {
    const words = controlsTourSteps(withSystem())
      .flatMap((step) => [step.title, ...step.body])
      .join(" ");
    assert.doesNotMatch(words, /\b(I|I'll|I'm|me|my|we|let's)\b/i);
  });
});

describe("the agent beside the Controls setup", () => {
  it("says what is in place and what to do next", () => {
    const empty = controlsBrief(running());
    assert.deepEqual(
      empty.checklist.map((item) => `${item.label}: ${item.detail}`),
      [
        "Systems: None yet",
        "Controls: None yet",
        "Workpaper templates: Standard templates apply",
      ],
    );
    assert.match(empty.next, /^Next: add the first system/);
    const next = controlsBrief(withSystem());
    assert.equal(next.checklist[0]?.detail, "1 system in scope");
    assert.match(next.next, /^Next: load the standard library/);
  });

  it("counts what the engagement holds", () => {
    assert.deepEqual(controlsSetupState(withSystem()), {
      systems: ["SAP ERP"],
      toReview: 0,
      processes: 0,
      controls: 0,
      libraryControls: 20,
      firmTemplates: 0,
    });
  });
});

describe("the tiles and tabs of the first setup", () => {
  it("show how many of each there are and where they stand", () => {
    assert.deepEqual(
      controlsTiles(running()).map(
        (tile) => `${tile.label} ${tile.count} ${tile.status}`,
      ),
      [
        "Systems 0 Not started",
        "Processes 0 Not started",
        "Policies & procedures 0 None added",
        "References 0 None added",
      ],
    );
    assert.equal(controlsTiles(withSystem())[0]?.status, "In scope");
    const named = running({
      processes: [
        {
          id: "55555555-5555-7555-8555-555555555555",
          name: "Lease accounting",
          domain: "OTHER_BUSINESS",
          domain_label: "Other business process",
          version: 1,
          controls_in_scope: 0,
        },
      ],
    });
    assert.equal(controlsTiles(named)[1]?.count, 1);
    assert.equal(controlsTiles(named)[1]?.status, "In scope");
  });

  // Systems & Processes is the permanent page (decided by the product owner, SP1): it
  // opens on the systems, which come first, unless the address filters the register.
  it("opens the tab an address names, else the systems", () => {
    assert.equal(parseControlsPane("processes"), "processes");
    assert.equal(parseControlsPane("references"), "references");
    assert.equal(parseControlsPane(null), "systems");
    assert.equal(parseControlsPane("other"), "systems");
    // The Controls tab is a page of its own now; its address redirects there (routes).
    assert.equal(parseControlsPane("controls"), "systems");
  });
});

describe("the Systems & Processes workflow", () => {
  const states = (onboarding: Onboarding, finalized = false) =>
    scopeSteps(onboarding, finalized).map(
      (step) => `${step.key}:${step.state}`,
    );

  it("starts with the systems, then the processes, the controls, and the finalization", () => {
    assert.deepEqual(states(running()), [
      "systems:now",
      "processes:todo",
      "controls:todo",
      "finalize:todo",
    ]);
    assert.deepEqual(states(withSystem()), [
      "systems:done",
      "processes:now",
      "controls:todo",
      "finalize:todo",
    ]);
    assert.deepEqual(
      scopeSteps(running(), false).map((step) => step.pane),
      // Select controls opens the Controls page; finalizing has no tab of its own.
      ["systems", "processes", null, null],
    );
  });

  it("treats the processes as optional once controls are selected", () => {
    const selected = running({
      applications: [{ id: appId, name: "SAP ERP", description: "" }],
      controls: [
        {
          id: "66666666-6666-7666-8666-666666666666",
          control_ref: "ITGC-AC-01",
          title: "User access provisioning",
          domain: "ACCESS",
          included: true,
        },
      ],
    });
    if (controlsSetupState(selected).controls === 0) {
      // The fixture's control did not parse: nothing below would be meaningful.
      assert.fail("the fixture's control should be in scope");
    }
    assert.deepEqual(states(selected), [
      "systems:done",
      "processes:todo",
      "controls:done",
      "finalize:now",
    ]);
    assert.equal(states(selected, true)[3], "finalize:done");
  });

  it("reads the related processes a person typed as a list", () => {
    assert.deepEqual(listOf("Procure-to-Pay, Financial Close;\nPayroll"), [
      "Procure-to-Pay",
      "Financial Close",
      "Payroll",
    ]);
    assert.deepEqual(listOf(" , ;"), []);
    assert.deepEqual(listOf("Payroll, Payroll"), ["Payroll"]);
  });
});

describe("a system taken out of scope (migration 0114)", () => {
  it("is read as out of scope and left out of the Systems tile", () => {
    const onboarding = running({
      applications: [
        { id: appId, name: "SAP ERP", description: "" },
        {
          id: "33333333-3333-7333-8333-333333333333",
          name: "Workday",
          description: "",
          out_of_scope_at: "2026-10-25T10:00:00Z",
          out_of_scope_reason: "Retired before the period.",
        },
      ],
    });
    const workday = onboarding.applications.find(
      (item) => item.name === "Workday",
    );
    assert.deepEqual(workday?.outOfScope, {
      at: "2026-10-25T10:00:00Z",
      reason: "Retired before the period.",
    });
    assert.equal(controlsTiles(onboarding)[0]?.count, 1);
  });
});
