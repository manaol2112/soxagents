/** Right after launch, the five foundations of the engagement's scope (the product owner's
 * reference, 27 October 2026): what each holds now, read from the records, and where it is
 * set up. */

import { controlsSetupState } from "./controls-guide-model.ts";
import type { Onboarding } from "./onboarding-model.ts";
import {
  POLICY_KINDS,
  type Policy,
  type PriorYearReference,
} from "./references-model.ts";

export type FoundationStatus = "NOT_STARTED" | "IN_PROGRESS" | "DONE";

export const FOUNDATION_STATUS_LABEL: Record<FoundationStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

export type Foundation = {
  key: "systems" | "processes" | "controls" | "prior-year" | "policies";
  title: string;
  detail: string;
  icon: "database" | "flow" | "shield" | "file" | "book";
  status: FoundationStatus;
  /** Where it is set up: a Systems & Processes tab, or the Controls page. */
  target:
    | {
        section: "controls";
        pane: "systems" | "processes" | "references" | "policies";
      }
    | { section: "register" };
};

export type LaunchChecklist = {
  foundations: Foundation[];
  done: number;
  /** The first foundation not done, in the recommended order; null when all are. */
  next: Foundation | null;
};

/** The five foundations in the recommended order: systems, then the processes and
 * controls on them, then the prior year's workpapers and the policies for context. */
export function launchChecklist(
  onboarding: Onboarding,
  references: {
    policies: readonly Policy[];
    priorYear: readonly PriorYearReference[];
  },
): LaunchChecklist {
  const state = controlsSetupState(onboarding);
  const policies = references.policies.filter((item) =>
    POLICY_KINDS.includes(item.kind),
  );
  const reading = references.priorYear.some(
    (item) => item.runStatus === "PENDING" || item.runStatus === "WORKING",
  );
  const status = (count: number, busy = false): FoundationStatus =>
    count === 0 ? "NOT_STARTED" : busy ? "IN_PROGRESS" : "DONE";
  const foundations: Foundation[] = [
    {
      key: "systems",
      title: "Systems",
      detail: "Add in-scope applications, infrastructure, and owners",
      icon: "database",
      // A system with the agent's recommendation waiting is still being set up.
      status: status(state.systems.length, state.toReview > 0),
      target: { section: "controls", pane: "systems" },
    },
    {
      key: "processes",
      title: "Processes",
      detail: "Map business processes and link supporting systems",
      icon: "flow",
      status: status(state.processes),
      target: { section: "controls", pane: "processes" },
    },
    {
      key: "controls",
      title: "Controls",
      detail: "Build or import your risk and control inventory",
      icon: "shield",
      status: status(state.controls),
      target: { section: "register" },
    },
    {
      key: "prior-year",
      title: "Prior-year workpapers",
      detail: "Upload prior-year evidence and testing documentation",
      icon: "file",
      // Still being read by the agent until its run settles.
      status: status(references.priorYear.length, reading),
      target: { section: "controls", pane: "references" },
    },
    {
      key: "policies",
      title: "Policies",
      detail: "Centralize relevant policies and procedures",
      icon: "book",
      status: status(policies.length),
      target: { section: "controls", pane: "policies" },
    },
  ];
  return {
    foundations,
    done: foundations.filter((item) => item.status === "DONE").length,
    next: foundations.find((item) => item.status !== "DONE") ?? null,
  };
}
