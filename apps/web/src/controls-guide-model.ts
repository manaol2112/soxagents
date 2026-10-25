/**
 * The setup agent in Controls (decided by the product owner): once an engagement runs
 * without controls, the page is its first setup, in three tabs (systems, business
 * processes, controls) under a tile for each, and the agent guides it, with a tour that
 * opens by itself the first time. Worded from the engagement's own setup; no model is
 * called, and the copy keeps the product's neutral voice.
 */

import {
  type Onboarding,
  processRows,
  systemStatus,
} from "./onboarding-model.ts";
import type { TourStep } from "./tour-model.ts";

/** The Controls tour opens by itself the first time; afterwards it waits to be asked. */
export const CONTROLS_GUIDE_SEEN_KEY = "aw.guide.controls-setup";
/** Opens the Controls tour from anywhere on the page. */
export const OPEN_CONTROLS_GUIDE_EVENT = "aw:open-controls-guide";
/** Shows one of the setup's tabs; the event's detail names it. */
export const SHOW_PANE_EVENT = "aw:controls-pane";
/** Opens the wizard that adds a system. */
export const ADD_SYSTEM_EVENT = "aw:add-system";
/** Raised once the wizard has saved a system. */
export const SYSTEM_SAVED_EVENT = "aw:system-saved";

export const CONTROLS_PANES = ["systems", "processes", "controls"] as const;
export type ControlsPane = (typeof CONTROLS_PANES)[number];

/** The tab an address names. Without one, an address with the register's filters (a
 * search, a queue, a stage) opens the Controls tab; anything else opens the systems,
 * which come first. */
export function parseControlsPane(
  value: string | null | undefined,
  registerFiltered = false,
): ControlsPane {
  if ((CONTROLS_PANES as readonly string[]).includes(value ?? "")) {
    return value as ControlsPane;
  }
  return registerFiltered ? "controls" : "systems";
}

export type ScopeStep = {
  key: "systems" | "processes" | "controls" | "finalize";
  title: string;
  detail: string;
  state: "done" | "now" | "todo";
  /** The tab the step is worked in; the last step has none of its own. */
  pane: ControlsPane | null;
};

/**
 * The Systems & Processes workflow's four steps (decided by the product owner): add the
 * systems, add the processes, select the controls, then review and finalize. The current
 * step is the first not done; the processes are optional, so they are current only while
 * nothing past them is done.
 */
export function scopeSteps(
  onboarding: Onboarding,
  finalized: boolean,
): ScopeStep[] {
  const state = controlsSetupState(onboarding);
  const done: Record<ScopeStep["key"], boolean> = {
    systems: state.systems.length > 0,
    processes: state.processes > 0,
    controls: state.controls > 0,
    finalize: finalized,
  };
  const order: ScopeStep["key"][] = [
    "systems",
    ...(done.controls ? [] : (["processes"] as const)),
    "controls",
    "finalize",
  ];
  const now = order.find((key) => !done[key]) ?? null;
  const step = (
    key: ScopeStep["key"],
    title: string,
    detail: string,
    pane: ControlsPane | null,
  ): ScopeStep => ({
    key,
    title,
    detail,
    pane,
    state: done[key] ? "done" : key === now ? "now" : "todo",
  });
  return [
    step(
      "systems",
      "Add systems",
      "Applications and infrastructure",
      "systems",
    ),
    step(
      "processes",
      "Add processes",
      "Business processes and owners",
      "processes",
    ),
    step(
      "controls",
      "Select controls",
      "Standard library or the client's RCM",
      "controls",
    ),
    step(
      "finalize",
      "Review and finalize",
      "Confirm the scope and start planning",
      null,
    ),
  ];
}

const TARGETS = {
  tiles: [".cs-tiles"],
  systems: ["#cs-pane-systems > :first-child"],
  processes: ["#cs-pane-processes > :first-child"],
  library: [".rcm-options > .rcm-option:nth-child(1)"],
  rcm: [".rcm-options > .rcm-option:nth-child(2)"],
  templates: ['section[aria-labelledby="templates-title"]'],
} as const;

/** The names in a list a person typed: split at commas, semicolons, and new lines. */
export function listOf(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,;\n]/)
        .map((item) => item.trim())
        .filter((item) => item !== ""),
    ),
  ];
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What the engagement's controls setup holds now. */
export function controlsSetupState(onboarding: Onboarding): {
  systems: string[];
  /** Systems with the agent's recommendation waiting for a decision. */
  toReview: number;
  /** The client's named processes, and the standard cycles with controls in scope. */
  processes: number;
  controls: number;
  libraryControls: number;
  firmTemplates: number;
} {
  return {
    systems: onboarding.applications.map((system) => system.name),
    toReview: onboarding.applications.filter(
      (system) => systemStatus(system) === "to-decide",
    ).length,
    processes: processRows(onboarding).filter(
      (row) => row.processId !== null || row.inScope.length > 0,
    ).length,
    controls: onboarding.controls.filter((control) => control.included).length,
    libraryControls: onboarding.library.reduce(
      (sum, area) => sum + area.controls,
      0,
    ),
    firmTemplates: onboarding.templates.filter(
      (template) => template.source === "FIRM",
    ).length,
  };
}

function systemsLine(systems: readonly string[]): string {
  if (systems.length === 0) {
    return "No systems yet.";
  }
  const named = systems.slice(0, 3).join(", ");
  return systems.length > 3
    ? `${plural(systems.length, "system")} in scope: ${named}, and ${systems.length - 3} more.`
    : `${plural(systems.length, "system")} in scope: ${named}.`;
}

/** The tour's stops, worded from the setup as it stands. */
export function controlsTourSteps(onboarding: Onboarding): TourStep[] {
  const state = controlsSetupState(onboarding);
  const hasSystems = state.systems.length > 0;
  return [
    {
      id: "welcome",
      targets: TARGETS.tiles,
      title: "Set up the engagement's controls",
      body: [
        "Three tabs: the systems in scope, the business processes, and the controls. Each control set up here gets its walkthrough, evidence request, test, and review.",
        "Nothing is requested from the client until a plan is approved, and nothing is sent until an approver confirms it.",
      ],
      done: true,
    },
    {
      id: "systems",
      pane: "systems",
      targets: TARGETS.systems,
      title: "Add the systems in scope",
      body: hasSystems
        ? [
            systemsLine(state.systems),
            "Add any other system the controls run on, such as a database or the operating system beneath the application.",
          ]
        : [
            "Start with the systems the controls run on, such as the ERP and its database.",
            "Each system is scoped on its own: describe it, and the agent recommends the controls for it. Uploading the client's RCM finds the systems it names instead.",
          ],
      done: hasSystems,
    },
    {
      id: "processes",
      pane: "processes",
      targets: TARGETS.processes,
      title: "Name the business processes",
      body: [
        state.processes > 0
          ? `${plural(state.processes, "process", "processes")} in scope.`
          : "Business process controls are scoped by process: the standard cycles, such as order to cash, and any process of the client's own.",
        "An engagement over IT general controls only can leave this tab empty.",
      ],
      done: state.processes > 0,
    },
    {
      id: "library",
      pane: "controls",
      targets: TARGETS.library,
      title: "Load the standard library",
      body: [
        state.libraryControls > 0
          ? `The firm's library holds ${plural(state.libraryControls, "reviewed control")}, each with its risk, test attributes, suggested evidence, and workpaper template. Choose the areas in scope.`
          : "The firm's library holds reviewed controls, each with its risk, test attributes, suggested evidence, and workpaper template. Choose the areas in scope.",
        hasSystems
          ? "A control that runs on a system is set up once for each system."
          : "It opens once a system is in scope: a control that runs on a system is set up once for each system.",
      ],
      done: state.controls > 0,
    },
    {
      id: "rcm",
      pane: "controls",
      targets: TARGETS.rcm,
      title: "Or upload the client's RCM",
      body: [
        "Use the client's own matrix, as Excel or CSV, in its own format and terms. Its columns are matched to the firm's; every other column is kept under the client's heading.",
        "The systems the RCM names are found and offered for confirmation.",
      ],
      done: state.controls > 0,
    },
    {
      id: "templates",
      pane: "controls",
      targets: TARGETS.templates,
      title: "Check the workpaper templates",
      body: [
        state.firmTemplates === 1
          ? "One of the firm's own templates applies here; the standard ones cover the rest."
          : state.firmTemplates > 1
            ? `${state.firmTemplates} of the firm's own templates apply here; the standard ones cover the rest.`
            : "The standard templates apply unless the firm's own are uploaded or customised.",
        "Preview a template with one of the engagement's own controls once controls are in place.",
      ],
      done: true,
    },
    {
      id: "done",
      targets: [],
      title: "Then the work starts",
      body: [
        "Once controls are set up, this page lists them, and their walkthroughs, evidence requests, tests, and reviews begin.",
        "This tour can be replayed from this page at any time.",
      ],
      done: true,
    },
  ];
}

export type ControlsTile = {
  pane: ControlsPane;
  label: string;
  count: number;
  status: string;
};

/** The tiles above the tabs: how many of each the engagement holds, and where it stands. */
export function controlsTiles(onboarding: Onboarding): ControlsTile[] {
  const state = controlsSetupState(onboarding);
  return [
    {
      pane: "systems",
      label: "Systems",
      count: state.systems.length,
      status:
        state.systems.length === 0
          ? "Not started"
          : state.toReview > 0
            ? `${state.toReview} to review`
            : "In scope",
    },
    {
      pane: "processes",
      label: "Processes",
      count: state.processes,
      status: state.processes === 0 ? "Not started" : "In scope",
    },
    {
      pane: "controls",
      label: "Controls",
      count: state.controls,
      status: "In scope",
    },
  ];
}

export type ControlsBrief = {
  /** What is in place and what is not, in setup's order. */
  checklist: Array<{ label: string; detail: string; done: boolean }>;
  next: string;
  tip: string;
};

/** What the agent panel says beside the Controls setup. */
export function controlsBrief(onboarding: Onboarding): ControlsBrief {
  const state = controlsSetupState(onboarding);
  const hasSystems = state.systems.length > 0;
  return {
    checklist: [
      {
        label: "Systems",
        detail: hasSystems
          ? `${plural(state.systems.length, "system")} in scope`
          : "None yet",
        done: hasSystems,
      },
      {
        label: "Controls",
        detail:
          state.controls > 0
            ? `${plural(state.controls, "control")} in scope`
            : "None yet",
        done: state.controls > 0,
      },
      {
        label: "Workpaper templates",
        detail:
          state.firmTemplates > 0
            ? "The firm's, where uploaded"
            : "Standard templates apply",
        done: true,
      },
    ],
    next: !hasSystems
      ? "Next: add the first system, or upload the client's RCM, which finds the systems it names."
      : state.controls === 0
        ? "Next: load the standard library for these systems, or upload the client's RCM."
        : "Controls are in place; their work has started.",
    tip: "A control added later, or taken out of scope, updates the engagement's work at once: added controls get their work, and a control taken out has its open work cancelled.",
  };
}
