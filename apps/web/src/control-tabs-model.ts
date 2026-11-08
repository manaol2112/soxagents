/**
 * The control workspace's tabs (product owner's reference, 2 November 2026): one row of
 * tabs under the steps, which show progress and open the tab that holds each step's
 * work. Pure: the tab an address opens, each attribute's evidence state, and the lines
 * the Overview shows, all read from the records the page already holds.
 */

import type { Step } from "./control-journey-model.ts";
import type { RequirementState } from "./evidence-plan-model.ts";
import type { TraceRow } from "./trace-model.ts";

export type WorkspaceTab =
  | "overview"
  | "risk"
  | "design"
  | "testing"
  | "evidence"
  | "findings"
  | "approvals"
  | "history";

export const WORKSPACE_TABS: ReadonlyArray<{
  key: WorkspaceTab;
  label: string;
  icon:
    | "file"
    | "risk"
    | "layers"
    | "chart"
    | "inbox"
    | "target"
    | "shield"
    | "clock";
}> = [
  { key: "overview", label: "Overview", icon: "file" },
  { key: "risk", label: "Risk & Scoping", icon: "risk" },
  { key: "design", label: "Design & Implementation", icon: "layers" },
  { key: "testing", label: "Testing", icon: "chart" },
  { key: "evidence", label: "Evidence", icon: "inbox" },
  { key: "findings", label: "Findings & Issues", icon: "target" },
  { key: "approvals", label: "Approvals", icon: "shield" },
  { key: "history", label: "History", icon: "clock" },
];

/** The tab each step's work is on: a step on the progress line opens it. */
export const STEP_TAB: Record<Step, WorkspaceTab> = {
  PLAN: "design",
  REQUEST: "evidence",
  TEST: "testing",
  CONCLUDE: "findings",
  REVIEW: "approvals",
};

// The classic tabs of earlier links (?tab=), as the tab that now holds their work.
const LEGACY_TABS: Record<string, WorkspaceTab> = {
  overview: "overview",
  design: "design",
  evidence: "evidence",
  testing: "testing",
  findings: "findings",
  review: "approvals",
  activity: "history",
};

/** The tab an address opens: a tab named in ?step=, a step's own tab (an earlier link),
 * a classic ?tab=, else the Overview. */
export function workspaceTab(
  step: string | null,
  legacyTab: string | null,
): WorkspaceTab {
  const asked = (step ?? "").toLowerCase();
  const named = WORKSPACE_TABS.find((tab) => tab.key === asked);
  if (named !== undefined) {
    return named.key;
  }
  const byStep = (Object.keys(STEP_TAB) as Step[]).find(
    (key) => key.toLowerCase() === asked,
  );
  if (byStep !== undefined) {
    return STEP_TAB[byStep];
  }
  return LEGACY_TABS[(legacyTab ?? "").toLowerCase()] ?? "overview";
}

export type AttributeStatus =
  | "READY"
  | "IN_PROGRESS"
  | "NOT_STARTED"
  | "EXCEPTION";

export const ATTRIBUTE_STATUS_LABELS: Record<AttributeStatus, string> = {
  READY: "Ready",
  IN_PROGRESS: "In progress",
  NOT_STARTED: "Not started",
  EXCEPTION: "Exception",
};

const COMPLETE: readonly RequirementState[] = ["ACCEPTED", "NOT_APPLICABLE"];
const NOT_ASKED: readonly RequirementState[] = [
  "NOT_GENERATED",
  "AWAITING_DEPENDENCY",
  "DRAFT",
  "READY_FOR_REVIEW",
  "APPROVAL_PENDING",
  "CANCELLED",
  "REMOVED",
  "NOT_APPLICABLE",
];

export type AttributeLine = {
  code: string;
  text: string;
  status: AttributeStatus;
};

/**
 * Each attribute the plan tests, with where its evidence stands: an exception in testing;
 * Ready once every item asked for it is accepted or not applicable (at least one
 * accepted); In progress while an item is asked for or holds a file; else Not started.
 * Items not yet asked for (a later phase) do not hold an attribute back.
 */
export function attributeLines(
  attributes: ReadonlyArray<{ code: string; text: string }>,
  evidence: ReadonlyArray<{ id: string; attributeCodes: readonly string[] }>,
  requirements: ReadonlyArray<{
    id: string;
    state: RequirementState;
    files: number;
  }>,
  rows: readonly TraceRow[],
): AttributeLine[] {
  const byId = new Map(requirements.map((item) => [item.id, item]));
  return attributes.map((attribute, index) => {
    const row =
      rows.find((each) => each.code === attribute.code) ?? rows[index];
    if (row !== undefined && row.exceptions > 0) {
      return { ...attribute, status: "EXCEPTION" };
    }
    const items = evidence
      .filter((item) => item.attributeCodes.includes(attribute.code))
      .map((item) => byId.get(item.id))
      .filter((item) => item !== undefined);
    const asked = items.filter(
      (item) => !NOT_ASKED.includes(item.state) || item.files > 0,
    );
    if (
      asked.length > 0 &&
      asked.every((item) => COMPLETE.includes(item.state)) &&
      asked.some((item) => item.state === "ACCEPTED")
    ) {
      return { ...attribute, status: "READY" };
    }
    return {
      ...attribute,
      status: asked.length > 0 ? "IN_PROGRESS" : "NOT_STARTED",
    };
  });
}

/** The Overview's one-line insight about the attributes. */
export function attributeInsight(lines: readonly AttributeLine[]): string {
  if (lines.length === 0) {
    return "";
  }
  const ready = lines.filter((line) => line.status === "READY").length;
  const exceptions = lines.filter((line) => line.status === "EXCEPTION").length;
  const verb = lines.length === 1 ? "has" : "have";
  const base =
    ready === 0
      ? `No attribute has sufficient evidence yet (${lines.length} planned).`
      : ready === lines.length
        ? `All ${lines.length} attributes have sufficient evidence and are ready for testing.`
        : `${ready} of ${lines.length} attributes ${verb} sufficient evidence and are ready for testing.`;
  return exceptions === 0
    ? base
    : `${base} ${exceptions} ${exceptions === 1 ? "attribute has" : "attributes have"} an exception in testing.`;
}

export type FileStatus = "VERIFIED" | "READING" | "REVIEW";

export const FILE_STATUS_LABELS: Record<FileStatus, string> = {
  VERIFIED: "Verified",
  READING: "Reading",
  REVIEW: "To review",
};

/** A file on the Overview: Verified once an item it serves is accepted, Reading while the
 * agent reads it, else To review. */
export function fileStatus(
  fileId: string,
  readStatus: string | null,
  requirements: ReadonlyArray<{
    state: RequirementState;
    fileIds: readonly string[];
  }>,
): FileStatus {
  if (
    requirements.some(
      (item) => item.state === "ACCEPTED" && item.fileIds.includes(fileId),
    )
  ) {
    return "VERIFIED";
  }
  return readStatus === null ||
    readStatus === "PENDING" ||
    readStatus === "RUNNING"
    ? "READING"
    : "REVIEW";
}

/** A procedure's phase, as the Overview's tag says it. */
export const PHASE_TAGS: Record<string, string> = {
  DESIGN: "Design",
  INTERIM: "Interim",
  ROLLFORWARD: "Roll-forward",
};

export type ApprovalRow = {
  key: string;
  title: string;
  state: "done" | "waiting" | "todo";
  detail: string;
  tab: WorkspaceTab;
};

/**
 * The Approvals tab's list (2 November 2026): every decision a person makes on the
 * control, where it stands, and the tab where it is made. Read from the records; nothing
 * here approves anything.
 */
export function approvalRows(input: {
  planStatus: string | null;
  approvedRevision: number | null;
  requestsToApprove: number;
  sheetStatus: string | null;
  sheetSignedBy: string;
  reviewStatus: string | null;
  reviewSignedBy: string;
  conclusion: string;
}): ApprovalRow[] {
  const plan: ApprovalRow =
    input.planStatus === "APPROVED"
      ? {
          key: "plan",
          title: "Test plan",
          state: "done",
          detail:
            input.approvedRevision !== null
              ? `Approved (revision ${input.approvedRevision})`
              : "Approved",
          tab: "design",
        }
      : input.planStatus === "PROPOSED" ||
          input.planStatus === "CHANGES_PROPOSED"
        ? {
            key: "plan",
            title: "Test plan",
            state: "waiting",
            detail:
              input.planStatus === "PROPOSED"
                ? "Awaiting approval"
                : "Changes proposed, awaiting approval",
            tab: "design",
          }
        : input.planStatus === "CHANGES_REQUESTED"
          ? {
              key: "plan",
              title: "Test plan",
              state: "waiting",
              detail: "Changes requested from the planning agent",
              tab: "design",
            }
          : {
              key: "plan",
              title: "Test plan",
              state: "todo",
              detail: "Not drafted yet",
              tab: "design",
            };
  const requests: ApprovalRow = {
    key: "requests",
    title: "Evidence requests",
    state: input.requestsToApprove > 0 ? "waiting" : "done",
    detail:
      input.requestsToApprove > 0
        ? `${input.requestsToApprove} awaiting approval to send`
        : "None awaiting approval",
    tab: "evidence",
  };
  const testing: ApprovalRow = {
    key: "testing",
    title: "Testing sign-off",
    state:
      input.sheetStatus === "SIGNED_OFF"
        ? "done"
        : input.sheetStatus === "OPEN"
          ? "waiting"
          : "todo",
    detail:
      input.sheetStatus === "SIGNED_OFF"
        ? `Signed off${input.sheetSignedBy !== "" ? ` by ${input.sheetSignedBy}` : ""}`
        : input.sheetStatus === "OPEN"
          ? "Testing in progress"
          : "Not started",
    tab: "testing",
  };
  const review: ApprovalRow = {
    key: "review",
    title: "Independent review",
    state:
      input.reviewStatus === "SIGNED_OFF"
        ? "done"
        : input.reviewStatus === "OPEN"
          ? "waiting"
          : "todo",
    detail:
      input.reviewStatus === "SIGNED_OFF"
        ? `Signed off${input.reviewSignedBy !== "" ? ` by ${input.reviewSignedBy}` : ""}`
        : input.reviewStatus === "OPEN"
          ? "In review"
          : "Opens once testing is signed off",
    tab: "approvals",
  };
  const conclusion: ApprovalRow = {
    key: "conclusion",
    title: "Conclusion",
    state: input.conclusion === "NOT_CONCLUDED" ? "todo" : "done",
    detail:
      input.conclusion === "EFFECTIVE"
        ? "Effective"
        : input.conclusion === "EXCEPTION"
          ? "Concluded with exceptions"
          : "Not concluded",
    tab: "approvals",
  };
  return [plan, requests, testing, review, conclusion];
}

/** How the insight reads at a glance: every attribute ready, one with an exception, or
 * evidence still coming. */
export function insightTone(
  lines: readonly AttributeLine[],
): "good" | "warn" | "neutral" {
  if (lines.some((line) => line.status === "EXCEPTION")) {
    return "warn";
  }
  return lines.length > 0 && lines.every((line) => line.status === "READY")
    ? "good"
    : "neutral";
}

/** A phase's short name, as the Risk & Scoping summary says it. */
export const PHASE_SHORT: Record<string, string> = {
  DESIGN: "Design",
  INTERIM: "Interim",
  ROLLFORWARD: "Roll-forward",
};

/** The Risk & Scoping summary (product owner's reference, 2 November 2026): whether
 * the control is in scope and how it operates, and the phases it is tested in. */
export function scopeSummary(input: {
  included: boolean;
  nature: string;
  phases: ReadonlyArray<{ phase: string; applicability: string | null }>;
}): { scope: string; phases: string } {
  const applying = input.phases
    .filter((phase) => phase.applicability !== "NOT_APPLICABLE")
    .map((phase) => PHASE_SHORT[phase.phase] ?? phase.phase);
  return {
    scope: [input.included ? "In scope" : "Out of scope", input.nature]
      .filter((part) => part !== "")
      .join(" · "),
    phases:
      applying.length > 0 ? applying.join(", ") : "Set with the test plan",
  };
}

/** The Next action bar's button, from the tab its link opens (product owner's reference,
 * 2 November 2026: "Review evidence"). */
export function nextActionButton(href: string, title = ""): string {
  const step = /[?&]step=([a-z]+)/.exec(href)?.[1] ?? "";
  const tab = workspaceTab(step === "" ? null : step, null);
  switch (tab) {
    case "evidence":
      // Evidence to review, or evidence still to come.
      return /^review\b/i.test(title) ? "Review evidence" : "Open evidence";
    case "design":
      return "Review the plan";
    case "testing":
      return "Open testing";
    case "findings":
      return "Review findings";
    case "approvals":
      return "Open approvals";
    default:
      return "Open";
  }
}

/** How many procedures each phase holds, for the activity filters. */
export function phaseCounts(
  procedures: ReadonlyArray<{ phase: string }>,
): Array<{ phase: string; count: number }> {
  const order = ["DESIGN", "INTERIM", "ROLLFORWARD"];
  const counts = new Map<string, number>();
  for (const item of procedures) {
    counts.set(item.phase, (counts.get(item.phase) ?? 0) + 1);
  }
  // A phase the order does not know goes last.
  const rank = (phase: string) => {
    const at = order.indexOf(phase);
    return at < 0 ? order.length : at;
  };
  return [...counts.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([phase, count]) => ({ phase, count }));
}
