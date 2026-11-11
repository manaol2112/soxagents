/**
 * The control workspace's tabs (product owner's reference, 2 November 2026): one row of
 * tabs under the steps, which show progress and open the tab that holds each step's
 * work. Pure: the tab an address opens, each attribute's evidence state, and the lines
 * the Overview shows, all read from the records the page already holds.
 */

import type { Step } from "./control-journey-model.ts";

export type WorkspaceTab =
  | "flow"
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
    | "flow"
    | "file"
    | "risk"
    | "layers"
    | "chart"
    | "inbox"
    | "target"
    | "shield"
    | "clock";
}> = [
  // The Flow view leads (product owner, 8 November 2026): the control's work as a chain.
  { key: "flow", label: "Flow", icon: "flow" },
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

/** A phase's short name, as the Risk & Scoping summary says it. */
export const PHASE_SHORT: Record<string, string> = {
  DESIGN: "Design",
  INTERIM: "Interim",
  ROLLFORWARD: "Roll-forward",
};
