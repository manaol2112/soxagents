/**
 * The D&I evidence's release, as the D&I Evidence step's one decision (product owner, 11
 * November 2026: "premium and best UX ... simple, clear workflow"). D&I is a test of one
 * against the control's attributes, so the card shows what the release rests on (the
 * understanding, the attributes, the planned items), what will be requested and which
 * attributes each item evidences, and one action. Pure: the server's phase status decides
 * whether the release is ready (phase_release._statuses); this only words it. The approved
 * preview (11 November 2026) splits it in two: the decision row (title, reason, Release, the
 * checks inline, an early release on request) and what will be requested, in the work area,
 * each item with its kind and what it shows.
 */

import { attributeLetter } from "./control-context-model.ts";
import type { IconName } from "./icon-name.ts";
import type { PhaseStatus } from "./planning-model.ts";

export type ReleaseCheck = {
  key: "understanding" | "attributes" | "items";
  label: string;
  done: boolean;
  /** What is missing, in a sentence, when it is not done. */
  detail: string;
};

export type ReleaseItem = {
  id: string;
  title: string;
  /** The letters of the attributes it evidences, in the attributes' order. */
  tests: string[];
  optional: boolean;
  /** What kind of evidence it is, and its icon (a document for a policy, a list for a
   * walkthrough instance). */
  kind: string;
  icon: IconName;
  /** Its one secondary line: the kind, Optional when it is, and what it shows. */
  line: string;
};

export type ReleaseAttribute = { letter: string; text: string; source: string };

export type ReleaseView =
  | { mode: "hidden" }
  | {
      mode: "ready" | "early";
      title: string;
      lead: string;
      checks: ReleaseCheck[];
      items: ReleaseItem[];
      attributes: ReleaseAttribute[];
      /** Where the attributes came from, in a few words ("the control library"). */
      sources: string;
      /** What resolves an early release's wait: the step to open, with its label. */
      resolve: {
        step: "understanding" | "attributes" | "testdesign";
        label: string;
      } | null;
    };

type Attribute = { text: string; sourceKind: string };
type Item = {
  id: string;
  title: string;
  attributes: readonly string[];
  necessity: string;
  state: string;
  /** The plan's evidence categories, in the planner's order (evidence-plan-model). */
  categories?: readonly string[];
};

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

/** An item's kind: its first category the card names, else supporting evidence. */
export function itemKind(categories: readonly string[] = []): Kind {
  for (const category of categories) {
    const found = KINDS[category];
    if (found !== undefined) {
      return found;
    }
  }
  return OTHER_KIND;
}

const GONE = ["CANCELLED", "REMOVED", "NOT_APPLICABLE"];

const SOURCE_WORDS: Record<string, string> = {
  LIBRARY: "the control library",
  RCM: "the client's RCM",
  MANUAL: "the team",
  AGENT: "the agent, approved by the team",
  DOCUMENT: "supporting documents, approved by the team",
};

const SOURCE_SHORT: Record<string, string> = {
  LIBRARY: "Library",
  RCM: "Client RCM",
  MANUAL: "Team",
  AGENT: "Agent · approved",
  DOCUMENT: "Document · approved",
};

function lineOf(item: Item): Pick<ReleaseItem, "kind" | "icon" | "line"> {
  const { kind, shows, icon } = itemKind(item.categories);
  return {
    kind,
    icon,
    line: [kind, item.necessity === "OPTIONAL" ? "Optional" : "", shows]
      .filter((part) => part !== "")
      .join(" · "),
  };
}

const normal = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

function listed(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** What the D&I Evidence step's release card shows, or hidden once nothing is to release. */
export function releaseView(input: {
  status: PhaseStatus | null;
  approved: readonly Attribute[];
  /** Attribute proposals waiting for a decision. */
  proposed: number;
  /** Approved attributes without criteria a person owns, tailored to the control. */
  untailored?: number;
  items: readonly Item[];
}): ReleaseView {
  const { status } = input;
  if (
    status === null ||
    (status.step !== "READY" && status.step !== "WAITING")
  ) {
    return { mode: "hidden" };
  }
  const attributes: ReleaseAttribute[] = input.approved.map((item, at) => ({
    letter: attributeLetter(at),
    text: item.text,
    source: SOURCE_SHORT[item.sourceKind] ?? "Team",
  }));
  const letters = new Map(
    attributes.map((item) => [normal(item.text), item.letter]),
  );
  const items: ReleaseItem[] = input.items
    .filter((item) => !GONE.includes(item.state))
    .map((item) => ({
      id: item.id,
      title: item.title,
      tests: [
        ...new Set(
          item.attributes
            .map((text) => letters.get(normal(text)))
            .filter((letter): letter is string => letter !== undefined),
        ),
      ].sort((a, b) => a.length - b.length || a.localeCompare(b)),
      optional: item.necessity === "OPTIONAL",
      ...lineOf(item),
    }));
  const understood = status.waitingOn !== "UNDERSTANDING";
  // No D&I item evidences any approved attribute (12 November 2026): the evidence could
  // not be tested against them, whatever the list below shows. A real exception.
  const untraced = status.waitingOn === "EVIDENCE";
  // The server reads the attributes only once the control is understood; until then the
  // card words them from the records it holds, as the server will: approved, none proposed,
  // and each with criteria a person owns, tailored to the control.
  const settled =
    status.step === "READY" ||
    (status.waitingOn !== "ATTRIBUTES" &&
      input.approved.length > 0 &&
      input.proposed === 0 &&
      (input.untailored ?? 0) === 0);
  const checks: ReleaseCheck[] = [
    {
      key: "understanding",
      label: understood ? "Understood" : "Understanding not complete",
      done: understood,
      detail: understood ? "" : status.waitingFor,
    },
    {
      key: "attributes",
      label: settled
        ? `${plural(attributes.length, "attribute")} settled`
        : input.proposed > 0
          ? `${plural(input.proposed, "attribute")} to decide`
          : (input.untailored ?? 0) > 0
            ? `${plural(input.untailored ?? 0, "attribute")} need criteria`
            : "Attributes not settled",
      done: settled,
      detail: settled
        ? ""
        : status.waitingOn === "ATTRIBUTES"
          ? status.waitingFor
          : "Decide the control's attributes: the D&I evidence is tested against them.",
    },
    {
      key: "items",
      label:
        items.length === 0
          ? "No evidence planned"
          : untraced
            ? "No item evidences the attributes"
            : `${plural(items.length, "item")} planned`,
      done: items.length > 0 && !untraced,
      detail:
        items.length === 0
          ? "The planner has not planned D&I evidence yet."
          : untraced
            ? status.waitingFor
            : "",
    },
  ];
  const sources = listed([
    ...new Set(
      input.approved.map((item) => SOURCE_WORDS[item.sourceKind] ?? "the team"),
    ),
  ]);
  if (status.step === "READY") {
    return {
      mode: "ready",
      title: "Release the D&I evidence",
      lead: `${plural(items.length, "request")} will be drafted for approval, tested against ${plural(attributes.length, "attribute")}. Nothing goes to the client until each request is approved.`,
      checks,
      items,
      attributes,
      sources,
      resolve: null,
    };
  }
  if (untraced) {
    return {
      mode: "early",
      title: "Plan the evidence against the attributes first",
      lead:
        (status.waitingFor !== "" ? `${status.waitingFor} ` : "") +
        "The D&I evidence is a test of one against the attributes, so a walkthrough instance that evidences none of them cannot be tested. You can release it early, with a reason.",
      checks,
      items,
      attributes,
      sources,
      resolve: { step: "testdesign", label: "Open the test plan" },
    };
  }
  return {
    mode: "early",
    title: understood
      ? "Settle the attributes first"
      : "Complete Control Understanding first",
    lead:
      (status.waitingFor !== "" ? `${status.waitingFor} ` : "") +
      (understood
        ? "The D&I evidence is tested against the attributes, so its release waits for them."
        : "The D&I evidence is planned from the understanding, so its release waits for it.") +
      " You can release it early, with a reason.",
    checks,
    items,
    attributes,
    sources,
    resolve: understood
      ? { step: "attributes", label: "Decide the attributes" }
      : { step: "understanding", label: "Open Control Understanding" },
  };
}

/**
 * Whether the step shows the evidence workspace (its list, tabs and detail). On D&I Evidence,
 * before the release, the decision row's "Will be requested" list already shows each request
 * to be drafted, so the workspace would list the same requests a second time (product owner,
 * 12 November 2026: "I don't want duplications here"). It shows once the release has drafted
 * them. Adding evidence then loses nothing: a request still waits for approval before
 * anything goes to the client. Every other step shows it as before.
 */
export function showsEvidenceWorkspace(
  step: string | null,
  view: ReleaseView,
): boolean {
  return step !== "designevidence" || view.mode === "hidden";
}

/** The shortest reason an early release takes (phase_release.release). */
export const EARLY_REASON_MIN = 20;

/** A check as the decision row shows it: a success check when done, an open circle when
 * not, and the words a screen reader hears (the mark never replaces them). */
export function checkMark(check: Pick<ReleaseCheck, "label" | "done">): {
  mark: "done" | "open";
  spoken: string;
} {
  return check.done
    ? { mark: "done", spoken: `${check.label}, done` }
    : { mark: "open", spoken: `${check.label}, not done` };
}

/** The "Will be requested" section's title, and who the requests go to, when known. */
export function itemsHeading(
  view: Extract<ReleaseView, { mode: "ready" | "early" }>,
  owner: string,
): { title: string; note: string } {
  const who = owner.trim();
  return {
    title: view.mode === "ready" ? "Will be requested" : "Planned",
    note: who === "" ? "" : `Requested from ${who}`,
  };
}

/**
 * The early release, a quiet row in the decision's detail (product owner, 11 November
 * 2026): offered only while the release waits and the person may release; it opens the
 * reason, and Release early is enabled once the reason is long enough and nothing is
 * pending. The server still checks the reason (phase_release.release).
 */
export function earlyRelease(input: {
  mode: ReleaseView["mode"];
  canRelease: boolean;
  reason: string;
  pending: boolean;
}): {
  offered: boolean;
  summary: string;
  line: string;
  left: number;
  hint: string;
  enabled: boolean;
} {
  const left = Math.max(0, EARLY_REASON_MIN - input.reason.trim().length);
  return {
    offered: input.mode === "early" && input.canRelease,
    summary: "Release early instead",
    line: "Only with a recorded reason",
    left,
    hint:
      left > 0
        ? `Recorded with the release. At least ${left} more character${left === 1 ? "" : "s"}.`
        : "Recorded with the release.",
    enabled: left === 0 && !input.pending,
  };
}
