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

// The destinations: this engagement's Home, Controls, Testing, Evidence, Reports and
// Settings (Milestone 2c), then the firm's Engagements and Library, each its own page
// in the menu (decided by the product owner) rather than a tab of Settings. Reports and
// Settings are tabs over the pages that existed before; the older section names
// redirect to them with the same record open, so stored links keep working. The agent
// console and the approvals page stay reachable by their addresses, out of the menu,
// as contextual pages.

export const DESTINATIONS: readonly SectionId[] = [
  "overview",
  "controls",
  "testing",
  "evidence",
  "reports",
  "settings",
  "projects",
  "library",
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
export const SETTINGS_TABS = ["engagement", "tasks", "workforce"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  engagement: "Engagement setup",
  workforce: "AI workforce",
  tasks: "Tasks",
};
/** The first tab that is the firm's rather than this engagement's. */
export const SETTINGS_FIRM_FROM: SettingsTab = "workforce";

/** The page a destination's tab renders: the section that existed before. */
const REPORT_PAGES: Record<ReportTab, SectionId> = {
  deficiencies: "deficiencies",
  schedule: "plan",
  timeline: "timeline",
  status: "reports",
};
const SETTINGS_PAGES: Record<SettingsTab, SectionId> = {
  engagement: "setup",
  workforce: "agents",
  tasks: "tasks",
};
/** The Settings tabs that became their own destinations, and the section each opens. */
const LEFT_SETTINGS: Record<string, SectionId> = {
  library: "library",
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
  const left =
    requested === "settings"
      ? LEFT_SETTINGS[first(params.view) ?? ""]
      : undefined;
  const moved: { section: SectionId; tab?: string } | undefined =
    left !== undefined ? { section: left } : MOVED[requested];
  if (moved !== undefined) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      // A Settings tab that left drops its `view`, which named the tab.
      if (
        key === "section" ||
        (key === "view" && (moved.tab !== undefined || left !== undefined))
      ) {
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

/**
 * Where setup lives, which depends on the engagement (decided by the product owner): until
 * it is launched, setup is onboarding, its own page (`section=setup`), guided by the setup
 * agent; once launched, it is the Engagement setup tab of Settings. Each address is sent
 * to the other when it names the wrong one, with every other parameter kept. Null when it
 * stands, or when no engagement is open.
 */
export function setupPlacement(
  route: Route,
  projectStatus: string | null,
  params: Record<string, string | string[] | undefined>,
): string | null {
  if (projectStatus === null) {
    return null;
  }
  const draft = projectStatus === "DRAFT";
  const toOnboarding =
    route.section === "settings" && route.page === "setup" && draft;
  const toSettings = route.section === "setup" && !draft;
  if (!toOnboarding && !toSettings) {
    return null;
  }
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "section" || key === "view") {
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === "string" && item !== "") {
        query.append(key, item);
      }
    }
  }
  if (toSettings) {
    query.set("section", "settings");
    query.set("view", "engagement");
  } else {
    query.set("section", "setup");
  }
  return `/?${query.toString()}`;
}

/** A setup address pointed at where setup lives for this engagement (as setupPlacement
 * decides), so links never take the redirect: the page has begun to stream by then, and
 * the browser reports the hop as a failed server render. */
export function placeSetup(
  params: URLSearchParams,
  projectStatus: string | null,
): URLSearchParams {
  if (
    params.get("section") === "setup" &&
    projectStatus !== null &&
    projectStatus !== "DRAFT"
  ) {
    params.set("section", "settings");
    params.set("view", "engagement");
  }
  return params;
}

/** Where a posted setup form returns, by the page it came from (its referer): Controls
 * keeps its own setup, Settings its Engagement setup tab, and onboarding its own page. */
export function setupReturn(
  params: URLSearchParams,
  referer: string | null,
): URLSearchParams {
  let from: string | null = null;
  try {
    from =
      referer === null ? null : new URL(referer).searchParams.get("section");
  } catch {
    from = null;
  }
  if (from === "controls") {
    params.set("section", "controls");
  } else if (from === "settings") {
    params.set("section", "settings");
    params.set("view", "engagement");
  } else {
    params.set("section", "setup");
  }
  return params;
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
