// The guided tour of the demo engagement (Trial Management and Synthetic Demo Experience,
// Step 5): eight stages over the pages the application already has, the words of each,
// where each opens, and what the server says about where the person stands. The server
// keeps the progress and resolves the records the stages point at (demo_tour.py); this
// only reads what it says and builds the addresses.

import { DEMO_CLIENT, type DemoSummary, demoHref } from "./demo-model.ts";
import type { SubscriptionSummary } from "./trial-model.ts";

export type TourStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "SKIPPED"
  | "COMPLETED";

export type StageKey =
  | "overview"
  | "planning"
  | "understanding"
  | "evidence"
  | "testing"
  | "review"
  | "remediation"
  | "reporting";

export const STAGE_KEYS: readonly StageKey[] = [
  "overview",
  "planning",
  "understanding",
  "evidence",
  "testing",
  "review",
  "remediation",
  "reporting",
];

export type TourAnchors = {
  controlRef: string;
  controlId: string | null;
  requestId: string | null;
  sheetId: string | null;
  failedSample: string;
  workpaperId: string | null;
  reviewId: string | null;
  retestRoundId: string | null;
  deficiencyIds: Record<string, string>;
  exportIds: Record<string, string>;
};

export type TourState = {
  available: boolean;
  /** Why not: not-trial, trial-ended, subscription-inactive, no-demo, not-a-member. */
  reason: string;
  projectId: string | null;
  stage: StageKey;
  status: TourStatus;
  /** The progress named an earlier demo engagement and was set aside. */
  stale: boolean;
  version: number;
  anchors: TourAnchors | null;
};

export const DEFAULT_TOUR: TourState = {
  available: false,
  reason: "",
  projectId: null,
  stage: "overview",
  status: "NOT_STARTED",
  stale: false,
  version: 0,
  anchors: null,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const id = (value: unknown): string | null =>
  typeof value === "string" && UUID.test(value) ? value : null;

function idMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  const found: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    const parsed = id(item);
    if (parsed !== null) {
      found[key] = parsed;
    }
  }
  return found;
}

export function isStageKey(value: unknown): value is StageKey {
  return typeof value === "string" && (STAGE_KEYS as string[]).includes(value);
}

export function parseTour(value: unknown): TourState {
  if (!isRecord(value)) {
    return DEFAULT_TOUR;
  }
  const status = value.status;
  const anchors = isRecord(value.anchors)
    ? {
        controlRef:
          typeof value.anchors.control_ref === "string"
            ? value.anchors.control_ref
            : "",
        controlId: id(value.anchors.control_id),
        requestId: id(value.anchors.request_id),
        sheetId: id(value.anchors.sheet_id),
        failedSample:
          typeof value.anchors.failed_sample === "string"
            ? value.anchors.failed_sample
            : "",
        workpaperId: id(value.anchors.workpaper_id),
        reviewId: id(value.anchors.review_id),
        retestRoundId: id(value.anchors.retest_round_id),
        deficiencyIds: idMap(value.anchors.deficiency_ids),
        exportIds: idMap(value.anchors.export_ids),
      }
    : null;
  return {
    available: value.available === true,
    reason: typeof value.reason === "string" ? value.reason : "",
    projectId: id(value.project_id),
    stage: isStageKey(value.stage) ? value.stage : "overview",
    status:
      status === "IN_PROGRESS" || status === "SKIPPED" || status === "COMPLETED"
        ? status
        : "NOT_STARTED",
    stale: value.stale === true,
    version:
      typeof value.version === "number" && Number.isInteger(value.version)
        ? value.version
        : 0,
    anchors,
  };
}

/** The welcome, as the product owner set it (Step 5). */
export const WELCOME_COPY = {
  eyebrow: `Synthetic demo · ${DEMO_CLIENT}`,
  title: "Welcome to your AI Audit Workspace",
  lead: "Explore a complete synthetic IT SOX audit and see how AuditWorkforce coordinates planning, evidence collection, testing, review, remediation, and reporting.",
  detail:
    "All data is synthetic, and the completed results are prepared examples.",
  mix: "The demo holds completed, prepared examples (marked simulated) and selected actions you can take yourself. Nothing runs an AI agent until you ask it to.",
  start: "Start guided tour",
  explore: "Explore independently",
} as const;

export type TourStage = {
  key: StageKey;
  number: number;
  title: string;
  /** One or two sentences: what this part of the audit is for. */
  lead: string;
  /** What to look at on the page, in the order it appears. */
  points: readonly string[];
  /** The stage's main action: opening its page, or what to inspect once there. */
  action: string;
  /** The parts of the page the guide points at, in order of preference. */
  targets: readonly string[];
  /** A note on what is prepared, live, or not yet in this release. */
  note: string | null;
};

export const STAGES: readonly TourStage[] = [
  {
    key: "overview",
    number: 1,
    title: "Engagement overview",
    lead: `${DEMO_CLIENT}, Inc. FY2027 IT SOX audit: three systems and fourteen key controls, with planning, evidence, testing and deficiencies read from the engagement's records on one page.`,
    points: [
      "Audit coverage: the systems and controls in scope.",
      "Planning, evidence and testing progress, each figure worked out by the application.",
      "The deficiency summary: open items, and the ones remediated and closed.",
    ],
    action: "Explore audit scope",
    targets: [".glance", ".home-work", "[aria-labelledby='deficiency-title']"],
    note: null,
  },
  {
    key: "planning",
    number: 2,
    title: "AI audit planning",
    lead: "The agents prepare the testing methodology for each control: the objective, the risks, the procedures and attributes, and the evidence each attribute needs. A person approves the plan, and that approval is the authoritative testing basis.",
    points: [
      "Control objective and risks.",
      "Procedures and testing attributes.",
      "Evidence requirements and the approved criteria.",
      "The approval record: who approved the plan, and when.",
    ],
    action: "Explore approved plan",
    targets: ["#cw-work", "#cw-hero"],
    note: null,
  },
  {
    key: "understanding",
    number: 3,
    title: "Control understanding",
    lead: "Before testing, the control's design is understood: the description, the process it sits in, the procedures and the narratives the engagement holds for it.",
    points: [
      "The control's description, owner, frequency and system.",
      "The process understanding and narratives recorded for it.",
      "The design assessment prepared from the organization's configuration.",
    ],
    action: "Open the control's design",
    targets: ["#cw-hero", "#cw-work"],
    note: "A conversational control walkthrough with prepared interview questions is not part of this release; it is kept for a later milestone.",
  },
  {
    key: "evidence",
    number: 4,
    title: "Evidence collection",
    lead: "Each evidence request names what is needed, who provides it and which control attribute it serves. The Evidence Agent reads what arrives and recommends; a person accepts.",
    points: [
      "The evidence specification, the recipient and the submission status.",
      "Each requirement and the attributes it serves.",
      "The files submitted, and the agent's reading of each.",
      "Human acceptance: an agent's recommendation never accepts evidence by itself.",
    ],
    action: "Inspect evidence",
    targets: ["#cw-work"],
    note: "Prepared readings are marked simulated. Adding a file of your own here runs the Evidence Agent live, within the trial's AI allowance.",
  },
  {
    key: "testing",
    number: 5,
    title: "AI control testing",
    lead: "The Testing Agent applies the approved criteria to each sampled item and cites the evidence behind every result. Exceptions stand only when they are explained and supported.",
    points: [
      "The approved testing criteria and the sample population.",
      "The sample selection, and each item's expected and observed results.",
      "The failed attributes, with citations into the supporting files.",
      "The exception conclusion, signed off by the tester.",
    ],
    action: "Inspect failed sample",
    targets: ["#cw-work"],
    note: "The results shown are prepared examples (simulated). Live testing runs through the same budgeted agent workflow when you ask for it.",
  },
  {
    key: "review",
    number: 6,
    title: "Independent review",
    lead: "An audit conclusion stands only after a second person, who did not prepare the work, reviews it: the sample, the results and the workpaper, against the approved plan.",
    points: [
      "Preparer and reviewer, kept separate by the application.",
      "The review's status, its notes and how each was addressed.",
      "The approval history and the workpaper version the review covers.",
    ],
    action: "Explore reviewer decision",
    targets: ["#cw-work"],
    note: "The reviewer's decisions are prepared examples. Trial members cannot act as the reviewer or bypass the review.",
  },
  {
    key: "remediation",
    number: 7,
    title: "Remediation and retesting",
    lead: "A failed test becomes a deficiency, management responds and remediates, new evidence arrives, the control is retested, and the independent reviewer approves the closure. The original failure stays on record.",
    points: [
      "The original failed test and the deficiency logged from it.",
      "Management's response and the date the fix took effect.",
      "The retest in its own round, with its own evidence and sign-off.",
      "The reviewer's approval, and the closed deficiency.",
    ],
    action: "Compare original and retest",
    targets: ["[aria-labelledby='deficiency-detail-title']"],
    note: "A second example, D-003 (unauthorised production change), follows the same path.",
  },
  {
    key: "reporting",
    number: 8,
    title: "Audit reporting",
    lead: "Every report figure is worked out from the records by the metrics rulebook: coverage, current conclusions, open and closed deficiencies, pending reviews and the remaining evidence limitations.",
    points: [
      "Control coverage and the current testing conclusions.",
      "Open deficiencies beside the closed ones and their remediation outcomes.",
      "Pending reviews and roll-forward evidence still to come.",
      "The prepared PDF and Word reports, ready to download.",
    ],
    action: "Explore reports",
    targets: [".demo-reports", ".destination-links"],
    note: "The prepared reports are simulated interim drafts, not finalised audit opinions.",
  },
];

export function stageOf(key: StageKey): TourStage {
  const found = STAGES.find((stage) => stage.key === key);
  return found ?? (STAGES[0] as TourStage);
}

export function nextStage(key: StageKey): StageKey | null {
  const index = STAGE_KEYS.indexOf(key);
  return index >= 0 ? (STAGE_KEYS[index + 1] ?? null) : null;
}

export function previousStage(key: StageKey): StageKey | null {
  const index = STAGE_KEYS.indexOf(key);
  return index > 0 ? (STAGE_KEYS[index - 1] ?? null) : null;
}

export function progressLabel(key: StageKey): string {
  return `Stage ${stageOf(key).number} of ${STAGE_KEYS.length}`;
}

/** The address of a stage's page, built from the records the server resolved. */
export function stageHref(
  key: StageKey,
  organizationId: string,
  projectId: string,
  anchors: TourAnchors | null,
): string {
  const params = new URLSearchParams({
    organization: organizationId,
    project: projectId,
  });
  const control = anchors?.controlId ?? null;
  switch (key) {
    case "overview":
      params.set("section", "overview");
      break;
    case "planning":
    case "understanding":
    case "evidence":
    case "testing":
    case "review":
      if (control === null) {
        params.set("section", "controls");
        break;
      }
      params.set("section", "controls");
      params.set("control", control);
      params.set(
        "step",
        key === "planning" || key === "understanding"
          ? "plan"
          : key === "evidence"
            ? "request"
            : key === "testing"
              ? "test"
              : "review",
      );
      if (key === "evidence" && anchors?.requestId) {
        params.set("ev", "requests");
        params.set("request", anchors.requestId);
      }
      break;
    case "remediation": {
      params.set("section", "reports");
      params.set("view", "deficiencies");
      const first = anchors?.deficiencyIds["D-001"];
      if (first !== undefined) {
        params.set("deficiency", first);
      }
      break;
    }
    case "reporting":
      params.set("section", "reports");
      params.set("view", "status");
      break;
  }
  params.set("tour", key);
  return `/?${params}`;
}

/** The second remediation example's page, when the records hold it. */
export function secondExampleHref(
  organizationId: string,
  projectId: string,
  anchors: TourAnchors | null,
): string | null {
  const found = anchors?.deficiencyIds["D-003"];
  if (found === undefined) {
    return null;
  }
  const params = new URLSearchParams({
    organization: organizationId,
    project: projectId,
    section: "reports",
    view: "deficiencies",
    deficiency: found,
    tour: "remediation",
  });
  return `/?${params}`;
}

/**
 * Whether the page open now is the stage's page: the same section and, where the stage
 * opens a record, the same record and step. The tab parameter is left out, so a person
 * moving within the stage's page stays "on" it.
 */
export function onStagePage(
  key: StageKey,
  params: URLSearchParams,
  anchors: TourAnchors | null,
): boolean {
  const section = params.get("section") ?? "overview";
  switch (key) {
    case "overview":
      return section === "overview";
    case "planning":
    case "understanding":
      return (
        section === "controls" &&
        params.get("control") === anchors?.controlId &&
        (params.get("step") ?? "plan") === "plan"
      );
    case "evidence":
      return (
        section === "controls" &&
        params.get("control") === anchors?.controlId &&
        params.get("step") === "request"
      );
    case "testing":
      return (
        section === "controls" &&
        params.get("control") === anchors?.controlId &&
        params.get("step") === "test"
      );
    case "review":
      return (
        section === "controls" &&
        params.get("control") === anchors?.controlId &&
        params.get("step") === "review"
      );
    case "remediation":
      return (
        section === "reports" &&
        params.get("view") === "deficiencies" &&
        params.get("deficiency") !== null &&
        Object.values(anchors?.deficiencyIds ?? {}).includes(
          params.get("deficiency") ?? "",
        )
      );
    case "reporting":
      return (
        section === "reports" && (params.get("view") ?? "status") === "status"
      );
  }
}

/**
 * Whether the welcome opens on this page: inside the demo engagement, for a member the
 * server offers the tour to, who has not answered it yet (or whose progress was made on
 * an earlier demo), and never over another dialog. Once answered, it does not come back.
 */
export function showsWelcome(
  tour: TourState,
  context: { inDemo: boolean; dialogOpen: boolean },
): boolean {
  return (
    context.inDemo &&
    !context.dialogOpen &&
    tour.available &&
    (tour.status === "NOT_STARTED" || tour.stale)
  );
}

/** Whether the guide panel shows: inside the demo, while the tour is under way. */
export function showsGuide(tour: TourState, inDemo: boolean): boolean {
  return inDemo && tour.available && tour.status === "IN_PROGRESS";
}

/** Whether a "resume" offer shows inside the demo: a tour skipped or finished earlier
 * can be taken up again from where it stood. */
export function offersResume(tour: TourState, inDemo: boolean): boolean {
  return (
    inDemo &&
    tour.available &&
    (tour.status === "SKIPPED" || tour.status === "COMPLETED")
  );
}

export type DemoNavEntry = {
  kind: "explore" | "resume" | "back";
  label: string;
  href: string;
};

/**
 * The persistent, subtle entry in the top bar while the trial runs: outside the demo,
 * the demo to explore or resume; inside it, the way back to the firm's own work.
 */
export function demoNavEntry(
  demo: DemoSummary,
  subscription: SubscriptionSummary,
  tour: TourState,
  context: {
    inDemo: boolean;
    organizationId: string;
    /** The firm's own (non-demo) engagement to return to, when it has one. */
    ownProjectId: string | null;
  },
): DemoNavEntry | null {
  if (subscription.planType !== "TRIAL" || subscription.state !== "TRIAL") {
    return null;
  }
  if (context.inDemo) {
    const params = new URLSearchParams({
      organization: context.organizationId,
    });
    if (context.ownProjectId !== null) {
      params.set("section", "overview");
      params.set("project", context.ownProjectId);
    } else {
      params.set("section", "projects");
    }
    return { kind: "back", label: "Back to my workspace", href: `/?${params}` };
  }
  if (!demo.eligible || demo.state !== "READY" || demo.projectId === null) {
    return null;
  }
  if (tour.available && tour.status === "IN_PROGRESS") {
    return {
      kind: "resume",
      label: "Resume demo",
      href: stageHref(
        tour.stage,
        context.organizationId,
        demo.projectId,
        tour.anchors,
      ),
    };
  }
  return {
    kind: "explore",
    label: "Explore demo",
    href: demoHref(context.organizationId, demo.projectId),
  };
}

/** The words for a server answer to a move, when it is not plain success. */
export function moveOutcome(status: number, body: unknown): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 403 || status === 404) {
    return "The demo tour is open to members of the demo engagement on the free trial.";
  }
  if (status === 422) {
    return "That stage is not part of the tour.";
  }
  if (status === 0) {
    return "The tour could not be saved. Check the connection and try again.";
  }
  const detail =
    isRecord(body) && typeof body.detail === "string" ? body.detail : "";
  return detail !== ""
    ? detail
    : "The tour could not be saved. Try again in a moment.";
}
