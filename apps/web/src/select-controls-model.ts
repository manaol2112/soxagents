/** Map controls (the product owner's reference, 27 October 2026): the firm's library
 * controls for one system or process, filtered by category and source, searched, and the
 * chosen ones listed beside them. Everything the drawer shows is worked out here. */

import { selectionCategory } from "./controls-guide-model.ts";
import type { Onboarding, SetupSystem } from "./onboarding-model.ts";

export type LibraryOption = {
  libraryKey: string;
  controlRef: string;
  title: string;
  domain: string;
  inScope: boolean;
};

/** Where a control comes from. The library's controls are the firm's standard ones; a
 * client RCM's are matched to them on upload, so every option here is Standard. */
export const SOURCE_LABEL = { STANDARD: "Standard" } as const;
export type SourceKey = keyof typeof SOURCE_LABEL;

export type LibraryFilters = {
  /** The categories shown; the drawer starts on the areas approved for the target. */
  categories: readonly string[];
  /** The sources shown; none ticked shows every source. */
  sources: readonly SourceKey[];
  /** The words typed in the controls search. */
  words: string;
  /** The words typed in the category search. */
  categoryWords: string;
  chosen: readonly string[];
  /** Only the controls the agent recommends or rates potentially applicable. */
  recommendedOnly?: boolean;
};

/** What the agent's review of a system says about one library control. */
export type Recommendation = {
  status: "RECOMMENDED" | "POTENTIAL";
  rationale: string;
  /** The CUECs of an uploaded SOC 1 report this control answers. */
  cuecs: string[];
};

/** The agent's review of a system, for Map controls (decided by the product owner on 27
 * October 2026: CUECs come only from SOC 1 reports uploaded for the system, as since
 * Milestone 8.10; nothing is taken from what such reports usually say). */
export type SystemAdvice = {
  state: "NONE" | "WORKING" | "READY";
  /** The agent; the reviewed rules when no model is set; or the rules standing in for
   * a model call that failed (FALLBACK). */
  source: "AGENT" | "RULES" | "FALLBACK" | "NONE";
  byKey: Record<string, Recommendation>;
  /** CUECs read from the system's uploaded SOC 1 reports. */
  cuecs: number;
};

export function systemAdvice(system: SetupSystem): SystemAdvice {
  const assessment = system.assessment;
  const working =
    assessment !== null &&
    (assessment.status === "PENDING" || assessment.status === "WORKING");
  const cuecsByRef = new Map<string, string[]>();
  let cuecs = 0;
  for (const report of system.socReports) {
    if (report.status !== "READ") {
      continue;
    }
    for (const cuec of report.cuecs) {
      cuecs += 1;
      for (const control of cuec.controls) {
        cuecsByRef.set(control.controlRef, [
          ...(cuecsByRef.get(control.controlRef) ?? []),
          cuec.ref,
        ]);
      }
    }
  }
  const byKey: Record<string, Recommendation> = {};
  for (const candidate of assessment?.candidates ?? []) {
    if (
      candidate.libraryKey === null ||
      (candidate.status !== "RECOMMENDED" && candidate.status !== "POTENTIAL")
    ) {
      continue;
    }
    byKey[candidate.libraryKey] = {
      status: candidate.status,
      rationale: candidate.rationale,
      cuecs: cuecsByRef.get(candidate.controlRef) ?? [],
    };
  }
  const source =
    assessment === null || assessment.source === "NONE"
      ? "NONE"
      : assessment.source;
  return {
    state: working ? "WORKING" : source === "NONE" ? "NONE" : "READY",
    source,
    byKey,
    cuecs,
  };
}

/** Where the recommendations came from, said plainly (the banner's first sentence). */
export function adviceSourceLine(
  source: SystemAdvice["source"],
  name: string,
): string {
  if (source === "FALLBACK") {
    return `The agent's answer for ${name} could not be used, so the reviewed rules suggested these.`;
  }
  if (source === "RULES") {
    return `The reviewed rules suggested these for ${name}.`;
  }
  return `The agent recommended these for ${name}.`;
}

/** Each in-scope system's advice, by its id; a process has none. */
export function adviceBySystem(
  onboarding: Onboarding,
): Record<string, SystemAdvice> {
  return Object.fromEntries(
    onboarding.applications.map((system) => [system.id, systemAdvice(system)]),
  );
}

/** The chosen controls after Accept recommended: every recommended one not already in
 * scope added; potentially applicable ones stay a person's choice. */
export function acceptRecommended(
  chosen: readonly string[],
  options: readonly LibraryOption[],
  advice: SystemAdvice | null,
): string[] {
  const keys = options
    .filter(
      (item) =>
        !item.inScope &&
        advice?.byKey[item.libraryKey]?.status === "RECOMMENDED",
    )
    .map((item) => item.libraryKey);
  return [...new Set([...chosen, ...keys])];
}

export type LibraryView = {
  /** The categories the category search leaves, for the filter. */
  categories: Array<{ key: string; label: string; count: number }>;
  /** Every category, for the All categories picker. */
  allCategories: Array<{ key: string; label: string; count: number }>;
  sources: Array<{ key: SourceKey; label: string; count: number }>;
  /** The All categories picker: every category, one alone, or some other set. */
  categoryChoice: "ALL" | "SOME" | string;
  shown: LibraryOption[];
  /** Shown and not already in scope: what Select all visible ticks. */
  open: LibraryOption[];
  allChosen: boolean;
  /** The chosen controls, in the order chosen. */
  selected: LibraryOption[];
  /** Recommended and not yet in scope, and how many are potentially applicable. */
  recommended: number;
  potential: number;
};

const sourceOf = (_option: LibraryOption): SourceKey => "STANDARD";

export function libraryView(
  options: readonly LibraryOption[],
  filters: LibraryFilters,
  advice: SystemAdvice | null = null,
): LibraryView {
  const counts = new Map<string, { label: string; count: number }>();
  for (const item of options) {
    const category = selectionCategory(item.domain);
    const current = counts.get(category.key);
    counts.set(category.key, {
      label: category.label,
      count: (current?.count ?? 0) + 1,
    });
  }
  const categoryWords = filters.categoryWords.trim().toLowerCase();
  const allCategories = [...counts.entries()].map(([key, value]) => ({
    key,
    ...value,
  }));
  const categories = allCategories.filter(
    (item) =>
      categoryWords === "" || item.label.toLowerCase().includes(categoryWords),
  );
  const sources = (Object.keys(SOURCE_LABEL) as SourceKey[])
    .map((key) => ({
      key,
      label: SOURCE_LABEL[key],
      count: options.filter((item) => sourceOf(item) === key).length,
    }))
    .filter((item) => item.count > 0);
  const words = filters.words.trim().toLowerCase();
  const shown = options.filter(
    (item) =>
      filters.categories.includes(selectionCategory(item.domain).key) &&
      (filters.sources.length === 0 ||
        filters.sources.includes(sourceOf(item))) &&
      (words === "" ||
        `${item.controlRef} ${item.title}`.toLowerCase().includes(words)) &&
      (filters.recommendedOnly !== true ||
        advice?.byKey[item.libraryKey] !== undefined),
  );
  const rated = (status: Recommendation["status"]) =>
    options.filter(
      (item) =>
        !item.inScope && advice?.byKey[item.libraryKey]?.status === status,
    ).length;
  const open = shown.filter((item) => !item.inScope);
  const present = [...counts.keys()];
  const categoryChoice =
    present.length > 0 &&
    present.every((key) => filters.categories.includes(key))
      ? "ALL"
      : filters.categories.length === 1
        ? (filters.categories[0] ?? "SOME")
        : "SOME";
  const byKey = new Map(options.map((item) => [item.libraryKey, item]));
  return {
    categories,
    allCategories,
    sources,
    categoryChoice,
    shown,
    open,
    allChosen:
      open.length > 0 &&
      open.every((item) => filters.chosen.includes(item.libraryKey)),
    selected: filters.chosen
      .map((key) => byKey.get(key))
      .filter((item): item is LibraryOption => item !== undefined),
    recommended: rated("RECOMMENDED"),
    potential: rated("POTENTIAL"),
  };
}

/** The chosen controls after Select all visible: every open one added, or, when all
 * were chosen, those removed. */
export function toggleVisible(
  chosen: readonly string[],
  view: Pick<LibraryView, "open" | "allChosen">,
): string[] {
  const keys = view.open.map((item) => item.libraryKey);
  return view.allChosen
    ? chosen.filter((key) => !keys.includes(key))
    : [...new Set([...chosen, ...keys])];
}

/** The categories after the All categories picker: all of them, or one alone. */
export function pickCategory(
  options: readonly LibraryOption[],
  choice: string,
): string[] {
  const present = [
    ...new Set(options.map((item) => selectionCategory(item.domain).key)),
  ];
  return choice === "ALL" || !present.includes(choice) ? present : [choice];
}

/** The chosen controls after a click on a row: that control alone, or, with Shift held
 * after an earlier click, every visible open control between the two, taking the state
 * the clicked row moves to. Controls already in scope are never chosen. */
export function clickRow(
  chosen: readonly string[],
  shown: readonly LibraryOption[],
  key: string,
  anchor: string | null,
  range: boolean,
): string[] {
  const on = !chosen.includes(key);
  const from =
    anchor === null
      ? -1
      : shown.findIndex((item) => item.libraryKey === anchor);
  const to = shown.findIndex((item) => item.libraryKey === key);
  const keys =
    range && from >= 0 && to >= 0
      ? shown
          .slice(Math.min(from, to), Math.max(from, to) + 1)
          .filter((item) => !item.inScope)
          .map((item) => item.libraryKey)
      : [key];
  return on
    ? [...new Set([...chosen, ...keys])]
    : chosen.filter((item) => !keys.includes(item));
}
