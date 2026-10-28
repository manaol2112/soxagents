/**
 * The control workspace's side panels (decided by the product owner on 25 October 2026):
 * the section menu, the AI assistant's suggestions, and the control's context. Each reads
 * what the records already hold; nothing here decides or derives state. The one drafted
 * item, the common challenges, comes from the planning agent on request.
 */

import type { Design } from "./control-context-model.ts";

/** Opens a section of the test plan in the control's Plan step (its tab's key). */
export const PLAN_TAB_EVENT = "aw:plan-tab";
/** The section of the test plan open now, for the assistant beside it. */
export const PLAN_VIEW_EVENT = "aw:plan-view";

export type RecordSection =
  | "OVERVIEW"
  | "PLAN"
  | "REQUEST"
  | "TEST"
  | "CONCLUDE"
  | "REVIEW"
  | "HISTORY";

export const SECTION_MENU: ReadonlyArray<{
  key: RecordSection;
  label: string;
}> = [
  { key: "OVERVIEW", label: "Overview" },
  { key: "PLAN", label: "Test plan" },
  { key: "REQUEST", label: "Evidence requests" },
  { key: "TEST", label: "Test results" },
  { key: "CONCLUDE", label: "Conclusions" },
  { key: "REVIEW", label: "Review & sign-off" },
  { key: "HISTORY", label: "History" },
];

/** The section open now: History when the activity record is asked for, a step when the
 * address names one, else the overview (the control where it stands). */
export function openSection(
  step: string | null,
  activity: boolean,
): RecordSection {
  if (activity) {
    return "HISTORY";
  }
  const named = (step ?? "").toUpperCase();
  return SECTION_MENU.some((item) => item.key === named && named !== "HISTORY")
    ? (named as RecordSection)
    : "OVERVIEW";
}

/** Where the control stands, for the bar that stays in view once its header scrolls
 * away: "Step 2 of 5 · Evidence requests". */
export function stepPosition(step: string): string {
  const steps = SECTION_MENU.filter(
    (item) => item.key !== "OVERVIEW" && item.key !== "HISTORY",
  );
  const index = steps.findIndex((item) => item.key === step.toUpperCase());
  return index < 0
    ? ""
    : `Step ${index + 1} of ${steps.length} · ${steps[index]?.label ?? ""}`;
}

/** Where the control's information typically comes from: what its design says it uses,
 * then the evidence the RCM lists for it, once each. */
export function informationSources(
  design: Design | null,
  pbcItems: readonly string[],
): string[] {
  const names = [
    ...(design?.information ?? []).map((item) =>
      item.kind === ""
        ? item.name
        : `${item.name} (${item.kind.toLowerCase()})`,
    ),
    ...pbcItems,
  ]
    .map((item) => item.trim())
    .filter((item) => item !== "");
  return [...new Set(names)];
}

/** The answers clients usually give, per question the control asks. */
export function exampleAnswers(
  design: Design | null,
): Array<{ question: string; answers: string[] }> {
  return (design?.slots ?? [])
    .filter((slot) => !slot.automatic && slot.options.length > 0)
    .map((slot) => ({
      question: slot.question || slot.label,
      answers: [...slot.options],
    }));
}

/** The controls this one relies on, linked when the engagement has them: the same
 * system's first, else any. */
export function relatedControls(
  design: Design | null,
  controls: ReadonlyArray<{
    id: string;
    controlRef: string;
    applicationName: string;
  }>,
  system: string,
): Array<{ ref: string; id: string | null }> {
  return [...new Set(design?.itgcs ?? [])]
    .filter((ref) => ref.trim() !== "")
    .map((ref) => {
      const same = (item: { controlRef: string }) =>
        item.controlRef.toUpperCase() === ref.toUpperCase();
      const found =
        controls.find(
          (item) => same(item) && item.applicationName === system,
        ) ?? controls.find(same);
      return { ref, id: found?.id ?? null };
    });
}

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

export type Challenge = { title: string; detail: string };

/** The planning agent's common challenges as the API answers them. */
export function parseChallenges(value: unknown): {
  challenges: Challenge[];
  drafted: boolean;
  note: string;
} | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.challenges)) {
    return null;
  }
  return {
    challenges: record.challenges
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
      .map((item) => ({
        title: String(item.title ?? "").slice(0, 120),
        detail: String(item.detail ?? "").slice(0, 400),
      }))
      .filter((item) => item.title !== ""),
    drafted: record.source === "MODEL",
    note: typeof record.note === "string" ? record.note : "",
  };
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

export function governingDocuments(
  documents: ReadonlyArray<{
    id: string;
    kind: string;
    title: string;
    fileName: string;
  }>,
): Array<{ id: string; title: string; detail: string }> {
  return documents
    .filter((item) => item.kind in GOVERNING_KINDS)
    .map((item) => ({
      id: item.id,
      title: item.title || item.fileName,
      detail: [GOVERNING_KINDS[item.kind], item.fileName]
        .filter((part) => part !== undefined && part !== "")
        .join(" · "),
    }));
}

/** The control's other documents, by kind. */
const SUPPORTING_KINDS: Record<string, string> = {
  WALKTHROUGH: "Walkthrough notes",
  SYSTEM: "System documentation",
  PRIOR_YEAR: "Prior-year workpaper",
  OTHER: "Other",
};

export type CardDocument = {
  id: string;
  title: string;
  detail: string;
  reviewed: boolean;
};

/** Every document the control has, for the assistant's documents card (product owner, 26
 * October 2026: the Plan step's own documents card was removed): the governing ones, then
 * the supporting ones, each with whether the agent has reviewed it, and how many wait. */
export function controlDocuments(
  documents: ReadonlyArray<{
    id: string;
    kind: string;
    title: string;
    fileName: string;
    reviewed: boolean;
  }>,
): {
  governing: CardDocument[];
  supporting: CardDocument[];
  unreviewed: number;
} {
  const reviewed = new Map(documents.map((item) => [item.id, item.reviewed]));
  return {
    governing: governingDocuments(documents).map((item) => ({
      ...item,
      reviewed: reviewed.get(item.id) ?? false,
    })),
    supporting: documents
      .filter((item) => !(item.kind in GOVERNING_KINDS))
      .map((item) => ({
        id: item.id,
        title: item.title || item.fileName,
        detail: [SUPPORTING_KINDS[item.kind] ?? "Other", item.fileName]
          .filter((part) => part !== "")
          .join(" · "),
        reviewed: item.reviewed,
      })),
    unreviewed: documents.filter((item) => !item.reviewed).length,
  };
}

/** How many of the control's activities happened on the given day (UTC, as its timeline
 * shows times). */
export function activitiesOn(
  items: ReadonlyArray<{ at: string }>,
  day: Date,
): number {
  const key = day.toISOString().slice(0, 10);
  return items.filter((item) => item.at.slice(0, 10) === key).length;
}
