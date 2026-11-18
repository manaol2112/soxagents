/**
 * What the D&I Evidence step shows of its evidence: the kind of each item, and whether the
 * evidence workspace is on the page.
 *
 * The step's one list is the D&I requests list (design-requests-model; product owner, 12
 * November 2026: "Why do I need to have the release button? Simplify the workflow."). The
 * release card this module used to word (11 November 2026: its checks, its "Will be
 * requested" list and the early release with a reason) is gone with the button: the server
 * releases the phase once the list is settled, and an early D&I release is refused.
 */

import type { IconName } from "./icon-name.ts";

type Kind = { kind: string; shows: string; icon: IconName };

/** What each kind of D&I evidence is and what it shows, by the plan's category (the
 * planner asks for a policy and one instance traced end to end, or a configured setting). */
const KINDS: Readonly<Record<string, Kind>> = {
  PROCESS_DOCUMENTATION: {
    kind: "Policy or procedure",
    shows: "how the control is meant to work",
    icon: "file",
  },
  CONTROL_EXECUTION: {
    kind: "Walkthrough instance",
    shows: "one instance, start to finish",
    icon: "list",
  },
  CONFIGURATION: {
    kind: "Configuration",
    shows: "the setting as designed",
    icon: "wrench",
  },
  REPORT_RELIABILITY: {
    kind: "Report",
    shows: "its logic, sources and parameters",
    icon: "chart",
  },
  POPULATION: {
    kind: "Population",
    shows: "the full list it is drawn from",
    icon: "table",
  },
  SAMPLE: { kind: "Sample", shows: "the items selected", icon: "list" },
  CHANGE_HISTORY: {
    kind: "Change history",
    shows: "changes to the control",
    icon: "clock",
  },
};

const OTHER_KIND: Kind = {
  kind: "Supporting evidence",
  shows: "",
  icon: "file",
};

/** An item's kind: its first category the list names, else supporting evidence. */
export function itemKind(categories: readonly string[] = []): Kind {
  for (const category of categories) {
    const found = KINDS[category];
    if (found !== undefined) {
      return found;
    }
  }
  return OTHER_KIND;
}

/**
 * Whether the step shows the evidence workspace (its list, tabs and detail). On D&I Evidence,
 * before the requests are drafted, the requests list already shows each request, so the
 * workspace would list the same requests a second time (product owner, 12 November 2026:
 * "I don't want duplications here"). It shows once the list is hidden: the release has
 * drafted them. Adding evidence then loses nothing: a request still waits for approval
 * before anything goes to the client. Every other step shows it as before.
 */
export function showsEvidenceWorkspace(
  step: string | null,
  view: { mode: string },
): boolean {
  return step !== "designevidence" || view.mode === "hidden";
}
