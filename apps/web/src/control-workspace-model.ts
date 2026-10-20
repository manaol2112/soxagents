/**
 * The control record as a workspace: where each audit phase stands, what the agents are
 * doing now, what needs a person, and the control's activity. Everything here is read
 * from records the API returns (the control row, its evidence plan, test sheet, review,
 * rounds, workpapers, files, and audit events); nothing is estimated or assumed done.
 */

import {
  type AssistantAction,
  type AssistantBrief,
  stepAnchor,
} from "./assistant-model.ts";
import type { ControlContext } from "./control-context-model.ts";
import type {
  ControlFiles,
  ControlRow,
  Deficiency,
  PlanTask,
} from "./engagement-model.ts";
import { requestStage } from "./evidence-flow.ts";
import type { EvidencePlan, Phase, PlanPhase } from "./evidence-plan-model.ts";
import type { Automation } from "./execution-model.ts";
import type { ControlReview } from "./review-model.ts";
import type { TestRound } from "./round-model.ts";
import type { RunState } from "./run-state.ts";
import type { TestSheet } from "./sheet-model.ts";
import type { ControlTest } from "./testing-model.ts";
import type { Workpaper } from "./workpaper-model.ts";

export type RecordTab =
  | "overview"
  | "design"
  | "evidence"
  | "testing"
  | "findings"
  | "review"
  | "activity";

export const RECORD_TAB_LABELS: Record<RecordTab, string> = {
  overview: "Overview",
  design: "Control & design",
  evidence: "Evidence",
  testing: "Testing",
  findings: "Findings",
  review: "Review & conclusion",
  activity: "Activity",
};

/** The record's four primary sections. Each keeps its tabs' own routes (`?tab=`), so a
 * bookmark or deep link to any tab still opens it; Activity sits outside them, reached
 * from the AI activity panel and its own link. */
export type RecordSection = "overview" | "plan" | "work" | "conclusion";

export const RECORD_SECTIONS: ReadonlyArray<{
  key: RecordSection;
  label: string;
  tabs: readonly RecordTab[];
}> = [
  { key: "overview", label: "Overview", tabs: ["overview"] },
  { key: "plan", label: "Test plan", tabs: ["design"] },
  {
    key: "work",
    label: "Evidence & testing",
    tabs: ["evidence", "testing", "findings"],
  },
  { key: "conclusion", label: "Conclusion", tabs: ["review"] },
];

/** The section a tab belongs to; null for Activity, which is reached on its own. */
export function sectionOf(tab: RecordTab): RecordSection | null {
  return RECORD_SECTIONS.find((item) => item.tabs.includes(tab))?.key ?? null;
}

export type StageStatus =
  | "not_started"
  | "ready"
  | "in_progress"
  | "waiting_evidence"
  | "awaiting_approval"
  | "blocked"
  | "done"
  | "not_applicable";

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  not_started: "Not started",
  ready: "Ready",
  in_progress: "In progress",
  waiting_evidence: "Waiting for evidence",
  awaiting_approval: "Awaiting a decision",
  blocked: "Blocked",
  done: "Done",
  not_applicable: "Not applicable",
};

export type LifecycleStage = {
  key:
    | "design"
    | "evidence"
    | "interim"
    | "rollforward"
    | "review"
    | "conclusion";
  label: string;
  status: StageStatus;
  /** What exactly, in a few words, from the records. */
  note: string;
  /** An agent is doing this stage's work now. */
  agent: boolean;
  tab: RecordTab;
};

export type WorkspaceInput = {
  control: ControlRow;
  plan: EvidencePlan | null;
  context: ControlContext | null;
  test: ControlTest | null;
  /** The interim test sheet (rounds have their own). */
  sheet: TestSheet | null;
  review: ControlReview | null;
  rounds: TestRound[];
  workpapers: Workpaper[] | null;
  tasks: PlanTask[];
  files: ControlFiles | null;
  findings: Deficiency[];
  /** Whether an agent worker will pick up queued runs (M1d); null when unknown. */
  automation?: Automation | null;
};

const RECEIVED = new Set(["RECEIVED", "CLOSED"]);
const OUT = new Set([
  "SENT",
  "WAITING_FOR_RESPONSE",
  "PARTIALLY_RECEIVED",
  "OVERDUE",
  "ESCALATED",
]);
const BLOCKING_READINESS = new Set([
  "NEEDS_INFORMATION",
  "PLAN_NOT_APPROVED",
  "PROCESS_UNDERSTANDING_INCOMPLETE",
  "CONFLICT_REQUIRES_REVIEW",
]);

function phaseOf(plan: EvidencePlan | null, phase: Phase): PlanPhase | null {
  return plan?.phases.find((item) => item.phase === phase) ?? null;
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** Where each phase of the audit stands, from its records. Not every control has every
 * phase: one the evidence plan says does not apply is marked so, never shown as done. */
export function lifecycleOf(input: WorkspaceInput): LifecycleStage[] {
  const { control, plan, context, sheet, review, rounds, workpapers, test } =
    input;
  const blocked =
    context?.readiness !== null &&
    context?.readiness !== undefined &&
    BLOCKING_READINESS.has(context.readiness.state);
  // Waiting for a reviewer to approve the test plan is a step of the work, not a fault.
  const waitsForPlan = context?.readiness?.state === "PLAN_NOT_APPROVED";
  const live = control.requests.filter((r) => r.status !== "CANCELLED");
  const designPhase = phaseOf(plan, "DESIGN");
  const interimPhase = phaseOf(plan, "INTERIM");
  const rollPhase = phaseOf(plan, "ROLLFORWARD");
  const designPaper = (workpapers ?? []).find((p) => p.stage === "DESIGN");
  const walkthrough = input.tasks.find((t) => t.kind === "walkthrough");

  // 1. Design and walkthrough.
  const designRequests = live.filter((r) => r.phase === "DESIGN");
  let design: Omit<LifecycleStage, "key" | "label" | "tab">;
  // The walkthrough workpaper is design testing, on the Testing view; the rest of the
  // stage (attributes, the plan's approval) is on the Test plan tab.
  const walkthroughWork =
    designPaper !== undefined ||
    designRequests.some((r) => RECEIVED.has(r.status)) ||
    walkthrough?.status === "RUNNING";
  if (designPhase?.applicability === "NOT_APPLICABLE") {
    design = { status: "not_applicable", note: "Not needed", agent: false };
  } else if (designPaper?.status === "PREPARED") {
    design = { status: "done", note: "Workpaper prepared", agent: false };
  } else if (designPaper?.drafting === true) {
    design = { status: "in_progress", note: "Agent drafting", agent: true };
  } else if ((context?.proposed.length ?? 0) > 0) {
    design = {
      status: "awaiting_approval",
      note: `${plural(context?.proposed.length ?? 0, "attribute")} proposed`,
      agent: false,
    };
  } else if (
    designRequests.some((r) => OUT.has(r.status)) &&
    !designRequests.some((r) => RECEIVED.has(r.status))
  ) {
    design = {
      status: "waiting_evidence",
      note: "Design evidence requested",
      agent: false,
    };
  } else if (
    designPaper !== undefined ||
    designRequests.some((r) => RECEIVED.has(r.status)) ||
    walkthrough?.status === "RUNNING"
  ) {
    design = { status: "in_progress", note: "Walkthrough", agent: false };
  } else if (blocked) {
    design = {
      status: waitsForPlan ? "awaiting_approval" : "blocked",
      note: context?.readiness?.label ?? "Blocked",
      agent: false,
    };
  } else {
    design = { status: "not_started", note: "", agent: false };
  }

  // 2. Evidence for design and interim (roll-forward evidence belongs to its rounds).
  const current = live.filter(
    (r) => r.phase !== "ROLLFORWARD" && r.phase !== "RETEST",
  );
  const phases = [designPhase, interimPhase].filter(
    (item): item is PlanPhase =>
      item !== null && item.applicability !== "NOT_APPLICABLE",
  );
  const received = current.filter((r) => RECEIVED.has(r.status)).length;
  let evidence: Omit<LifecycleStage, "key" | "label" | "tab">;
  if (current.length === 0) {
    evidence = {
      status: "not_started",
      note:
        plan === null || plan.status === "NOT_PLANNED"
          ? "Not planned"
          : "Planned, not requested",
      agent: false,
    };
  } else if (received === current.length) {
    const toJudge = phases.some((p) => p.state === "RECEIVED_NOT_VALIDATED");
    const gaps = phases.some((p) =>
      p.requirements.some(
        (q) => q.state === "INSUFFICIENT" || q.state === "FOLLOW_UP_REQUIRED",
      ),
    );
    evidence = gaps
      ? { status: "blocked", note: "Gaps found", agent: false }
      : toJudge
        ? {
            status: "awaiting_approval",
            note: "Received, sufficiency to judge",
            agent: false,
          }
        : { status: "done", note: "Received", agent: false };
  } else if (control.overdue) {
    evidence = {
      status: "waiting_evidence",
      note: `Overdue · ${received}/${current.length} in`,
      agent: false,
    };
  } else if (current.some((r) => OUT.has(r.status))) {
    evidence = {
      status: "waiting_evidence",
      note: `${received}/${current.length} in`,
      agent: false,
    };
  } else if (
    current.some(
      (r) =>
        r.status === "APPROVAL_PENDING" && r.approvalDecision === "APPROVED",
    )
  ) {
    // Approved and waiting for the preparer to send it (evidence-flow.ts).
    evidence = {
      status: "ready",
      note: "Approved, not sent",
      agent: false,
    };
  } else if (current.some((r) => r.status === "APPROVAL_PENDING")) {
    evidence = {
      status: "awaiting_approval",
      note: "Request awaiting approval",
      agent: false,
    };
  } else if (control.evidencePlan === "NONE" || control.reconcile === true) {
    // A kickoff draft held for planning: not ready to submit.
    evidence = {
      status: "blocked",
      note: "Drafted before planning",
      agent: false,
    };
  } else {
    evidence = {
      status: "ready",
      note: "Drafted, not sent",
      agent: false,
    };
  }

  // 3. Interim testing.
  let interim: Omit<LifecycleStage, "key" | "label" | "tab">;
  if (interimPhase?.applicability === "NOT_APPLICABLE") {
    interim = { status: "not_applicable", note: "Not needed", agent: false };
  } else if (sheet?.status === "SIGNED_OFF") {
    interim = {
      status: "done",
      note:
        sheet.conclusion === "NOT_EFFECTIVE" ? "Not effective" : "Effective",
      agent: false,
    };
  } else if (sheet?.running === true) {
    interim = {
      status: "in_progress",
      note:
        sheet.runState === "QUEUED" ? "Queued for the tester" : "Agent testing",
      agent: true,
    };
  } else if (sheet !== null && sheet !== undefined) {
    const left = control.sheetLeft;
    interim =
      left === "TESTING"
        ? {
            status: "blocked",
            note: "Testing stopped: run again",
            agent: false,
          }
        : left === "EVIDENCE"
          ? {
              status: "waiting_evidence",
              note: "Sample evidence",
              agent: false,
            }
          : left === "PLACE"
            ? { status: "in_progress", note: "Files to link", agent: false }
            : {
                status: "awaiting_approval",
                note: "Results to confirm",
                agent: false,
              };
  } else if (test?.status === "PROPOSED") {
    interim = {
      status: "awaiting_approval",
      note: "Samples to approve",
      agent: false,
    };
  } else if (blocked) {
    interim = {
      status: waitsForPlan ? "awaiting_approval" : "blocked",
      note: context?.readiness?.label ?? "Blocked",
      agent: false,
    };
  } else if (
    control.progress === "READY_FOR_TESTING" ||
    control.progress === "EVIDENCE_RECEIVED"
  ) {
    interim = { status: "ready", note: "Evidence in", agent: false };
  } else {
    interim = { status: "not_started", note: "", agent: false };
  }

  // 4. Roll-forward: only as the plan and the rounds say.
  const forward = rounds.filter(
    (round) => round.kind === "ROLLFORWARD" && round.status !== "CANCELLED",
  );
  let rollforward: Omit<LifecycleStage, "key" | "label" | "tab">;
  if (rollPhase?.applicability === "NOT_APPLICABLE") {
    rollforward = {
      status: "not_applicable",
      note: "Not needed",
      agent: false,
    };
  } else if (forward.length === 0) {
    rollforward = {
      status: "not_started",
      note:
        rollPhase?.applicability === "CONDITIONAL"
          ? "If a condition is met"
          : "After interim sign-off",
      agent: false,
    };
  } else if (forward.every((round) => round.status === "SIGNED_OFF")) {
    rollforward = { status: "done", note: "Signed off", agent: false };
  } else if (forward.some((round) => round.status === "TESTING")) {
    rollforward = { status: "in_progress", note: "Testing", agent: false };
  } else {
    rollforward = {
      status: "waiting_evidence",
      note: "Evidence requested",
      agent: false,
    };
  }

  // 5. Independent review.
  let reviewStage: Omit<LifecycleStage, "key" | "label" | "tab">;
  const left = control.reviewLeft;
  if (left === "SIGNED" || review?.status === "SIGNED_OFF") {
    reviewStage = { status: "done", note: "Signed off", agent: false };
  } else if (left === "REPERFORMING" || review?.reperforming === true) {
    reviewStage = {
      status: "in_progress",
      note:
        review?.reperformState === "QUEUED"
          ? "Re-performance queued"
          : "Reviewer agent re-performing",
      agent: true,
    };
  } else if (left === "DECIDE" || left === "CLEAR" || left === "SIGN") {
    reviewStage = {
      status: "awaiting_approval",
      note: "With the reviewer",
      agent: false,
    };
  } else if (left === "ADDRESS" || left === "REPERFORM") {
    reviewStage = {
      status: "in_progress",
      note: "Notes to answer",
      agent: false,
    };
  } else if (control.sheetStatus === "SIGNED_OFF") {
    reviewStage = {
      status: "ready",
      note: "Workpapers to prepare",
      agent: false,
    };
  } else {
    reviewStage = { status: "not_started", note: "", agent: false };
  }

  // 6. Conclusion: only a signed-off review concludes.
  const conclusion: Omit<LifecycleStage, "key" | "label" | "tab"> =
    control.conclusion === "EFFECTIVE"
      ? { status: "done", note: "Effective", agent: false }
      : control.conclusion === "EXCEPTION"
        ? { status: "done", note: "With exceptions", agent: false }
        : { status: "not_started", note: "", agent: false };

  return [
    {
      key: "design",
      label: "Design",
      tab:
        walkthroughWork && (context?.proposed.length ?? 0) === 0
          ? "testing"
          : "design",
      ...design,
    },
    { key: "evidence", label: "Evidence", tab: "evidence", ...evidence },
    { key: "interim", label: "Interim", tab: "testing", ...interim },
    {
      key: "rollforward",
      label: "Roll-forward",
      tab: "testing",
      ...rollforward,
    },
    { key: "review", label: "Review", tab: "review", ...reviewStage },
    { key: "conclusion", label: "Conclusion", tab: "review", ...conclusion },
  ];
}

/** A stage's full name, for the line that says where the audit stands. */
export const STAGE_TITLES: Record<LifecycleStage["key"], string> = {
  design: "Design and walkthrough",
  evidence: "Evidence collection",
  interim: "Interim testing",
  rollforward: "Roll-forward testing",
  review: "Independent review",
  conclusion: "Conclusion",
};

const UNDER_WAY: ReadonlySet<StageStatus> = new Set([
  "ready",
  "in_progress",
  "waiting_evidence",
  "awaiting_approval",
  "blocked",
]);

/**
 * The stage the audit stands at: the first one under way, else the first not started.
 * A stage the plan says does not apply is never current. Null when every stage that
 * applies is done.
 */
export function currentStage(
  stages: readonly LifecycleStage[],
): LifecycleStage | null {
  return (
    stages.find((stage) => UNDER_WAY.has(stage.status)) ??
    stages.find((stage) => stage.status === "not_started") ??
    null
  );
}

/** The control's definition work that waits on a person, part by part. */
export type DefinitionWork = {
  /** Client values the control's statement still lacks. */
  values: boolean;
  /** Attributes: none approved, a proposal or library update to decide, or an open
   * question or conflict about them. */
  attributes: boolean;
  /** The process map to build, confirm, or replace, or an open question about it. */
  process: boolean;
  /** Supporting documents not yet reviewed against the control. */
  documents: boolean;
};

/**
 * What of the control's definition needs a person now. The test plan itself is reviewed
 * on the Test plans page; these decisions are made on the control, and appear there only
 * while they wait.
 */
export function definitionWork(context: ControlContext | null): DefinitionWork {
  if (context === null) {
    return {
      values: false,
      attributes: false,
      process: false,
      documents: false,
    };
  }
  const open = context.issues.filter((item) => item.status === "OPEN");
  return {
    values:
      context.design?.slots.some(
        (slot) => !slot.automatic && slot.value.trim() === "",
      ) ?? false,
    attributes:
      context.approved.length === 0 ||
      context.proposed.length > 0 ||
      context.libraryUpdate !== null ||
      open.some((item) => item.origin !== "PROCESS"),
    process:
      (context.processRequired &&
        context.understanding.status !== "CONFIRMED") ||
      context.understanding.proposedSteps !== null ||
      open.some((item) => item.origin === "PROCESS"),
    documents: context.documents.some((item) => !item.reviewed),
  };
}

export type AttentionItem = {
  key: string;
  title: string;
  detail: string;
  /** Who resolves it: "You", or the role it waits on. */
  owner: string;
  kind: "blocker" | "action" | "waiting";
  tab: RecordTab;
  anchor: string;
  /** On the Evidence tab: the view and the record it opens. */
  target?: AssistantAction["target"];
  /** A page outside the record (the approvals queue), when the work is done there. */
  href?: string;
  /** The page the work is done on, when it is not the record (assistant-model.ts); the
   * page resolves it to href, with the button's words. */
  page?: AssistantAction["page"];
  /** The button's words when the work is done on another page. */
  hrefLabel?: string;
  quick: AssistantAction["quick"];
};

/** What needs a person, most pressing first: the steps that block testing, the other
 * steps the agent has for the viewer, then what waits on someone else. */
export function attentionOf(
  brief: AssistantBrief,
  control: ControlRow,
  waitingOn: string,
): AttentionItem[] {
  const actions = [...brief.actions].sort(
    (a, b) => Number(b.urgent) - Number(a.urgent),
  );
  const items: AttentionItem[] = actions.map((action) => ({
    key: action.key,
    title: action.title,
    detail: action.detail,
    owner: "You",
    kind: action.urgent ? "blocker" : "action",
    tab: action.tab,
    anchor: action.anchor,
    ...(action.target !== undefined ? { target: action.target } : {}),
    ...(action.page !== undefined ? { page: action.page } : {}),
    quick: action.quick,
  }));
  // The control's own next step, when it is someone else's.
  if (
    !control.yours &&
    !control.drafted &&
    control.progress !== "CONCLUDED" &&
    waitingOn !== ""
  ) {
    items.push({
      key: `next-${control.nextStep}`,
      title: control.nextStep,
      detail: control.overdue ? "Overdue" : "",
      owner: waitingOn,
      kind: "waiting",
      tab: "overview",
      anchor: "",
      quick: null,
    });
  }
  for (const line of brief.waiting) {
    items.push({
      key: `waiting-${line}`,
      title: line,
      detail: "",
      owner: "Pending",
      kind: "waiting",
      tab: "overview",
      anchor: "",
      quick: null,
    });
  }
  return items;
}

/**
 * Why nothing is the viewer's: the control is concluded, an agent is working, it waits
 * on someone else, or nothing is pending at all.
 */
export type CalmReason = "concluded" | "working" | "waiting" | "clear";

export type NextAction = {
  /** The one thing to do next; null when nothing is the viewer's. */
  primary: AttentionItem | null;
  /** The viewer's other items, in the same order. */
  more: AttentionItem[];
  /** What waits on someone else. */
  waiting: AttentionItem[];
  calm: CalmReason;
};

/**
 * The viewer's next action, from what needs a person (attentionOf: what blocks testing
 * first, then the rest) and the agents that stopped before finishing, which a person
 * starts again. With none of those, the control's own next step when it is the viewer's
 * (`fallback`). Nothing here decides or approves anything; each item opens the place
 * where a person does it.
 */
export function nextActionOf(input: {
  attention: readonly AttentionItem[];
  lanes: readonly AgentLane[];
  control: Pick<ControlRow, "progress">;
  /** Whether the viewer may start an agent again (the API checks it again). */
  canAct: boolean;
  fallback?: AttentionItem | null;
  /** The control's canonical next step (the register's next_step, actor and yours), the
   * same state the guided workspace's Needs-you card shows: it leads, as the viewer's
   * action or as what the control waits on (M1 acceptance follow-up). */
  canonical?: AttentionItem | null;
}): NextAction {
  const stopped: AttentionItem[] = input.lanes
    .filter((lane) => lane.run === "stopped")
    .map((lane) => ({
      key: `stopped-${lane.key}`,
      title: `${lane.agent} could not finish`,
      detail: lane.runNote,
      owner: input.canAct ? "You" : "Preparer",
      kind: input.canAct ? "action" : "waiting",
      tab: lane.tab,
      anchor: "",
      quick: null,
    }));
  const yours = [
    ...input.attention.filter((item) => item.kind !== "waiting"),
    ...stopped.filter((item) => item.kind !== "waiting"),
  ];
  const waiting = [
    ...stopped.filter((item) => item.kind === "waiting"),
    ...input.attention.filter((item) => item.kind === "waiting"),
  ];
  if (yours.length === 0 && input.fallback) {
    yours.push(input.fallback);
  }
  if (input.canonical) {
    const same = (item: AttentionItem) =>
      item.key === input.canonical?.key ||
      item.title === input.canonical?.title;
    if (input.canonical.kind === "waiting") {
      waiting.splice(
        0,
        waiting.length,
        input.canonical,
        ...waiting.filter((i) => !same(i)),
      );
    } else {
      yours.splice(
        0,
        yours.length,
        input.canonical,
        ...yours.filter((i) => !same(i)),
      );
    }
  }
  const summary = laneSummary(input.lanes);
  return {
    primary: yours[0] ?? null,
    more: yours.slice(1),
    waiting,
    calm:
      input.control.progress === "CONCLUDED"
        ? "concluded"
        : summary.running + summary.queued > 0
          ? "working"
          : waiting.length > 0
            ? "waiting"
            : "clear",
  };
}

export type Figures = {
  evidence: { received: number; total: number; accepted: number; gaps: number };
  testing: { label: string; detail: string };
  findings: { open: number; potential: number };
};

/** The three figures that say whether the control can move on: its evidence (received,
 * and accepted as sufficient), its testing, and its findings. */
export function figuresOf(
  input: WorkspaceInput,
  stages: LifecycleStage[],
): Figures {
  const { control, plan, sheet, findings } = input;
  const current = control.requests.filter(
    (r) =>
      r.status !== "CANCELLED" &&
      r.phase !== "ROLLFORWARD" &&
      r.phase !== "RETEST",
  );
  const requirements = currentRequirements(plan);
  const interim = stages.find((stage) => stage.key === "interim");
  return {
    evidence: {
      received: current.filter((r) => RECEIVED.has(r.status)).length,
      total: current.length,
      accepted: requirements.filter((q) => q.state === "ACCEPTED").length,
      gaps: requirements.filter(
        (q) => q.state === "INSUFFICIENT" || q.state === "FOLLOW_UP_REQUIRED",
      ).length,
    },
    testing: {
      label: STAGE_STATUS_LABELS[interim?.status ?? "not_started"],
      detail:
        sheet === null
          ? (interim?.note ?? "")
          : `${sheet.counts.tested} of ${plural(sheet.counts.items, "item")} tested${sheet.counts.exceptions > 0 ? ` · ${plural(sheet.counts.exceptions, "exception")}` : ""}`,
    },
    findings: {
      open: findings.filter(
        (item) => item.status !== "REMEDIATED" && item.status !== "CLOSED",
      ).length,
      // An exception the tester found that is not yet logged or dismissed by a person.
      potential:
        sheet !== null && sheet.status === "OPEN" && sheet.counts.exceptions > 0
          ? sheet.counts.exceptions
          : sheet?.proposalStatus === "PROPOSED"
            ? 1
            : 0,
    },
  };
}

/** The evidence the plan requires for design and interim (the roll-forward's belongs to
 * its rounds), leaving out phases that do not apply and cancelled items. */
function currentRequirements(plan: EvidencePlan | null) {
  return (plan?.phases ?? [])
    .filter(
      (phase) =>
        phase.phase !== "ROLLFORWARD" &&
        phase.applicability !== "NOT_APPLICABLE",
    )
    .flatMap((phase) => phase.requirements)
    .filter((q) => q.state !== "CANCELLED");
}

export type Metric = {
  key: "results" | "drafts" | "sufficiency";
  label: string;
  /** "—" when the records hold nothing to count yet, never a guessed zero. */
  value: string;
  note: string;
  tab: RecordTab;
  anchor: string;
  target?: AssistantAction["target"];
};

const DRAFT_STAGES = new Set(["DRAFTED", "RETURNED", "HELD"]);

/**
 * The three figures under the next action: the test results that wait on a person's
 * judgment, the evidence requests still in draft, and the planned evidence a person has
 * accepted as sufficient. Sufficiency counts only requirements accepted on the evidence
 * plan, never files received.
 */
export function summaryMetrics(input: WorkspaceInput): Metric[] {
  const { control, plan, sheet } = input;
  const interimApplies =
    phaseOf(plan, "INTERIM")?.applicability !== "NOT_APPLICABLE";
  const toJudge =
    sheet !== null && sheet.status === "OPEN"
      ? sheet.counts.unable + sheet.counts.review
      : 0;
  const results: Metric = {
    key: "results",
    label: "Results to review",
    value: sheet === null ? "—" : String(toJudge),
    note:
      sheet === null
        ? interimApplies
          ? "Testing not started"
          : "Interim testing not applicable"
        : sheet.status === "SIGNED_OFF"
          ? "Testing signed off"
          : `${sheet.counts.tested} of ${plural(sheet.counts.items, "item")} tested${sheet.counts.exceptions > 0 ? ` · ${plural(sheet.counts.exceptions, "exception")}` : ""}`,
    tab: "testing",
    anchor: stepAnchor("Test results and sign-off"),
  };

  const stages = control.requests
    .filter((r) => r.status !== "CANCELLED")
    .map((r) => requestStage(r, control));
  const drafts = stages.filter((s) => DRAFT_STAGES.has(s)).length;
  const held = stages.filter((s) => s === "HELD").length;
  const awaiting = stages.filter((s) => s === "AWAITING_APPROVAL").length;
  const draftMetric: Metric = {
    key: "drafts",
    label: drafts === 1 ? "Draft request" : "Draft requests",
    value: String(drafts),
    note:
      held > 0
        ? `${held} held for planning`
        : awaiting > 0
          ? `${awaiting} awaiting approval`
          : stages.length === 0
            ? "None drafted yet"
            : "",
    tab: "evidence",
    anchor: "",
    target: { view: "requests" },
  };

  const requirements = currentRequirements(plan);
  const accepted = requirements.filter((q) => q.state === "ACCEPTED").length;
  const gaps = requirements.filter(
    (q) => q.state === "INSUFFICIENT" || q.state === "FOLLOW_UP_REQUIRED",
  ).length;
  const sufficiency: Metric = {
    key: "sufficiency",
    label: "Evidence sufficient",
    value:
      requirements.length === 0 ? "—" : `${accepted} / ${requirements.length}`,
    note:
      requirements.length === 0
        ? "No evidence planned yet"
        : gaps > 0
          ? `${plural(gaps, "gap")} to follow up`
          : "",
    tab: "evidence",
    anchor: "",
    target: { view: "requirements" },
  };
  return [results, draftMetric, sufficiency];
}

// Activity

export type ActivityCategory =
  | "design"
  | "planning"
  | "evidence"
  | "testing"
  | "review"
  | "findings"
  | "approval"
  | "workflow"
  | "error";

export type ActivityItem = {
  id: string;
  at: string;
  by: "agent" | "person" | "workspace";
  actor: string;
  category: ActivityCategory;
  action: string;
  title: string;
  detail: string;
};

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  design: "Design",
  planning: "Planning",
  evidence: "Evidence",
  testing: "Testing",
  review: "Review",
  findings: "Findings",
  approval: "Approvals",
  workflow: "Workflow",
  error: "Errors",
};

const CATEGORIES = Object.keys(ACTIVITY_CATEGORY_LABELS) as ActivityCategory[];

export function parseActivity(value: unknown): ActivityItem[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items: ActivityItem[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const item = raw as Record<string, unknown>;
    const str = (key: string) =>
      typeof item[key] === "string" ? (item[key] as string) : "";
    const by = str("by");
    const category = str("category");
    if (str("id") === "" || str("at") === "") {
      continue;
    }
    items.push({
      id: str("id"),
      at: str("at"),
      by: by === "agent" || by === "person" ? by : "workspace",
      actor: str("actor"),
      category: CATEGORIES.includes(category as ActivityCategory)
        ? (category as ActivityCategory)
        : "workflow",
      action: str("action"),
      title: str("title"),
      detail: str("detail"),
    });
  }
  return items;
}

/** The activity a filter keeps: by who did it and by kind. */
export function filterActivity(
  items: readonly ActivityItem[],
  by: "all" | ActivityItem["by"],
  category: "all" | ActivityCategory,
): ActivityItem[] {
  return items.filter(
    (item) =>
      (by === "all" || item.by === by) &&
      (category === "all" || item.category === category),
  );
}

// Agents on the control

/** What a workpaper is made of, section by section: what the records filled in, what the
 * agent drafted with evidence cited and without, what a person wrote, what is still empty,
 * and the reviewer's notes on it that are not settled. Nothing here is a conclusion. */
export type Makeup = {
  records: number;
  cited: number;
  uncited: number;
  person: number;
  empty: number;
  openNotes: number;
};

const OPEN_NOTES = new Set(["PROPOSED", "OPEN", "RESPONDED"]);

export function workpaperMakeup(
  paper: Workpaper,
  review: ControlReview | null,
): Makeup {
  const makeup: Makeup = {
    records: 0,
    cited: 0,
    uncited: 0,
    person: 0,
    empty: 0,
    openNotes: (review?.notes ?? []).filter(
      (note) => note.workpaperId === paper.id && OPEN_NOTES.has(note.status),
    ).length,
  };
  for (const section of paper.sections) {
    const filled =
      section.text.trim() !== "" ||
      section.rows.length > 0 ||
      section.fields.some((field) => field.value.trim() !== "");
    if (!filled) {
      makeup.empty += 1;
    } else if (section.source === "PERSON") {
      makeup.person += 1;
    } else if (section.source === "AGENT") {
      if (section.citations.length > 0) {
        makeup.cited += 1;
      } else {
        makeup.uncited += 1;
      }
    } else {
      makeup.records += 1;
    }
  }
  return makeup;
}

export function makeupText(makeup: Makeup): string {
  return [
    makeup.cited > 0 ? `${makeup.cited} drafted with evidence cited` : "",
    makeup.uncited > 0 ? `${makeup.uncited} drafted without a citation` : "",
    makeup.person > 0 ? `${makeup.person} written by a person` : "",
    makeup.records > 0 ? `${makeup.records} from the records` : "",
    makeup.empty > 0 ? `${makeup.empty} not drafted yet` : "",
    makeup.openNotes > 0
      ? `${plural(makeup.openNotes, "review note")} open`
      : "",
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

/** What the agent is doing on its job: running now, handed to the background and not yet
 * picked up, stopped (it gave up and a person starts it again), or not running. */
export type LaneRun = "running" | "queued" | "stopped" | "idle" | "unavailable";

/** Whether the agent's output still waits on a person: nothing to decide yet, a decision
 * pending, or decided (approved, signed off, prepared). */
export type LaneDecision = {
  state: "none" | "pending" | "decided";
  text: string;
  /** Who decides: "You", or the role. */
  owner: string;
};

export type AgentLane = {
  key:
    | "context"
    | "requests"
    | "reader"
    | "design"
    | "tester"
    | "effectiveness"
    | "reviewer";
  agent: string;
  job: string;
  run: LaneRun;
  runNote: string;
  /** What the agent waits for before it can start, a dependency or a gate; "" when it
   * can work, or has. */
  waitsFor: string;
  /** What it has produced, from the records; "" when nothing yet. */
  output: string;
  decision: LaneDecision;
  /** A note on independence the person should know. */
  note: string;
  tab: RecordTab;
};

const NO_DECISION: LaneDecision = { state: "none", text: "", owner: "" };

function runOf(state: RunState, automation: Automation | null): LaneRun {
  // A lease is "running" or "queued" only when a worker exists to run it; otherwise the
  // lane says automation is unavailable rather than implying work (execution-model).
  if (
    (state === "RUNNING" || state === "QUEUED") &&
    automation?.available !== true
  ) {
    return "unavailable";
  }
  return state === "RUNNING"
    ? "running"
    : state === "QUEUED"
      ? "queued"
      : "idle";
}

const join = (parts: string[], glue = " · ") =>
  parts.filter((part) => part !== "").join(glue);

/**
 * Each agent working on the control, in the order of the audit, with four things kept
 * apart: whether it is running, whether it can work yet (and what it waits for), what it
 * produced, and whether a person has decided on that. Everything is read from the
 * records; an agent with no record of running is never shown as running.
 */
export function agentLanes(input: WorkspaceInput): AgentLane[] {
  const { control, plan, context, test, sheet, review, workpapers, files } =
    input;
  const lanes: AgentLane[] = [];
  const applies = (phase: Phase) =>
    phaseOf(plan, phase)?.applicability !== "NOT_APPLICABLE";
  const preparer = review?.viewerPrepared === true ? "You" : "Preparer";
  const reviewer = review?.viewerIsReviewer === true ? "You" : "Reviewer";

  // The control analyst: attributes, the process map, supporting documents.
  if (context !== null) {
    const proposed = context.proposed.filter(
      (item) => item.sourceKind === "AGENT" || item.sourceKind === "DOCUMENT",
    ).length;
    const reviewed = context.documents.filter((item) => item.reviewed).length;
    const steps = context.understanding.steps.length;
    const mapped =
      (context.understanding.builtBy === "AGENT" ||
        context.understanding.builtBy === "RULES") &&
      steps > 0;
    const mapToConfirm =
      context.processRequired && context.understanding.status === "DRAFT";
    lanes.push({
      key: "context",
      agent: "Control analyst",
      job: "Reads the control, its sources, and its process",
      run: "idle",
      runNote: "",
      waitsFor: "",
      output: join([
        proposed > 0 ? `Proposed ${plural(proposed, "attribute change")}` : "",
        mapped ? `Mapped the process in ${plural(steps, "step")}` : "",
        reviewed > 0
          ? `Reviewed ${plural(reviewed, "supporting document")}`
          : "",
      ]),
      decision:
        context.proposed.length > 0 || mapToConfirm
          ? {
              state: "pending",
              text: join(
                [
                  context.proposed.length > 0
                    ? `${plural(context.proposed.length, "attribute change")} to approve or reject`
                    : "",
                  mapToConfirm ? "the process map to confirm" : "",
                ],
                ", and ",
              ),
              owner: preparer,
            }
          : context.approved.length > 0
            ? {
                state: "decided",
                text: `${plural(context.approved.length, "attribute")} approved`,
                owner: "",
              }
            : NO_DECISION,
      note: "",
      tab: "design",
    });
  }

  // The request drafter: evidence requests to the control owner.
  const live = control.requests.filter((r) => r.status !== "CANCELLED");
  // Each request's stage from the shared derivation (evidence-flow.ts).
  const stages = live.map((r) => requestStage(r, control));
  const held = stages.filter((s) => s === "HELD").length;
  const drafted = stages.filter(
    (s) => s === "DRAFTED" || s === "RETURNED",
  ).length;
  const toApprove = stages.filter((s) => s === "AWAITING_APPROVAL").length;
  const toSend = stages.filter((s) => s === "APPROVED").length;
  const sent = live.filter(
    (r) => OUT.has(r.status) || RECEIVED.has(r.status),
  ).length;
  const answered = live.filter((r) => RECEIVED.has(r.status)).length;
  lanes.push({
    key: "requests",
    agent: "Request drafter",
    job: "Drafts the evidence requests from the evidence plan",
    run: "idle",
    runNote: "",
    waitsFor:
      live.length === 0 && (plan === null || plan.status === "NOT_PLANNED")
        ? "Waits for the evidence plan"
        : "",
    output: live.length > 0 ? `Drafted ${plural(live.length, "request")}` : "",
    decision:
      held > 0
        ? {
            state: "pending",
            text:
              control.evidencePlan === "PROPOSED"
                ? `${plural(held, "request")} drafted, held until the evidence plan is approved`
                : `${plural(held, "request")} drafted before planning: plan the evidence, then settle ${held === 1 ? "it" : "them"} against the plan`,
            owner: "Preparer",
          }
        : drafted > 0
          ? {
              state: "pending",
              text: `${plural(drafted, "request")} drafted, to review and approve`,
              owner: "Preparer",
            }
          : toSend > 0
            ? {
                state: "pending",
                text: `${plural(toSend, "request")} approved, to send`,
                owner: "Preparer",
              }
            : toApprove > 0
              ? {
                  state: "pending",
                  text: `${plural(toApprove, "request")} awaiting approval before sending`,
                  owner: "Approver",
                }
              : sent > 0
                ? {
                    state: "decided",
                    text: `Approved and sent · ${answered} of ${sent} answered`,
                    owner: "",
                  }
                : NO_DECISION,
    note: "",
    tab: "evidence",
  });

  // The evidence reader: files read, classified, and checked against the plan.
  const all = files?.files ?? [];
  const working = all.filter((file) => file.readStatus === "WORKING").length;
  const pending = all.filter((file) => file.readStatus === "PENDING").length;
  const failed = all.filter((file) => file.readStatus === "FAILED").length;
  const read = all.filter((file) => file.readStatus === "READY").length;
  const requirements = (plan?.phases ?? [])
    .filter((phase) => phase.applicability !== "NOT_APPLICABLE")
    .flatMap((phase) => phase.requirements)
    .filter((q) => q.state !== "CANCELLED");
  const accepted = requirements.filter((q) => q.state === "ACCEPTED").length;
  const gaps = requirements.filter(
    (q) => q.state === "INSUFFICIENT" || q.state === "FOLLOW_UP_REQUIRED",
  ).length;
  const toJudge = (plan?.phases ?? []).some(
    (phase) => phase.state === "RECEIVED_NOT_VALIDATED",
  );
  lanes.push({
    key: "reader",
    agent: "Evidence reader",
    job: "Reads each file, classifies it, and checks it against the plan",
    run:
      working > 0
        ? "running"
        : pending > 0
          ? "queued"
          : failed > 0
            ? "stopped"
            : "idle",
    runNote:
      working > 0
        ? `Reading ${plural(working, "file")}`
        : pending > 0
          ? `${plural(pending, "file")} queued to read`
          : failed > 0
            ? `${plural(failed, "file")} could not be read`
            : "",
    waitsFor:
      all.length === 0
        ? live.some((r) => RECEIVED.has(r.status))
          ? "Requests answered, but no file is linked to this control"
          : live.some((r) => OUT.has(r.status))
            ? "Waits for the owner's evidence"
            : live.length > 0
              ? "Waits for the requests to be sent"
              : "Waits for evidence to be requested"
        : "",
    output:
      all.length > 0 ? `Read ${read} of ${plural(all.length, "file")}` : "",
    decision:
      gaps > 0
        ? {
            state: "pending",
            text: `${plural(gaps, "evidence gap")} to follow up`,
            owner: "Preparer",
          }
        : toJudge
          ? {
              state: "pending",
              text: "Whether the received evidence is sufficient",
              owner: "Preparer",
            }
          : accepted > 0
            ? {
                state: "decided",
                text: `${accepted} of ${plural(requirements.length, "requirement")} accepted as sufficient`,
                owner: "",
              }
            : NO_DECISION,
    note: "",
    tab: "evidence",
  });

  const papers = workpapers ?? [];
  const paperLane = (
    key: "design" | "effectiveness",
    paper: Workpaper | undefined,
    waitsFor: string,
    gate: string,
    from: string,
  ): AgentLane => {
    const failedDraft =
      paper !== undefined &&
      !paper.drafting &&
      paper.draftNote.includes("could not finish");
    return {
      key,
      agent: key === "design" ? "Design drafter" : "Testing workpaper drafter",
      job:
        key === "design"
          ? "Builds the design and walkthrough workpaper from the evidence"
          : "Builds the operating effectiveness workpaper as testing proceeds",
      run:
        paper === undefined
          ? "idle"
          : failedDraft
            ? "stopped"
            : runOf(paper.draftState, input.automation ?? null),
      runNote:
        paper === undefined
          ? ""
          : failedDraft
            ? paper.draftNote
            : paper.draftState === "RUNNING"
              ? `Drafting version ${paper.currentVersion + 1}`
              : paper.draftState === "QUEUED"
                ? "Draft queued"
                : "",
      waitsFor: paper === undefined ? waitsFor : "",
      output:
        paper === undefined || paper.currentVersion === 0
          ? ""
          : join([
              `Version ${paper.currentVersion}${from}`,
              makeupText(workpaperMakeup(paper, review)),
            ]),
      decision:
        paper === undefined || paper.currentVersion === 0
          ? NO_DECISION
          : paper.status === "PREPARED"
            ? {
                state: "decided",
                text: `Prepared by ${paper.preparedBy ?? "a person"}`,
                owner: "",
              }
            : {
                state: "pending",
                text: gate === "" ? "To review and prepare" : gate,
                owner: preparer,
              },
      note: "",
      tab: key === "design" ? "design" : "testing",
    };
  };
  if (applies("DESIGN")) {
    lanes.push(
      paperLane(
        "design",
        papers.find((p) => p.stage === "DESIGN"),
        read > 0
          ? "Ready: ask for a draft on the Control & design tab"
          : "Starts when the first evidence file is read",
        "",
        "",
      ),
    );
  }

  // The tester: samples, then results against each attribute.
  if (applies("INTERIM")) {
    const stopped =
      sheet !== null &&
      sheet.status === "OPEN" &&
      sheet.runState === "IDLE" &&
      (control.sheetLeft === "TESTING" || sheet.runNote !== "");
    const untested =
      sheet === null
        ? 0
        : sheet.counts.items - sheet.counts.tested - sheet.counts.noEvidence;
    const blocked =
      context?.readiness !== null &&
      context?.readiness !== undefined &&
      BLOCKING_READINESS.has(context.readiness.state);
    const proposedSamples = sheet === null && test?.status === "PROPOSED";
    let waitsFor = "";
    if (sheet !== null && sheet.status === "OPEN" && sheet.waitingNote !== "") {
      waitsFor = sheet.waitingNote;
    } else if (sheet === null && !proposedSamples) {
      waitsFor = blocked
        ? `Waits: ${(control.readinessLabel || "not ready").toLowerCase()}${control.readinessBlocker !== "" ? `. ${control.readinessBlocker}` : ""}`
        : control.populationPending
          ? "Waits for the population to be read"
          : test?.status === "APPROVED"
            ? "Waits for the sample evidence"
            : read > 0
              ? ""
              : "Waits for evidence";
    }
    lanes.push({
      key: "tester",
      agent: "Tester",
      job:
        sheet?.method === "TEST_OF_ONE"
          ? "Tests the control once, against each attribute, citing the evidence"
          : "Draws the samples, then tests each against every attribute",
      run:
        sheet === null
          ? "idle"
          : stopped
            ? "stopped"
            : runOf(sheet.runState, input.automation ?? null),
      runNote:
        sheet === null
          ? ""
          : stopped
            ? sheet.runNote !== ""
              ? `${sheet.runNote} ${plural(untested, "item")} untested.`
              : `Stopped with ${plural(untested, "item")} untested. A person runs it again.`
            : sheet.runState === "RUNNING"
              ? `Testing ${plural(sheet.counts.items, "item")}`
              : sheet.runState === "QUEUED"
                ? "Run queued"
                : "",
      waitsFor,
      output: proposedSamples
        ? `Drew ${plural(test.samples.length, "sample")} from ${test.frameRows} rows in the period`
        : sheet === null
          ? ""
          : join([
              `Tested ${sheet.counts.tested} of ${plural(sheet.counts.items, "item")}`,
              sheet.counts.exceptions > 0
                ? plural(sheet.counts.exceptions, "exception")
                : "",
            ]),
      decision: proposedSamples
        ? { state: "pending", text: "The samples to approve", owner: preparer }
        : sheet === null
          ? NO_DECISION
          : sheet.status === "SIGNED_OFF"
            ? {
                state: "decided",
                text: `Signed off by ${sheet.signedBy ?? "a person"}: ${sheet.conclusion === "NOT_EFFECTIVE" ? "not effective" : "effective"}`,
                owner: "",
              }
            : sheet.counts.tested > 0
              ? {
                  state: "pending",
                  text: "Proposed results to confirm and sign off",
                  owner: preparer,
                }
              : NO_DECISION,
      note: "",
      tab: "testing",
    });

    lanes.push(
      paperLane(
        "effectiveness",
        papers.find((p) => p.stage === "EFFECTIVENESS"),
        "Starts when the tester has its first results",
        sheet?.status === "SIGNED_OFF"
          ? ""
          : "Prepared once the testing is signed off",
        sheet !== null && sheet.status === "OPEN"
          ? ", from proposed results"
          : "",
      ),
    );
  }

  // The reviewer agent: re-performs the testing for the independent reviewer.
  const notes = review?.notes ?? [];
  const differences = notes.filter(
    (note) =>
      note.targetKind === "RESULT" &&
      note.reviewerResult !== null &&
      note.status !== "DISMISSED" &&
      note.status !== "WITHDRAWN",
  ).length;
  const count = (status: string) =>
    notes.filter((note) => note.status === status).length;
  const reviewStopped =
    review !== null &&
    review.reperformState === "IDLE" &&
    review.reperformNote.includes("did not finish");
  lanes.push({
    key: "reviewer",
    agent: "Reviewer agent",
    job: "Re-performs the testing from the evidence for the independent reviewer",
    run:
      review === null
        ? "idle"
        : reviewStopped
          ? "stopped"
          : runOf(review.reperformState, input.automation ?? null),
    runNote:
      review === null
        ? ""
        : reviewStopped
          ? review.reperformNote
          : review.reperformState === "RUNNING"
            ? "Re-performing the testing"
            : review.reperformState === "QUEUED"
              ? "Re-performance queued"
              : "",
    waitsFor:
      review === null ? "Starts when the testing workpaper is prepared" : "",
    output:
      review === null || review.reperformedAt === null
        ? ""
        : join([
            differences === 0
              ? "Re-performed the testing: no differences from the preparer's results"
              : `Re-performed the testing: ${plural(differences, "difference")} from the preparer's results`,
            count("PROPOSED") > 0
              ? `${plural(count("PROPOSED"), "note")} proposed`
              : "",
          ]),
    decision:
      review === null
        ? NO_DECISION
        : review.status === "SIGNED_OFF"
          ? {
              state: "decided",
              text: `Signed off by ${review.signedBy ?? "the reviewer"}`,
              owner: "",
            }
          : count("PROPOSED") > 0
            ? {
                state: "pending",
                text: `${plural(count("PROPOSED"), "proposed note")} to accept or dismiss`,
                owner: reviewer,
              }
            : count("OPEN") > 0
              ? {
                  state: "pending",
                  text: `${plural(count("OPEN"), "note")} to answer`,
                  owner: preparer,
                }
              : count("RESPONDED") > 0
                ? {
                    state: "pending",
                    text: `${plural(count("RESPONDED"), "answer")} to clear`,
                    owner: reviewer,
                  }
                : {
                    state: "pending",
                    text: "Review sign-off",
                    owner: reviewer,
                  },
    note:
      review?.independenceRequired && review.viewerPrepared
        ? "You prepared this control, so another person signs off its review."
        : "",
    tab: "review",
  });
  return lanes;
}

/** How many agents are running, queued, or stopped, and how many outputs wait on a
 * person. */
export function laneSummary(lanes: readonly AgentLane[]): {
  running: number;
  queued: number;
  stopped: number;
  decisions: number;
} {
  return {
    running: lanes.filter((lane) => lane.run === "running").length,
    queued: lanes.filter((lane) => lane.run === "queued").length,
    stopped: lanes.filter((lane) => lane.run === "stopped").length,
    decisions: lanes.filter((lane) => lane.decision.state === "pending").length,
  };
}

// How the control is tested

export type Approach = {
  /** The control's classification, in words. */
  kind: string;
  /** "Sample of 25", "Tested once (automated)". */
  method: string;
  /** Each phase and whether the evidence plan says it applies, with its reason. */
  phases: Array<{
    phase: Phase;
    label: string;
    applies: "yes" | "conditional" | "no" | "pending" | "unplanned";
    reason: string;
  }>;
  processRequired: boolean;
  /** Where the records disagree on how to test it, in words; "" when they agree. */
  conflict: string;
};

const PHASE_NAMES: Record<Phase, string> = {
  DESIGN: "Design",
  INTERIM: "Interim",
  ROLLFORWARD: "Roll-forward",
};

/** The control's testing approach as its records set it: its kind, its method (a sample,
 * or tested once for an automated or configured control), whether its process must be
 * understood, and which phases its evidence plan says apply, with the reasons. */
export function approachOf(
  input: WorkspaceInput,
  kindLabels: Readonly<Record<string, string>>,
): Approach {
  const { control, plan, context, test, sheet } = input;
  const classes = context?.classifications ?? [];
  const method =
    control.nature === "AUTOMATED"
      ? "Tested once (automated)"
      : sheet?.method === "TEST_OF_ONE"
        ? "Tested once (as configured)"
        : test !== null
          ? `Sample of ${test.samples.length || test.sampleSize}`
          : `Sample of ${control.sampleSize}, planned`;
  return {
    kind: classes.map((key) => kindLabels[key] ?? key).join(", "),
    method,
    phases: (["DESIGN", "INTERIM", "ROLLFORWARD"] as const).map((phase) => {
      const found = phaseOf(plan, phase);
      const applicability = found?.applicability ?? null;
      return {
        phase,
        label: PHASE_NAMES[phase],
        applies:
          found === null || applicability === null
            ? "unplanned"
            : applicability === "APPLICABLE"
              ? "yes"
              : applicability === "CONDITIONAL"
                ? "conditional"
                : applicability === "NOT_APPLICABLE"
                  ? "no"
                  : "pending",
        reason:
          found === null
            ? ""
            : applicability === "CONDITIONAL" && found.condition !== ""
              ? found.condition
              : found.rationale,
      };
    }),
    processRequired: context?.processRequired ?? false,
    // An automated application control is tested once; its sample size follows the
    // nature recorded in the RCM, so a manual nature there means a sample is planned.
    conflict:
      classes.includes("AUTOMATED_APPLICATION") &&
      control.nature !== "AUTOMATED" &&
      sheet?.method !== "TEST_OF_ONE"
        ? `Classified as an automated application control, but the RCM records it as ${(control.natureLabel || "manual").toLowerCase()}, so a sample is planned. Confirm its nature: an automated control is tested once.`
        : "",
  };
}
