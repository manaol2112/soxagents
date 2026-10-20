/**
 * What the Controls register shows, kept out of its components: the view's address, the
 * filters as removable chips, the engagement's progress by stage, each group's headline,
 * each control's stage in words, and where its next step is done. A control's stage, its
 * next step, who that belongs to, and whether it is the viewer's all come from the API
 * (workspace.step_of, progress_of, mark_yours); nothing here works out a control's state.
 */

import {
  type Actor,
  agentActive,
  agentStopped,
  blockersOf,
  CATEGORIES,
  type ControlRow,
  type EngagementState,
  NO_APPLICATION,
  type OverallState,
  overallState,
  type PhaseEvidence,
  PROGRESS,
  PROGRESS_LABELS,
  type Progress,
  recordAction,
  STAGES,
} from "./engagement-model.ts";

type Filters = EngagementState["filters"];
export type Sort = Filters["sort"];

/** The register's view, as its address carries it. */
export type RegisterView = {
  q: string;
  category: string | null;
  queue: string | null;
  group: "application" | "area";
  sort: Sort;
  app: string[];
  area: string[];
  owner: string[];
  stage: string[];
  key: boolean;
  layout: "applications" | "table";
};

export function registerView(filters: Filters): RegisterView {
  return {
    q: filters.query,
    category: filters.category,
    queue: filters.queue,
    group: filters.group === "area" ? "area" : "application",
    sort: filters.sort,
    app: filters.application,
    area: filters.area,
    owner: filters.owner,
    stage: filters.stage,
    key: filters.keyOnly,
    layout: filters.layout,
  };
}

/** The register's address with some of its view changed; the rest kept as it is. */
export function registerHref(
  base: { organization: string; project: string },
  view: RegisterView,
  change: Partial<RegisterView> = {},
): string {
  const next = { ...view, ...change };
  const params = new URLSearchParams({
    organization: base.organization,
    project: base.project,
    section: "controls",
  });
  if (next.q.trim() !== "") {
    params.set("q", next.q.trim());
  }
  if (next.category !== null) {
    params.set("category", next.category);
  }
  if (next.queue !== null) {
    params.set("queue", next.queue);
  }
  if (next.group === "area") {
    params.set("group", "area");
  }
  if (next.sort !== "control") {
    params.set("sort", next.sort);
  }
  for (const [name, values] of [
    ["app", next.app],
    ["area", next.area],
    ["owner", next.owner],
    ["stage", next.stage],
  ] as const) {
    for (const value of values) {
      params.append(name, value);
    }
  }
  if (next.key) {
    params.set("key", "1");
  }
  if (next.layout === "table") {
    params.set("layout", "table");
  }
  return `/?${params.toString()}`;
}

export type FilterChip = {
  /** A stable key for the chip. */
  id: string;
  label: string;
  /** The view without this one filter. */
  without: Partial<RegisterView>;
};

const STAGE_LABEL: Record<string, string> = {
  ...Object.fromEntries(STAGES),
  ...PROGRESS_LABELS,
};
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES);

/** Every filter in force, each as a chip that removes just itself. The view (All, Needs
 * your action, and so on), the grouping, and the order are shown by their own controls. */
export function filterChips(view: RegisterView): FilterChip[] {
  const chips: FilterChip[] = [];
  if (view.q.trim() !== "") {
    chips.push({
      id: "q",
      label: `Search: ${view.q.trim()}`,
      without: { q: "" },
    });
  }
  if (view.category !== null) {
    chips.push({
      id: "category",
      label: `Type: ${CATEGORY_LABEL[view.category] ?? view.category}`,
      without: { category: null },
    });
  }
  const lists: Array<
    [
      keyof Pick<RegisterView, "app" | "area" | "stage" | "owner">,
      string,
      (value: string) => string,
    ]
  > = [
    ["app", "Application", (value) => (value === "" ? NO_APPLICATION : value)],
    ["area", "Area", (value) => value],
    ["stage", "Status", (value) => STAGE_LABEL[value] ?? value],
    ["owner", "Owner", (value) => (value === "" ? "PBC coordinator" : value)],
  ];
  for (const [name, noun, label] of lists) {
    for (const value of view[name]) {
      chips.push({
        id: `${name}-${value}`,
        label: `${noun}: ${label(value)}`,
        without: { [name]: view[name].filter((item) => item !== value) },
      });
    }
  }
  if (view.key) {
    chips.push({
      id: "key",
      label: "Key controls only",
      without: { key: false },
    });
  }
  return chips;
}

/** The filters behind the Filters button: everything but search and application, which
 * sit in the toolbar themselves. */
export function popoverCount(view: RegisterView): number {
  return (
    (view.category !== null ? 1 : 0) +
    view.area.length +
    view.stage.length +
    view.owner.length +
    (view.key ? 1 : 0)
  );
}

export type StageCounts = {
  total: number;
  /** One count per stage, in order; they add up to the total. */
  stages: Array<{ stage: Progress; label: string; count: number }>;
  /** Shown beside the stages: a control with exceptions is still in one stage. */
  exceptions: number;
};

/** The engagement's progress: every control in exactly one stage, so nothing is counted
 * twice and the stages add up to the controls in scope. */
export function stageCounts(controls: readonly ControlRow[]): StageCounts {
  return {
    total: controls.length,
    stages: PROGRESS.map((stage) => ({
      stage,
      label: PROGRESS_LABELS[stage],
      count: controls.filter((control) => control.progress === stage).length,
    })),
    exceptions: controls.filter((control) => control.exceptions).length,
  };
}

/** Controls whose next step is submitting a drafted request: done together, not one by
 * one, so the register says it once. */
export function draftedBatch(controls: readonly ControlRow[]): {
  controls: number;
  requests: number;
} {
  const drafted = controls.filter((control) => control.drafted);
  return {
    controls: drafted.length,
    requests: drafted.reduce(
      (sum, control) =>
        sum +
        control.requests.filter((request) => request.status === "DRAFT").length,
      0,
    ),
  };
}

export type GroupHeadline = {
  total: number;
  concluded: number;
  blocked: number;
  needYou: number;
  overdue: number;
  inReview: number;
  exceptions: number;
};

/** A group's headline: its size, how far it is, and what needs someone. */
export function groupHeadline(controls: readonly ControlRow[]): GroupHeadline {
  return {
    total: controls.length,
    concluded: controls.filter((c) => c.progress === "CONCLUDED").length,
    blocked: controls.filter((c) => overallState(c) === "blocked").length,
    needYou: controls.filter((c) => c.yours).length,
    overdue: controls.filter((c) => c.overdue).length,
    inReview: controls.filter(
      (c) => c.progress === "AWAITING_REVIEW" || c.progress === "REVIEW_NOTES",
    ).length,
    exceptions: controls.filter((c) => c.exceptions).length,
  };
}

/** Groups start open when the view is narrowed to what someone looked for, or when the
 * register is short; the whole of a long register starts as its group headlines. */
export function groupsStartOpen(
  view: RegisterView,
  shown: number,
  groups: number,
): boolean {
  return (
    view.queue !== null ||
    filterChips(view).length > 0 ||
    groups <= 1 ||
    shown <= 25
  );
}

const ORDER = new Map<Progress, number>(
  PROGRESS.map((stage, index) => [stage, index]),
);

/** The register's order inside each group. "attention" puts first what the viewer can
 * act on, then what is overdue or has exceptions; the rest keep the control ID order. */
export function sortControls(
  controls: readonly ControlRow[],
  sort: Sort,
): ControlRow[] {
  const byRef = (a: ControlRow, b: ControlRow) =>
    a.controlRef.localeCompare(b.controlRef, undefined, { numeric: true });
  const rank = (control: ControlRow) =>
    control.yours ? 0 : control.overdue ? 1 : control.exceptions ? 2 : 3;
  const due = (control: ControlRow) => nextDue(control) ?? "9999";
  const ownerOf = (control: ControlRow) =>
    control.ownerName || control.ownerEmail || "~";
  return [...controls].sort((a, b) => {
    if (sort === "owner") {
      return ownerOf(a).localeCompare(ownerOf(b)) || byRef(a, b);
    }
    if (sort === "application") {
      return (
        (a.applicationName || "~").localeCompare(b.applicationName || "~") ||
        byRef(a, b)
      );
    }
    if (sort === "due") {
      return due(a).localeCompare(due(b)) || byRef(a, b);
    }
    if (sort === "stage") {
      return (
        (ORDER.get(a.progress) ?? 0) - (ORDER.get(b.progress) ?? 0) ||
        byRef(a, b)
      );
    }
    if (sort === "attention") {
      return rank(a) - rank(b) || byRef(a, b);
    }
    return 0;
  });
}

export type StageText = {
  label: string;
  /** What exactly, in a few words, where the stage alone is not enough. */
  detail: string;
  /** The work is an agent's and no person has confirmed it yet. */
  ai: boolean;
};

/** A control's stage in words, with the detail that tells the cases apart. */
export function stageText(control: ControlRow): StageText {
  const label = PROGRESS_LABELS[control.progress];
  const live = control.requests.filter(
    (request) => request.status !== "CANCELLED",
  );
  const has = (status: string) =>
    live.some((request) => request.status === status);
  switch (control.progress) {
    case "PLAN_TO_APPROVE":
      return {
        label,
        // Evidence is requested only from an approved test plan.
        detail: "Evidence is requested once it is approved",
        ai: false,
      };
    case "TO_REQUEST":
      return {
        label,
        // A drafted request shows as "not sent" in the evidence column already.
        detail: has("APPROVAL_PENDING")
          ? "Awaiting approval to send"
          : has("DRAFT")
            ? ""
            : "Nothing requested",
        ai: false,
      };
    case "AWAITING_EVIDENCE":
      return {
        label,
        detail: control.overdue
          ? "Overdue"
          : control.sheetLeft === "EVIDENCE"
            ? "Sample evidence"
            : "",
        ai: false,
      };
    case "EVIDENCE_RECEIVED":
      return {
        label,
        detail:
          control.testStatus === "PROPOSED"
            ? control.populationPending
              ? "Population to accept"
              : "Samples to approve"
            : control.sheetLeft === "PLACE"
              ? "Files to link to samples"
              : has("PARTIALLY_RECEIVED") ||
                  live.some((r) =>
                    ["SENT", "WAITING_FOR_RESPONSE", "OVERDUE"].includes(
                      r.status,
                    ),
                  )
                ? "Partly received"
                : "Population to confirm",
        ai: false,
      };
    case "READY_FOR_TESTING":
      return {
        label,
        detail:
          control.sheetLeft === "TESTING" && !control.testingRunning
            ? "Testing stopped"
            : "",
        ai: false,
      };
    case "AGENT_TESTING":
      return { label, detail: "In progress", ai: true };
    case "RESULTS_TO_CONFIRM":
      return {
        label,
        detail:
          control.sheetLeft === "DEFICIENCY"
            ? "Deficiency to log"
            : control.sheetStatus === "SIGNED_OFF"
              ? "Workpapers to prepare"
              : "Agent results, not yet confirmed",
        ai: control.sheetStatus === "OPEN",
      };
    case "AWAITING_REVIEW":
      return control.reviewLeft === "REPERFORMING"
        ? { label, detail: "Reviewer agent re-performing", ai: true }
        : { label, detail: "With the reviewer", ai: false };
    case "TESTING_REOPENED":
      // Signed-off testing opened again; the sheet says why (a review note, an impact
      // assessment, a person).
      return { label, detail: control.reopenReason ?? "", ai: false };
    case "REVIEW_NOTES":
      return { label, detail: "Notes to answer", ai: false };
    case "CONCLUDED":
      return {
        label,
        detail:
          control.conclusion === "EXCEPTION" ? "With exceptions" : "Effective",
        ai: false,
      };
  }
}

/** Who a step that is not the viewer's waits on. */
export const ACTOR_LABELS: Record<Actor, string> = {
  PREPARER: "Preparer",
  APPROVER: "Approver",
  REVIEWER: "Reviewer",
  CLIENT: "Owner",
  AGENT: "Agent",
  NONE: "",
};

/** Where the viewer does their next step: an approval on the Approvals page, anything
 * else on the control's tab for it. Nothing when the step is not theirs, or is done. */
export function nextStepLink(
  control: ControlRow,
): { section: "approvals" } | { section: "controls"; tab: string } | null {
  if (!control.yours) {
    return null;
  }
  if (control.actor === "APPROVER") {
    return { section: "approvals" };
  }
  const action = recordAction(control);
  return action === null ? null : { section: "controls", tab: action.tab };
}

const PHASE_LABELS: Record<string, string> = {
  DESIGN: "Design",
  INTERIM: "Interim",
  ROLLFORWARD: "Roll-forward",
  RETEST: "Retest",
  REMEDIATION: "Remediation",
  OTHER: "Evidence",
};

/** A phase's evidence in a few characters: "Interim 1/2", "Design: drafted". */
export function phaseLine(phase: PhaseEvidence): {
  label: string;
  text: string;
  tone: "done" | "late" | "plain" | "drafted";
} {
  const label = PHASE_LABELS[phase.phase] ?? phase.phase;
  if (phase.requests > 0 && phase.received === phase.requests) {
    return { label, text: "received", tone: "done" };
  }
  if (phase.out === 0 && phase.received === 0 && phase.drafted > 0) {
    return { label, text: "not sent", tone: "drafted" };
  }
  return {
    label,
    text: `${phase.received}/${phase.requests}`,
    tone: phase.late > 0 ? "late" : "plain",
  };
}

// The overview: progress, what needs a person, and what the agents are doing

export type Portfolio = {
  total: number;
  /** One state per control; the four add up to the total. */
  states: Array<{ state: OverallState; label: string; count: number }>;
  needsYou: number;
  exceptions: number;
};

export const OVERALL_LABELS: Record<OverallState, string> = {
  completed: "Completed",
  in_progress: "In progress",
  blocked: "Blocked",
  not_started: "Not started",
};

const OVERALL_ORDER: OverallState[] = [
  "completed",
  "in_progress",
  "blocked",
  "not_started",
];

/** The status preset each overall state opens. */
export const OVERALL_QUEUE: Record<OverallState, string> = {
  completed: "concluded",
  in_progress: "progress",
  blocked: "blocked",
  not_started: "notstarted",
};

/** The engagement's progress in four states that add up to the controls in scope, what
 * is the viewer's to do, and how many have exceptions (beside the states, not one). */
export function portfolio(controls: readonly ControlRow[]): Portfolio {
  return {
    total: controls.length,
    states: OVERALL_ORDER.map((state) => ({
      state,
      label: OVERALL_LABELS[state],
      count: controls.filter((control) => overallState(control) === state)
        .length,
    })),
    needsYou: controls.filter((control) => control.yours).length,
    exceptions: controls.filter((control) => control.exceptions).length,
  };
}

/** The register's status presets: each a view the address carries (queue). */
export const STATUS_PRESETS: ReadonlyArray<[string | null, string]> = [
  [null, "All controls"],
  ["team", "Needs my attention"],
  ["progress", "In progress"],
  ["blocked", "Blocked"],
  ["evidence", "Awaiting evidence"],
  ["review", "In review"],
  ["concluded", "Completed"],
];

/** Views reached from the action center and the agents, named when in force. */
export const OTHER_VIEWS: Record<string, string> = {
  notstarted: "Not started",
  owner: "Waiting on owners",
  overdue: "Overdue evidence",
  findings: "With exceptions",
  agents: "Agents at work",
  stopped: "Agent work stopped",
};

export type ActionItem = {
  key: string;
  title: string;
  detail: string;
  count: number;
  /** Where it is done: a register view, the Approvals page, or the Evidence page. */
  to:
    | { kind: "view"; change: Partial<RegisterView> }
    | { kind: "approvals" }
    | { kind: "evidence" };
  /** The drafted requests to submit together, when the viewer may. */
  batch: Array<{ requestId: string; version: number }> | null;
  tone: "action" | "alert";
};

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** What needs a person across the register, most pressing first, each once: a batch of
 * drafted requests is one item, not one per control. Only what the records show and the
 * viewer may do (canSubmit: may submit requests for approval). */
export function actionCenter(
  controls: readonly ControlRow[],
  canSubmit: boolean,
): ActionItem[] {
  const items: ActionItem[] = [];
  const drafted = controls.filter((control) => control.drafted);
  const draftRequests = drafted.flatMap((control) =>
    control.requests.filter((request) => request.status === "DRAFT"),
  );
  if (draftRequests.length > 0 && canSubmit) {
    items.push({
      key: "drafted",
      title: `Submit ${plural(draftRequests.length, "drafted evidence request")} for approval`,
      detail: `On ${plural(drafted.length, "control")}. Each still goes to an approver, who checks its exact message before anything is sent.`,
      count: draftRequests.length,
      to: { kind: "evidence" },
      batch: draftRequests.map((request) => ({
        requestId: request.id,
        version: request.version,
      })),
      tone: "action",
    });
  }
  const approving = controls.filter(
    (control) => control.yours && control.actor === "APPROVER",
  );
  if (approving.length > 0) {
    items.push({
      key: "approve",
      title: `Approve evidence requests on ${plural(approving.length, "control")}`,
      detail: "Each message is checked and approved on the Approvals page.",
      count: approving.length,
      to: { kind: "approvals" },
      batch: null,
      tone: "action",
    });
  }
  const mine = (progress: Progress[]) =>
    controls.filter(
      (control) =>
        control.yours &&
        control.actor !== "APPROVER" &&
        progress.includes(control.progress),
    );
  const confirm = mine(["RESULTS_TO_CONFIRM"]);
  if (confirm.length > 0) {
    items.push({
      key: "confirm",
      title: `Confirm the testing of ${plural(confirm.length, "control")}`,
      detail: "Agent results to confirm, or workpapers to prepare.",
      count: confirm.length,
      to: {
        kind: "view",
        change: { queue: "team", stage: ["RESULTS_TO_CONFIRM"] },
      },
      batch: null,
      tone: "action",
    });
  }
  const review = mine(["AWAITING_REVIEW", "REVIEW_NOTES"]);
  if (review.length > 0) {
    items.push({
      key: "review",
      title: `Review or answer notes on ${plural(review.length, "control")}`,
      detail: "Independent review sign-offs and notes that are yours.",
      count: review.length,
      to: {
        kind: "view",
        change: { queue: "team", stage: ["AWAITING_REVIEW", "REVIEW_NOTES"] },
      },
      batch: null,
      tone: "action",
    });
  }
  const evidence = mine(["EVIDENCE_RECEIVED", "READY_FOR_TESTING"]);
  if (evidence.length > 0) {
    items.push({
      key: "evidence",
      title: `Move ${plural(evidence.length, "control")} on to testing`,
      detail: "Populations to accept, samples to approve, or files to link.",
      count: evidence.length,
      to: {
        kind: "view",
        change: {
          queue: "team",
          stage: ["EVIDENCE_RECEIVED", "READY_FOR_TESTING"],
        },
      },
      batch: null,
      tone: "action",
    });
  }
  const missing = controls.filter((control) =>
    blockersOf(control).some(
      (reason) =>
        reason !== "Agent work stopped" && reason !== "Evidence overdue",
    ),
  );
  if (missing.length > 0) {
    items.push({
      key: "missing",
      title: `Settle what stops ${plural(missing.length, "control")} from being tested`,
      detail:
        "Missing information, process understanding, or sources that disagree.",
      count: missing.length,
      to: { kind: "view", change: { queue: "blocked" } },
      batch: null,
      tone: "alert",
    });
  }
  const stopped = controls.filter(agentStopped);
  if (stopped.length > 0) {
    items.push({
      key: "stopped",
      title: `Restart agent work on ${plural(stopped.length, "control")}`,
      detail:
        "Testing, a draft, a re-performance, or a file read that did not finish.",
      count: stopped.length,
      to: { kind: "view", change: { queue: "stopped" } },
      batch: null,
      tone: "alert",
    });
  }
  const overdue = controls.filter((control) => control.overdue);
  if (overdue.length > 0) {
    items.push({
      key: "overdue",
      title: `Chase overdue evidence on ${plural(overdue.length, "control")}`,
      detail: "Requests past their due date with the owner.",
      count: overdue.length,
      to: { kind: "view", change: { queue: "overdue" } },
      batch: null,
      tone: "alert",
    });
  }
  const exceptions = controls.filter(
    (control) => control.exceptions && control.progress !== "CONCLUDED",
  );
  if (exceptions.length > 0) {
    items.push({
      key: "exceptions",
      title: `Review exceptions on ${plural(exceptions.length, "control")}`,
      detail: "Exceptions in testing or open deficiencies.",
      count: exceptions.length,
      to: { kind: "view", change: { queue: "findings" } },
      batch: null,
      tone: "alert",
    });
  }
  return items;
}

export type AgentSummary = {
  /** Controls an agent is working on now, and those whose work is only queued. */
  running: number;
  queued: number;
  testing: number;
  /** Files being read, across the controls. */
  reading: number;
  drafting: number;
  reviewing: number;
  /** The agent's results wait for a person to confirm them. */
  awaitingConfirmation: number;
  /** Testing waits for the owner's evidence. */
  waitingEvidence: number;
  stopped: number;
};

/** What the agents are doing across the register, only from their run records. */
export function agentSummary(controls: readonly ControlRow[]): AgentSummary {
  const has = (state: string) => (control: ControlRow) =>
    control.agents.testing === state ||
    control.agents.drafting === state ||
    control.agents.reviewing === state;
  const running = (control: ControlRow) =>
    has("RUNNING")(control) || control.agents.reading > 0;
  return {
    running: controls.filter(running).length,
    queued: controls.filter(
      (control) => !running(control) && has("QUEUED")(control),
    ).length,
    testing: controls.filter((control) => control.agents.testing !== "IDLE")
      .length,
    reading: controls.reduce((sum, control) => sum + control.agents.reading, 0),
    drafting: controls.filter((control) => control.agents.drafting !== "IDLE")
      .length,
    reviewing: controls.filter((control) => control.agents.reviewing !== "IDLE")
      .length,
    awaitingConfirmation: controls.filter(
      (control) =>
        control.progress === "RESULTS_TO_CONFIRM" &&
        control.sheetStatus === "OPEN",
    ).length,
    waitingEvidence: controls.filter(
      (control) => control.progress === "AWAITING_EVIDENCE",
    ).length,
    stopped: controls.filter(agentStopped).length,
  };
}

export type RowState = {
  label: string;
  /** One restrained tone: done, blocked, active (an agent at work), or plain. */
  tone: "done" | "blocked" | "active" | "plain";
  /** The one thing that tells the case apart, or "". */
  detail: string;
};

/** A control's state in a few words for the register, said once: a drafted request is
 * "Request drafted", not also "not sent" beside it. */
export function rowState(control: ControlRow): RowState {
  const blockers = blockersOf(control);
  const state = overallState(control);
  const live = control.requests.filter(
    (request) => request.status !== "CANCELLED",
  );
  if (state === "completed") {
    return {
      label: "Completed",
      tone: "done",
      detail: control.conclusion === "EXCEPTION" ? "With exceptions" : "",
    };
  }
  if (control.progress === "TO_REQUEST") {
    return {
      label: live.some((request) => request.status === "APPROVAL_PENDING")
        ? "Awaiting approval"
        : live.some((request) => request.status === "DRAFT")
          ? "Request drafted"
          : "Not requested",
      tone: blockers.length > 0 ? "blocked" : "plain",
      detail: blockers[0] ?? "",
    };
  }
  const text = stageText(control);
  return {
    label: text.label,
    tone:
      blockers.length > 0
        ? "blocked"
        : agentActive(control)
          ? "active"
          : "plain",
    detail: blockers[0] ?? text.detail,
  };
}

/** The earliest due date of the control's evidence still out with the owner. */
export function nextDue(control: ControlRow): string | null {
  const out = new Set([
    "SENT",
    "WAITING_FOR_RESPONSE",
    "PARTIALLY_RECEIVED",
    "OVERDUE",
    "ESCALATED",
  ]);
  const due = control.requests
    .filter((request) => out.has(request.status) && request.dueAt !== "")
    .map((request) => request.dueAt)
    .sort();
  return due[0] ?? null;
}

/** A control's evidence in a few words, across its phases. */
export function evidenceText(control: ControlRow): string {
  if (control.evidencePhases.length === 0) {
    return "None requested";
  }
  const sum = (key: "requests" | "received" | "out") =>
    control.evidencePhases.reduce((total, phase) => total + phase[key], 0);
  if (sum("received") === sum("requests")) {
    return "All received";
  }
  if (sum("out") === 0 && sum("received") === 0) {
    return "Not sent";
  }
  return `${sum("received")} of ${sum("requests")} received`;
}

/** What an agent is doing on the control, in a word, from its run records; "" when no
 * agent is at work and none stopped. */
export function agentText(control: ControlRow): string {
  const { agents } = control;
  if (agentStopped(control)) {
    return "Stopped";
  }
  if (agents.testing === "RUNNING") {
    return "Testing";
  }
  if (agents.reviewing === "RUNNING") {
    return "Re-performing";
  }
  if (agents.drafting === "RUNNING") {
    return "Drafting";
  }
  if (agents.reading > 0) {
    return "Reading files";
  }
  if (
    agents.testing === "QUEUED" ||
    agents.drafting === "QUEUED" ||
    agents.reviewing === "QUEUED"
  ) {
    return "Queued";
  }
  return "";
}

export type TableColumn =
  | "application"
  | "owner"
  | "status"
  | "evidence"
  | "agent"
  | "next"
  | "type"
  | "frequency"
  | "due";

export const TABLE_COLUMNS: ReadonlyArray<{
  key: TableColumn;
  label: string;
  /** Shown until the person chooses the columns. */
  standard: boolean;
  sort: Sort | null;
}> = [
  {
    key: "application",
    label: "Application",
    standard: true,
    sort: "application",
  },
  { key: "owner", label: "Owner", standard: true, sort: "owner" },
  { key: "status", label: "Status", standard: true, sort: "stage" },
  { key: "evidence", label: "Evidence", standard: true, sort: null },
  { key: "agent", label: "Agent", standard: true, sort: null },
  { key: "next", label: "Next step", standard: true, sort: "attention" },
  { key: "type", label: "Type", standard: false, sort: null },
  { key: "frequency", label: "Frequency", standard: false, sort: null },
  { key: "due", label: "Evidence due", standard: false, sort: "due" },
];

/** The table's columns from a person's saved choice, or the standard set. Unknown
 * names are dropped, so a stale choice never breaks the table. */
export function tableColumns(saved: string | null): TableColumn[] {
  const known = new Set<string>(TABLE_COLUMNS.map((column) => column.key));
  const chosen = (saved ?? "")
    .split(",")
    .filter((key): key is TableColumn => known.has(key));
  return TABLE_COLUMNS.filter((column) =>
    chosen.length > 0 ? chosen.includes(column.key) : column.standard,
  ).map((column) => column.key);
}

/** The register's count line: what is shown of what is in scope, and why fewer. */
export function countLine(
  shown: number,
  total: number,
  view: RegisterView,
): string {
  if (shown === total) {
    return `${plural(total, "control")} in scope`;
  }
  const why = [
    view.queue !== null
      ? (STATUS_PRESETS.find(([queue]) => queue === view.queue)?.[1] ??
        OTHER_VIEWS[view.queue] ??
        view.queue)
      : "",
    ...filterChips(view).map((chip) => chip.label),
  ].filter((part) => part !== "");
  return `${shown} of ${total} controls in scope${why.length > 0 ? ` · ${why.join(" · ")}` : ""}`;
}
