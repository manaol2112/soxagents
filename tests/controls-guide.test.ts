import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  // Rewritten 17 November 2026 (the product owner: "Remove the requirement to finalize the
  // scope. Scope keeps changing so it will never be finalized."). Old: the tour walked the
  // systems, the processes, the selection of controls, then Review and finalize (SP6, a stop
  // at ".sp-step.is-finalize"). New: no finalize stop; the last stop says the work starts
  // when a control is selected and follows the scope as it changes.
  it("walks the systems, the processes, and the selection of controls", () => {
    const steps = controlsTourSteps(running());
    assert.deepEqual(
      steps.map((step) => step.id),
      ["welcome", "systems", "processes", "library", "done"],
    );
    assert.deepEqual(steps[0]?.targets, [".cs-tiles"]);
    assert.deepEqual(steps[1]?.targets, ["#cs-pane-systems > :first-child"]);
    // The controls are selected on their own page: the tour points at the workflow's
    // Select controls step.
    assert.deepEqual(steps[3]?.targets, [".sp-step.is-controls"]);
    const words = steps.flatMap((step) => [step.title, ...step.body]).join(" ");
    assert.doesNotMatch(words, /finali[sz]/i);
    // Reworded 18 November 2026 (design review). Old: "Each control's work starts when it
    // is selected", on every engagement, under "Then the work starts". New: on a launched
    // engagement the work of a control is created when it is selected, under "How the work
    // follows the scope"; before the launch, at the launch (next test).
    assert.equal(steps[4]?.title, "How the work follows the scope");
    assert.match(
      steps[4]?.body[0] ?? "",
      /^Each control's walkthrough, evidence request, test, and review are created when it is selected\. The scope can change at any time: a control added later is prepared the same way, and a control removed has its open work cancelled\./,
    );
  });

  // Added 18 November 2026 (design review): scope_changes.reconcile_scope creates no work
  // before the engagement is launched, so the tour says the work starts at the launch.
  it("says the work starts at the launch on an engagement not yet launched", () => {
    const steps = controlsTourSteps(running({ started: false }));
    assert.match(
      steps[4]?.body[0] ?? "",
      /^Each control's walkthrough, evidence request, test, and review are created when the engagement is launched\./,
    );
    assert.match(
      steps[4]?.body[0] ?? "",
      /once the engagement is launched, a control added later is prepared the same way/,
    );
    const words = steps.flatMap((step) => [step.title, ...step.body]).join(" ");
    assert.doesNotMatch(words, /when it is selected/);
  });

  // Added 18 November 2026 (design review: the tour repeated itself). Old: the first and
  // last stops each said when the work starts and that nothing is sent until an approver
  // confirms it. New: when the work starts is said once, on the last stop; the approval
  // reassurance once, on the first.
  it("says each point once: the approval on the first stop, the work on the last", () => {
    for (const started of [true, false]) {
      const steps = controlsTourSteps(running({ started }));
      const where = (pattern: RegExp) =>
        steps
          .filter((step) => step.body.some((line) => pattern.test(line)))
          .map((step) => step.id);
      assert.deepEqual(where(/nothing is sent until an approver/i), [
        "welcome",
      ]);
      assert.deepEqual(where(/walkthrough, evidence request, test/), ["done"]);
    }
  });

  // Added 18 November 2026 (design review): the workflow's steps are hidden once a control
  // is selected, so the stop on selecting controls points at the page's Add instead.
  it("points at the page's Add once the steps are gone", () => {
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
    assert.equal(controlsSetupState(selected).controls, 1);
    assert.deepEqual(controlsTourSteps(selected)[3]?.targets, [
      ".is-controls-setup .page-actions .row-menu-trigger",
    ]);
    // The page's Add is a RowMenu trigger in the page header's actions.
    const guide = readFileSync("apps/web/src/controls-guide.tsx", "utf8");
    assert.match(guide, /trigger=\{\{ label: "Add", icon: "plus" \}\}/);
    const menu = readFileSync("apps/web/src/row-menu.tsx", "utf8");
    assert.match(menu, /className=\{`btn row-menu-trigger/);
    const page = readFileSync("apps/web/src/workspace-view.tsx", "utf8");
    assert.match(page, /<div className="page-actions">\{actions\}<\/div>/);
    const view = readFileSync("apps/web/src/setup-view.tsx", "utf8");
    assert.match(view, /className="page setup-page is-controls-setup"/);
  });

  it("opens each stop's tab before pointing at it", () => {
    assert.deepEqual(
      controlsTourSteps(running()).map((step) => step.pane ?? null),
      [null, "systems", "processes", "systems", null],
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

  // Added 18 November 2026 (design review): before the launch no work exists yet. Old: "Controls
  // are in place; their work has started." on every engagement. New: before the launch, the
  // work starts when the engagement is launched.
  it("says the work starts at the launch on an engagement not yet launched", () => {
    const controls = [
      {
        id: "66666666-6666-7666-8666-666666666666",
        control_ref: "ITGC-AC-01",
        title: "User access provisioning",
        domain: "ACCESS",
        included: true,
      },
    ];
    const applications = [{ id: appId, name: "SAP ERP", description: "" }];
    assert.equal(
      controlsBrief(running({ applications, controls })).next,
      "Controls are in place; their work has started.",
    );
    assert.equal(
      controlsBrief(running({ applications, controls, started: false })).next,
      "Controls are in place; their work starts when the engagement is launched.",
    );
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

// Rewritten 17 November 2026 (the product owner: the scope is never finalized). Old: four
// steps, the last "Review and finalize", current once controls were selected and done once
// the scope was finalized. New: three steps; selecting the controls completes the workflow.
describe("the Systems & Processes workflow", () => {
  const states = (onboarding: Onboarding) =>
    scopeSteps(onboarding).map((step) => `${step.key}:${step.state}`);

  it("starts with the systems, then the processes and the controls", () => {
    assert.deepEqual(states(running()), [
      "systems:now",
      "processes:todo",
      "controls:todo",
    ]);
    assert.deepEqual(states(withSystem()), [
      "systems:done",
      "processes:now",
      "controls:todo",
    ]);
    assert.deepEqual(
      scopeSteps(running()).map((step) => step.pane),
      // Select controls opens the Controls page.
      ["systems", "processes", null],
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
    // Nothing is left to do once a control is selected: no finalize step waits.
    assert.deepEqual(states(selected), [
      "systems:done",
      "processes:todo",
      "controls:done",
    ]);
  });

  // Added 18 November 2026 (design review): steps 1 and 2 are buttons, which the global
  // button rule centres, and step 3 a link, which sat at the left without the hover.
  it("lines every step up at the left, with the same hover, button or link", () => {
    const css = readFileSync("apps/web/app/controls-setup.css", "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const body = css.match(/\n\.sp-step-body \{([^}]*)\}/)?.[1] ?? "";
    assert.match(body, /justify-content: flex-start;/);
    assert.match(
      css,
      /\n\.sp-step-body:hover \{[^}]*background: var\(--surface-muted\);/,
    );
    assert.doesNotMatch(css, /button\.sp-step-body:hover/);
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

// Added 18 November 2026 (design review): at 390 px wide the page's Add menu ran past the
// window's right edge. Once its side is chosen it moves back inside the window, and never
// past the left edge; the CSS caps its width at the window's, less the gutters.
describe("the page's Add menu on a narrow window", () => {
  const source = readFileSync("apps/web/src/row-menu.tsx", "utf8").replace(
    /\r\n/g,
    "\n",
  );
  // The pure placement rule, taken from the component (a .tsx the tests cannot import).
  const declared = source.match(
    /export function inWindowShift\(([\s\S]*?)\n\}\n/,
  )?.[0];
  assert.ok(declared, "row-menu.tsx declares inWindowShift");
  const inWindowShift = new Function(
    "WINDOW_GUTTER",
    `${declared.replace(/^export /, "").replace(/: number/g, "")}; return inWindowShift;`,
  )(16) as (left: number, right: number, width: number) => number;

  it("moves back from the right edge and never past the left one", () => {
    // Fits: stays put.
    assert.equal(inWindowShift(100, 300, 390), 0);
    // Runs 40 px past the right gutter (374): moves back 40.
    assert.equal(inWindowShift(150, 414, 390), -40);
    // Starts left of the left gutter: moves right to it.
    assert.equal(inWindowShift(4, 260, 390), 12);
    // Wider than the room: its left edge stays at the gutter.
    assert.equal(inWindowShift(20, 420, 390), -4);
    assert.equal(inWindowShift(0, 500, 390), 16);
  });

  it("is placed before it is painted, after its side is chosen", () => {
    assert.match(source, /useLayoutEffect\(\(\) => \{/);
    assert.match(
      source,
      /inWindowShift\(rect\.left, rect\.right, window\.innerWidth\)/,
    );
    assert.match(source, /\}, \[open, toRight, up\]\);/);
    // The keyboard behaviour stays: Escape closes it and returns focus; the first item
    // takes the focus when it opens.
    assert.match(source, /event\.key === "Escape"/);
    assert.match(source, /button\.current\?\.focus\(\);/);
    assert.match(
      source,
      /querySelector<HTMLElement>\("\.row-menu-list a, \.row-menu-list button"\)\n\s*\?\.focus\(\);/,
    );
  });

  it("is never wider than the window, and its items wrap on a phone", () => {
    const css = readFileSync("apps/web/app/globals.css", "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const list = css.match(/\n\.row-menu-list \{([^}]*)\}/)?.[1] ?? "";
    assert.match(list, /max-width: calc\(100vw - 2rem\);/);
    assert.match(
      css,
      /@media \(max-width: 760px\) \{\n\s*\.row-menu-list a,\n\s*\.row-menu-list button,\n\s*\.row-menu-list small \{[^}]*white-space: normal;/,
    );
  });
});
