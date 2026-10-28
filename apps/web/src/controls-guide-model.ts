/**
 * The setup agent in Controls (decided by the product owner): once an engagement runs
 * without controls, the page is its first setup, in three tabs (systems, business
 * processes, controls) under a tile for each, and the agent guides it, with a tour that
 * opens by itself the first time. Worded from the engagement's own setup; no model is
 * called, and the copy keeps the product's neutral voice.
 */

import {
  CONTROL_AREAS,
  type ControlArea,
  inScopeSystems,
  type Onboarding,
  processRows,
  systemStatus,
} from "./onboarding-model.ts";
import {
  DESCRIPTION_KINDS,
  POLICY_KINDS,
  type Policy,
  type PriorYearReference,
  policiesTile,
  referencesTile,
} from "./references-model.ts";
import type { TourStep } from "./tour-model.ts";

/** Opens the Add business process wizard (SP3). */
export const ADD_PROCESS_EVENT = "aw:add-process";
/** Raised once the wizard has saved a process. */
export const PROCESS_SAVED_EVENT = "aw:process-saved";
/** Opens Select controls (SP4); the detail may name the system or process. */
export const SELECT_CONTROLS_EVENT = "aw:select-controls";
/** Raised once controls were selected. */
export const CONTROLS_SAVED_EVENT = "aw:controls-saved";
/** Opens the client's RCM upload (SP5). */
export const RCM_UPLOAD_EVENT = "aw:rcm-upload";
/** Opens Review and finalize (SP6). */
export const FINALIZE_EVENT = "aw:finalize-scope";

/** The control area a library domain falls in. */
export function areaOf(domain: string): ControlArea {
  if (domain === "ACCESS" || domain === "CHANGE" || domain === "OPERATIONS") {
    return "ITGC";
  }
  if (domain === "ITAC" || domain === "IPE") {
    return domain;
  }
  return "BUSINESS";
}

/** The category Select controls files a library control under: its area, with the
 * entity-level controls apart from the other business process controls. */
export function selectionCategory(domain: string): {
  key: string;
  label: string;
} {
  if (domain === "ENTITY") {
    return { key: "ENTITY", label: "Entity-level controls" };
  }
  const area = areaOf(domain);
  return {
    key: area,
    label: CONTROL_AREAS.find((item) => item.id === area)?.label ?? area,
  };
}

export type ScopeReview = {
  totals: { systems: number; processes: number; controls: number };
  byArea: Array<{ area: ControlArea; label: string; controls: number }>;
  systems: Array<{
    id: string;
    name: string;
    controls: number;
    /** Areas a person approved with no control selected in them yet. */
    open: string[];
  }>;
  processes: Array<{
    id: string;
    name: string;
    controls: number;
    systems: number;
  }>;
  /** What deserves a look before finalizing; none of it blocks. */
  notes: string[];
  /** Why the scope cannot be finalized yet; null when it can. */
  blocked: string | null;
};

/**
 * Review and finalize (decided by the product owner, SP6): the scope as it stands, what
 * deserves a look, and whether it can be finalized. The counts are the ones the person
 * confirms; the API refuses them if the scope changed meanwhile.
 */
export function scopeReview(onboarding: Onboarding): ScopeReview {
  const included = onboarding.controls.filter((control) => control.included);
  const systems = inScopeSystems(onboarding).map((system) => {
    const mine = included.filter(
      (control) => control.applicationId === system.id,
    );
    const open = (system.controlAreas ?? []).filter(
      (area) =>
        area !== "BUSINESS" &&
        !mine.some((control) => areaOf(control.domain) === area),
    );
    return {
      id: system.id,
      name: system.name,
      controls: mine.length,
      open: open.map(
        (area) => CONTROL_AREAS.find((item) => item.id === area)?.label ?? area,
      ),
    };
  });
  const processes = onboarding.processes.map((process) => ({
    id: process.id,
    name: process.name,
    controls: included.filter((control) => control.processId === process.id)
      .length,
    systems: process.systemIds.length,
  }));
  const notes = [
    ...systems
      .filter((system) => system.controls === 0)
      .map((system) => `${system.name} has no control selected.`),
    ...systems
      .filter((system) => system.controls > 0 && system.open.length > 0)
      .map(
        (system) =>
          `${system.name}: no control selected yet in ${system.open.map((label) => label.charAt(0).toLowerCase() + label.slice(1)).join(", ")}.`,
      ),
    ...processes
      .filter((process) => process.systems === 0)
      .map((process) => `${process.name} is linked to no system.`),
  ];
  return {
    totals: {
      systems: inScopeSystems(onboarding).length,
      processes: onboarding.processes.length,
      controls: included.length,
    },
    byArea: CONTROL_AREAS.map((area) => ({
      area: area.id,
      label: area.label,
      controls: included.filter((control) => areaOf(control.domain) === area.id)
        .length,
    })),
    systems,
    processes,
    notes,
    blocked: !onboarding.started
      ? "Launch the engagement from onboarding first."
      : included.length === 0
        ? "Select at least one control first."
        : null,
  };
}

/** The Controls tour opens by itself the first time; afterwards it waits to be asked. */
export const CONTROLS_GUIDE_SEEN_KEY = "aw.guide.controls-setup";
/** Opens the Controls tour from anywhere on the page. */
export const OPEN_CONTROLS_GUIDE_EVENT = "aw:open-controls-guide";
/** Shows one of the setup's tabs; the event's detail names it. */
export const SHOW_PANE_EVENT = "aw:controls-pane";
/** A tab's count changed in the page (a policy added, a reference analysed): its tile
 * and tab show it without a reload. The detail is { pane, count, status }. */
export const PANE_COUNT_EVENT = "aw:pane-count";

/** Opens the wizard that adds a system. */
export const ADD_SYSTEM_EVENT = "aw:add-system";
/** Raised once the wizard has saved a system. */
export const SYSTEM_SAVED_EVENT = "aw:system-saved";

// Policies and procedures sit beside what they govern (decided by the product owner on 25
// October 2026); the prior year's work is Planning's.
// Controls are a page of their own, driven by what is selected for each system and
// process; the references describing them sit with the scope (26 October 2026).
export const CONTROLS_PANES = [
  "systems",
  "processes",
  "policies",
  "references",
] as const;
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
  void registerFiltered;
  return "systems";
}

export type ScopeStep = {
  key: "systems" | "processes" | "controls" | "finalize";
  title: string;
  detail: string;
  state: "done" | "now" | "todo";
  /** The tab the step is worked in; the controls are on their own page, and the last
   * step has none of its own. */
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
      "For each system and process, on Controls",
      null,
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
  library: [".sp-step.is-controls"],
  finalize: [".sp-step.is-finalize"],
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
    systems: inScopeSystems(onboarding).map((system) => system.name),
    toReview: inScopeSystems(onboarding).filter(
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
        "The systems in scope, the business processes, the policies and procedures that govern them, and the references that describe them. The controls selected for each are listed on the Controls page; each gets its walkthrough, evidence request, test, and review once the scope is finalized.",
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
      pane: "systems",
      targets: TARGETS.library,
      title: "Select the controls",
      body: [
        state.libraryControls > 0
          ? `The firm's library holds ${plural(state.libraryControls, "reviewed control")}, each with its risk, test attributes, suggested evidence, and workpaper template. Select them for each system and process, by category.`
          : "The firm's library holds reviewed controls, each with its risk, test attributes, suggested evidence, and workpaper template. Select them for each system and process, by category.",
        hasSystems
          ? "The categories start on the areas approved for the system or process."
          : "Controls are selected for a system or a process: add one first.",
      ],
      done: state.controls > 0,
    },
    {
      id: "finalize",
      targets: TARGETS.finalize,
      title: "Review and finalize",
      body: [
        "Nothing starts while the scope is being set up. Review it, then confirm it: each control's walkthrough, evidence request, test, and review are created then.",
        "Evidence requests are drafted for approval; nothing is sent until an approver confirms it.",
      ],
      done: false,
    },
    {
      id: "done",
      targets: [],
      title: "Then the work starts",
      body: [
        "Once the scope is final, the Controls page lists the controls and where each stands.",
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
export function controlsTiles(
  onboarding: Onboarding,
  references: {
    policies: readonly Policy[];
    priorYear?: readonly PriorYearReference[];
  } = { policies: [] },
): ControlsTile[] {
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
      pane: "policies",
      label: "Policies & procedures",
      ...policiesTile(
        references.policies.filter((item) => POLICY_KINDS.includes(item.kind)),
      ),
    },
    {
      pane: "references",
      label: "References",
      ...referencesTile(
        references.policies.filter((item) =>
          DESCRIPTION_KINDS.includes(item.kind),
        ),
        references.priorYear ?? [],
      ),
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
