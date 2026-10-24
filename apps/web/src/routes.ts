/**
 * The workspace's sections, the six destinations (Milestone 2c) and the routing from an
 * address to the page it renders, with the redirects of the older sections. No imports:
 * the edge proxy (apps/web/proxy.ts) answers the redirects with this same table before
 * anything renders, and the page applies it again as a fallback.
 */

export const SECTIONS = [
  "console",
  "overview",
  "projects",
  "agents",
  "tasks",
  "evidence",
  "approvals",
  "setup",
  "controls",
  "planning",
  "testing",
  "plan",
  "timeline",
  "deficiencies",
  "library",
  "reports",
  "settings",
] as const;

export type SectionId = (typeof SECTIONS)[number];

export function parseSection(value: string | null): SectionId {
  if (
    value === "projects" ||
    value === "agents" ||
    value === "tasks" ||
    value === "evidence" ||
    value === "approvals" ||
    value === "setup" ||
    value === "controls" ||
    value === "planning" ||
    value === "testing" ||
    value === "plan" ||
    value === "timeline" ||
    value === "deficiencies" ||
    value === "library" ||
    value === "overview" ||
    value === "console" ||
    value === "reports" ||
    value === "settings"
  ) {
    return value;
  }
  // An engagement opens on its home: where it stands and what to do next.
  return "overview";
}

// The six destinations (Milestone 2c): Home, Controls, Testing, Evidence, Reports and
// Settings. Reports and Settings are tabs over the pages that existed before; the older
// section names redirect to them with the same record open, so stored links keep
// working. The agent console, the approvals page and the engagements page stay
// reachable by their addresses, out of the menu, as contextual pages.

export const DESTINATIONS: readonly SectionId[] = [
  "overview",
  "controls",
  "testing",
  "evidence",
  "reports",
  "settings",
];

export const REPORT_TABS = [
  "deficiencies",
  "schedule",
  "timeline",
  "status",
] as const;
export type ReportTab = (typeof REPORT_TABS)[number];
export const REPORT_TAB_LABELS: Record<ReportTab, string> = {
  deficiencies: "Deficiencies",
  schedule: "Schedule",
  timeline: "Timeline",
  status: "Status and reports",
};

/** This engagement's settings first, then the firm's (from `SETTINGS_FIRM_FROM` on). */
export const SETTINGS_TABS = [
  "engagement",
  "tasks",
  "library",
  "workforce",
  "engagements",
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  engagement: "Engagement setup",
  library: "Standard library",
  workforce: "AI workforce",
  tasks: "Tasks",
  engagements: "All engagements",
};
/** The first tab that is the firm's rather than this engagement's. */
export const SETTINGS_FIRM_FROM: SettingsTab = "library";

/** The page a destination's tab renders: the section that existed before. */
const REPORT_PAGES: Record<ReportTab, SectionId> = {
  deficiencies: "deficiencies",
  schedule: "plan",
  timeline: "timeline",
  status: "reports",
};
const SETTINGS_PAGES: Record<SettingsTab, SectionId> = {
  engagement: "setup",
  library: "library",
  workforce: "agents",
  tasks: "tasks",
  engagements: "projects",
};

export function parseReportTab(value: string | null | undefined): ReportTab {
  return (REPORT_TABS as readonly string[]).includes(value ?? "")
    ? (value as ReportTab)
    : "deficiencies";
}

export function parseSettingsTab(
  value: string | null | undefined,
): SettingsTab {
  return (SETTINGS_TABS as readonly string[]).includes(value ?? "")
    ? (value as SettingsTab)
    : "engagement";
}

export type Route = {
  /** The destination (or retained page) the address names. */
  section: SectionId;
  /** The page rendered inside it, by the section name the loaders know. */
  page: SectionId;
  /** The tab inside Reports or Settings (their `view`), when the address names one. */
  tab: string | null;
  /** Where an older address now lives, with its record kept; null when it stands. */
  redirect: string | null;
};

/** The older sections and the destination (with its tab) each now opens in. The
 * record-bearing parameters travel unchanged; Test plans' `view=phases` stays `view`
 * on Testing, which has no other tab. */
const MOVED: Record<string, { section: SectionId; tab?: string }> = {
  planning: { section: "testing" },
  plan: { section: "reports", tab: "schedule" },
  timeline: { section: "reports", tab: "timeline" },
  deficiencies: { section: "reports", tab: "deficiencies" },
  setup: { section: "settings", tab: "engagement" },
  library: { section: "settings", tab: "library" },
  agents: { section: "settings", tab: "workforce" },
  tasks: { section: "settings", tab: "tasks" },
};

/** The route for an address: the destination, the page to render and, for an older
 * section, the address to redirect to with every other parameter kept. */
export function resolveRoute(
  params: Record<string, string | string[] | undefined>,
): Route {
  const first = (value: string | string[] | undefined): string | null =>
    typeof value === "string" && value !== ""
      ? value
      : Array.isArray(value) && typeof value[0] === "string" && value[0] !== ""
        ? value[0]
        : null;
  const requested = first(params.section) ?? "overview";
  const moved = MOVED[requested];
  if (moved !== undefined) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === "section" || (key === "view" && moved.tab !== undefined)) {
        continue;
      }
      for (const item of Array.isArray(value) ? value : [value]) {
        if (typeof item === "string" && item !== "") {
          query.append(key, item);
        }
      }
    }
    query.set("section", moved.section);
    if (moved.tab !== undefined) {
      // The destination's tab travels as `view` (as Testing's does), so a page's own
      // `tab` (a control's plan tab, the library's) still opens as before.
      query.set("view", moved.tab);
    }
    return {
      section: moved.section,
      page: moved.section,
      tab: moved.tab ?? null,
      redirect: `/?${query.toString()}`,
    };
  }
  const section = parseSection(requested);
  if (section === "reports") {
    const tab = parseReportTab(first(params.view));
    return { section, page: REPORT_PAGES[tab], tab, redirect: null };
  }
  if (section === "settings") {
    const tab = parseSettingsTab(first(params.view));
    return { section, page: SETTINGS_PAGES[tab], tab, redirect: null };
  }
  return { section, page: section, tab: null, redirect: null };
}

/** An address built for an older section, rewritten to the destination that holds the
 * page now (the same table the redirects use), so internal links never take the hop. */
export function canonicalQuery(params: URLSearchParams): URLSearchParams {
  const moved = MOVED[params.get("section") ?? ""];
  if (moved === undefined) {
    return params;
  }
  params.set("section", moved.section);
  if (moved.tab !== undefined) {
    params.set("view", moved.tab);
  }
  return params;
}

/** The destination's address for one of its tabs. */
export function destinationHref(
  section: "reports" | "settings",
  tab: string,
  organizationId: string,
  projectId: string | null,
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams({ organization: organizationId });
  if (projectId !== null) {
    params.set("project", projectId);
  }
  params.set("section", section);
  params.set("view", tab);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== "") {
      params.set(key, value);
    }
  }
  return `/?${params.toString()}`;
}
