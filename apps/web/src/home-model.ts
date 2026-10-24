import { waitingHref } from "./console-model.ts";

/** The engagement's stages as one journey (next_steps.STAGES), in order. */
export const JOURNEY = [
  "SETUP",
  "PLANS",
  "EVIDENCE",
  "TESTING",
  "REVIEW",
  "CLOSE",
] as const;
export type StageKey = (typeof JOURNEY)[number];

export type JourneyStage = {
  key: StageKey;
  label: string;
  status: "DONE" | "CURRENT" | "UPCOMING";
  done: number;
  total: number;
  summary: string;
};

/** One thing waiting on the team (next_steps.StepBody): a page to open (`section` and
 * its `query`), or a console item with its own link. */
export type NextStep = {
  stage: StageKey;
  kind: string;
  title: string;
  detail: string;
  /** It holds the engagement up until it is settled. */
  blocks: boolean;
  section: string | null;
  query: Record<string, string>;
  controlRef: string | null;
  link: string;
  controlId: string | null;
  tab: string | null;
};

export type NextSteps = {
  launched: boolean;
  current: StageKey;
  stages: JourneyStage[];
  steps: NextStep[];
};

// The pages a step may open; anything else is not followed.
const SECTIONS = new Set([
  "setup",
  "planning",
  "testing",
  "controls",
  "evidence",
  "approvals",
  "plan",
  "reports",
  "settings",
  "console",
]);
const QUERY_KEYS = new Set(["filter", "tab", "step", "view"]);
const QUERY_VALUE = /^[A-Za-z0-9_,-]{1,200}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const stageOf = (value: unknown): StageKey | null =>
  JOURNEY.includes(value as StageKey) ? (value as StageKey) : null;

export function parseNextSteps(value: unknown): NextSteps | null {
  if (!isRecord(value) || !Array.isArray(value.stages)) {
    return null;
  }
  const stages: JourneyStage[] = [];
  for (const item of value.stages) {
    const key = isRecord(item) ? stageOf(item.key) : null;
    if (!isRecord(item) || key === null) {
      return null;
    }
    stages.push({
      key,
      label: str(item.label),
      status:
        item.status === "DONE" || item.status === "CURRENT"
          ? item.status
          : "UPCOMING",
      done: typeof item.done === "number" ? item.done : 0,
      total: typeof item.total === "number" ? item.total : 0,
      summary: str(item.summary),
    });
  }
  const steps: NextStep[] = [];
  for (const item of Array.isArray(value.steps) ? value.steps : []) {
    const stage = isRecord(item) ? stageOf(item.stage) : null;
    if (!isRecord(item) || stage === null || str(item.title) === "") {
      continue;
    }
    const query: Record<string, string> = {};
    if (isRecord(item.query)) {
      for (const [key, text] of Object.entries(item.query)) {
        if (
          QUERY_KEYS.has(key) &&
          typeof text === "string" &&
          QUERY_VALUE.test(text)
        ) {
          query[key] = text;
        }
      }
    }
    const section = str(item.section);
    steps.push({
      stage,
      kind: str(item.kind),
      title: str(item.title),
      detail: str(item.detail),
      blocks: item.blocks === true,
      section: SECTIONS.has(section) ? section : null,
      query,
      controlRef: str(item.control_ref) || null,
      link: str(item.link),
      controlId: str(item.control_id) || null,
      tab: str(item.tab) || null,
    });
  }
  return {
    launched: value.launched === true,
    current: stageOf(value.current) ?? "SETUP",
    stages,
    steps,
  };
}

/** Where a step is done: its page, or for a console item the link the console uses. */
export function stepHref(
  step: NextStep,
  organizationId: string,
  projectId: string,
): string {
  if (step.section !== null) {
    const params = new URLSearchParams({
      organization: organizationId,
      project: projectId,
      section: step.section,
      ...step.query,
    });
    return `/?${params.toString()}`;
  }
  return waitingHref(
    {
      id: "",
      kind: step.kind,
      title: step.title,
      detail: step.detail,
      controlRef: step.controlRef,
      controlLabel: step.controlRef,
      link: step.link,
      controlId: step.controlId,
      tab: step.tab,
    },
    organizationId,
    projectId,
  );
}

/** The steps grouped by stage, in the journey's order; a stage with none is left out. */
export function stepsByStage(
  steps: readonly NextStep[],
): { stage: StageKey; steps: NextStep[] }[] {
  return JOURNEY.map((stage) => ({
    stage,
    steps: steps.filter((step) => step.stage === stage),
  })).filter((group) => group.steps.length > 0);
}

/** The words for an empty list: what the engagement waits on when the team has nothing. */
export function idleMessage(next: NextSteps): string {
  if (next.current === "CLOSE") {
    return next.stages.find((stage) => stage.key === "CLOSE")?.status === "DONE"
      ? "The engagement is complete."
      : "All work is concluded and reviewed. The engagement can be completed.";
  }
  if (next.current === "EVIDENCE") {
    return "Nothing waits on the team. The client is preparing the requested evidence.";
  }
  return "Nothing waits on the team. The agents are working on the current stage.";
}
