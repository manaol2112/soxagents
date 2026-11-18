/** Opens a section of the test plan in the control's Plan step (its tab's key). */
export const PLAN_TAB_EVENT = "aw:plan-tab";
/** The section of the test plan open now, for the assistant beside it. */
export const PLAN_VIEW_EVENT = "aw:plan-view";

const ENVIRONMENT_LABEL: Record<string, string> = {
  PRODUCTION: "Production",
  NON_PRODUCTION: "Non-production",
  BOTH: "Production and non-production",
};

/** The control's context, as its records state it; "Not stated" where they do not. */
export function contextRows(control: {
  applicationName: string;
  category: string;
  categoryLabel: string;
  area: string;
  ownerName: string;
  ownerEmail: string;
  environment: string;
  /** How often it operates and whether it is key, where the page states them. */
  frequencyLabel?: string;
  keyControl?: boolean;
}): Array<{ key: string; label: string; value: string }> {
  const stated = (value: string) =>
    value.trim() === "" ? "Not stated" : value;
  return [
    {
      key: "system",
      label: "System",
      value: stated(control.applicationName),
    },
    {
      key: "process",
      label: "Process",
      value: stated(control.categoryLabel),
    },
    { key: "area", label: "Control area", value: stated(control.area) },
    {
      key: "owner",
      label: "Owner",
      value: stated(control.ownerName || control.ownerEmail),
    },
    {
      key: "environment",
      label: "Environment",
      value: stated(ENVIRONMENT_LABEL[control.environment] ?? ""),
    },
    ...(control.frequencyLabel !== undefined
      ? [
          {
            key: "frequency",
            label: "Frequency",
            value: stated(control.frequencyLabel),
          },
        ]
      : []),
    ...(control.keyControl !== undefined
      ? [
          {
            key: "key",
            label: "Key control",
            value: control.keyControl ? "Yes" : "No",
          },
        ]
      : []),
  ];
}

/** The question asked of the agent, about this control. */
export function askAbout(ref: string, title: string, question: string): string {
  return `About ${ref} ${title}: ${question.trim()}`;
}

const CONFIDENCE_RANK = ["NOT_ESTABLISHED", "LOW", "MODERATE", "HIGH"] as const;
type Confidence = (typeof CONFIDENCE_RANK)[number];

/** The plan's confidence, as cautious as its weakest part: the lowest confidence its
 * attribute definitions state, or null where none states one. */
export function lowestConfidence(
  stated: ReadonlyArray<string | null>,
): Confidence | null {
  const ranks = stated
    .map((value) => CONFIDENCE_RANK.indexOf(value as Confidence))
    .filter((rank) => rank >= 0);
  return ranks.length === 0
    ? null
    : (CONFIDENCE_RANK[Math.min(...ranks)] ?? null);
}

/** The governing documents a control cites: its policies and procedures, and the
 * narratives and diagrams that describe its process. */
export const GOVERNING_KINDS: Record<string, string> = {
  POLICY: "Policy",
  PROCEDURE: "Procedure",
  NARRATIVE: "Process narrative",
  FLOWCHART: "Flow diagram",
};

/** How many of the control's activities happened on the given day (UTC, as its timeline
 * shows times). */
export function activitiesOn(
  items: ReadonlyArray<{ at: string }>,
  day: Date,
): number {
  const key = day.toISOString().slice(0, 10);
  return items.filter((item) => item.at.slice(0, 10) === key).length;
}
