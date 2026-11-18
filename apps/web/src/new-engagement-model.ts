/**
 * The New engagement page (decided by the product owner): the frameworks an engagement
 * covers, chosen from the standard library's categories with their live counts, and how
 * that choice carries into setup. Kept out of the page so it is tested on its own.
 */

export const FRAMEWORKS = [
  "ITGC",
  "BUSINESS",
  "ITAC",
  "KEY_REPORT",
  "ENTITY",
] as const;
export type Framework = (typeof FRAMEWORKS)[number];

export const FRAMEWORK_INFO: Record<
  Framework,
  { label: string; short: string; detail: string; tone: string }
> = {
  ITGC: {
    short: "Access, change, and IT operations",
    label: "IT general controls",
    detail:
      "Logical access, change management, and IT operations over the systems that support financial reporting.",
    tone: "accent",
  },
  BUSINESS: {
    short: "Business cycles and manual controls",
    label: "Business process controls",
    detail: "The business cycles and their manual controls.",
    tone: "success",
  },
  ITAC: {
    short: "Automated controls in key applications",
    label: "Application controls (ITAC)",
    detail: "Automated controls configured in the key applications.",
    tone: "info",
  },
  KEY_REPORT: {
    short: "Reports relied on for financial reporting",
    label: "Key reports (IPE)",
    detail:
      "System reports the controls rely on, tested for completeness and accuracy.",
    tone: "warning",
  },
  ENTITY: {
    short: "Tone, risk assessment, and monitoring",
    label: "Entity-level controls",
    detail:
      "Tone at the top, risk assessment, and monitoring across the entity.",
    tone: "ai",
  },
};

/** What a new engagement covers until someone changes it: the SOX scope the page has
 * always opened with (IT general, business process, application controls, key reports). */
export const DEFAULT_FRAMEWORKS: readonly Framework[] = [
  "ITGC",
  "BUSINESS",
  "ITAC",
  "KEY_REPORT",
];

export function isFramework(value: string): value is Framework {
  return (FRAMEWORKS as readonly string[]).includes(value);
}

/** A selection in the page's order, each once; unknown keys are dropped. */
export function orderedFrameworks(values: readonly string[]): Framework[] {
  return FRAMEWORKS.filter((key) => values.includes(key));
}

/** The form's field: the chosen frameworks, comma-separated. */
export function frameworksField(values: readonly Framework[]): string {
  return orderedFrameworks(values).join(",");
}

/** The form's field read back: the frameworks, or "invalid" when one is not known or
 * none is chosen; null when the field was not sent (setup keeps its usual selection). */
export function parseFrameworksField(
  value: string | undefined,
): Framework[] | null | "invalid" {
  if (value === undefined) {
    return null;
  }
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  if (items.length === 0 || !items.every(isFramework)) {
    return "invalid";
  }
  return orderedFrameworks(items);
}

/**
 * The engagement type the frameworks imply: business process or entity-level controls
 * make it SOX in full; IT controls alone, SOX ITGC. A non-SOX IT audit is chosen in
 * setup's profile step.
 */
export function engagementTypeFor(frameworks: readonly Framework[]): string {
  return frameworks.includes("BUSINESS") || frameworks.includes("ENTITY")
    ? "SOX_FULL"
    : "SOX_ITGC";
}

const ITGC_AREAS = new Set(["ACCESS", "CHANGE", "OPERATIONS"]);

/** The framework a setup area belongs to, as the library categorises its controls. */
export function frameworkOfArea(area: string): Framework {
  if (ITGC_AREAS.has(area)) {
    return "ITGC";
  }
  if (area === "ITAC") {
    return "ITAC";
  }
  if (area === "IPE") {
    return "KEY_REPORT";
  }
  if (area === "ENTITY") {
    return "ENTITY";
  }
  return "BUSINESS";
}

/** Whether setup's Controls step opens with an area selected: the engagement's frameworks
 * when it chose some, else the IT general controls, as before. */
export function areaSelected(
  area: string,
  frameworks: readonly string[] | null,
): boolean {
  return frameworks === null
    ? ITGC_AREAS.has(area)
    : frameworks.includes(frameworkOfArea(area));
}

/** How many of the library's controls the chosen frameworks hold. */
export function selectedControls(
  counts: Partial<Record<string, number>>,
  frameworks: readonly Framework[],
): number {
  return frameworks.reduce((sum, key) => sum + (counts[key] ?? 0), 0);
}

const LONG_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** The audit period a period end implies, the year that ends on it (the rule the plans
 * use): "Jan 1, 2026 – Dec 31, 2026"; "" when the date is not set or not valid. */
export function periodRange(periodEnd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    return "";
  }
  const end = new Date(`${periodEnd}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) {
    return "";
  }
  const start = new Date(end);
  start.setUTCFullYear(end.getUTCFullYear() - 1);
  start.setUTCDate(start.getUTCDate() + 1);
  return `${LONG_DATE.format(start)} – ${LONG_DATE.format(end)}`;
}
