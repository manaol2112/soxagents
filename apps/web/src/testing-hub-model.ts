/**
 * The Testing destination (Milestone 2b): one place to manage testing across the
 * engagement's controls, in four views. Plans (the planning review queue) and Phases
 * (release by phase) reuse the Test plans page's own components; Results and Review read
 * the register rows, test sheets, rounds, reviews and the one queue the guided control
 * workspace reads, and open that workspace for the detail. Nothing here decides a state
 * or whose a step is: the API says, this groups and links.
 */
import type { ControlRow } from "./engagement-model.ts";
import type { Automation } from "./execution-model.ts";
import { ownerWords, type Queue, type QueueItem } from "./queue-model.ts";
import type { ControlReview } from "./review-model.ts";
import type { TestRound } from "./round-model.ts";
import { sheetHeadline, type TestSheet } from "./sheet-model.ts";

export const TESTING_VIEWS = ["plans", "phases", "results", "review"] as const;
export type TestingView = (typeof TESTING_VIEWS)[number];

export const VIEW_LABELS: Record<TestingView, string> = {
  plans: "Plans",
  phases: "Phases",
  results: "Results",
  review: "Review",
};

export const VIEW_NOTES: Record<TestingView, string> = {
  plans: "Each control's master test plan, reviewed and approved by a person.",
  phases:
    "Release the interim and roll-forward phases once their plans are approved.",
  results:
    "Where each control's testing stands, with its result and the step that moves it.",
  review: "The independent reviews: their notes, re-performance and sign-off.",
};

/** Planning's own tabs: the plans and their release by phase. The prior year's work is
 * with the scope on Systems & Processes (decided by the product owner on 26 October). */
export const PLANNING_TABS = ["plans", "phases"] as const;
export type PlanningTab = (typeof PLANNING_TABS)[number];
export const PLANNING_TAB_LABELS: Record<PlanningTab, string> = {
  plans: "Plans",
  phases: "Phases",
};

export function parsePlanningTab(
  value: string | null | undefined,
): PlanningTab {
  return value === "phases" ? value : "plans";
}

export function planningTabHref(
  organizationId: string,
  projectId: string,
  tab: PlanningTab,
): string {
  const params = new URLSearchParams({
    organization: organizationId,
    project: projectId,
    section: "planning",
  });
  if (tab !== "plans") {
    params.set("view", tab);
  }
  return `/?${params.toString()}`;
}

export function parseTestingView(
  value: string | null | undefined,
): TestingView {
  return (TESTING_VIEWS as readonly string[]).includes(value ?? "")
    ? (value as TestingView)
    : "plans";
}

/** The Testing destination's address for a view, with any further query. */
export function testingHref(
  organizationId: string,
  projectId: string,
  view: TestingView,
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams({
    organization: organizationId,
    project: projectId,
    // Each view is now its destination's (25 October 2026): the plans and phases are
    // Planning's, the results Testing's, the reviews Review's.
    section:
      view === "plans" || view === "phases"
        ? "planning"
        : view === "review"
          ? "review"
          : "testing",
  });
  if (view === "phases") {
    params.set("view", view);
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== "") {
      params.set(key, value);
    }
  }
  return `/?${params.toString()}`;
}

/** The guided control workspace, opened on a step. */
export function controlStepHref(
  organizationId: string,
  projectId: string,
  controlId: string,
  step: string,
): string {
  const params = new URLSearchParams({
    organization: organizationId,
    project: projectId,
    section: "controls",
    control: controlId,
    step,
  });
  return `/?${params.toString()}`;
}

// Results

export type ResultState =
  | "NOT_STARTED"
  | "BLOCKED"
  | "SAMPLES"
  | "TESTING"
  | "STOPPED"
  | "TO_DECIDE"
  | "TO_SIGN"
  | "SIGNED_OFF";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export type ResultRow = {
  controlId: string;
  controlRef: string;
  label: string;
  application: string;
  /** The phase the testing is about: the open round's kind, else the step's phase. */
  phase: string;
  state: ResultState;
  stateLabel: string;
  tone: Tone;
  result: "NOT_CONCLUDED" | "EFFECTIVE" | "EXCEPTION";
  exceptions: number;
  final: boolean;
  /** The control's next step, whose it is, and whether it is the viewer's. */
  next: string;
  actor: string;
  yours: boolean;
  href: string;
};

const PHASE_WORDS: Record<string, string> = {
  DESIGN: "Design & implementation",
  INTERIM: "Interim",
  ROLLFORWARD: "Roll-forward",
  REMEDIATION: "Remediation",
  RETEST: "Retest",
};

export function phaseWords(phase: string | null): string {
  return phase === null ? "" : (PHASE_WORDS[phase] ?? phase);
}

const STEP_SECTIONS: Record<string, string> = {
  PLAN: "plan",
  REQUEST: "request",
  TEST: "test",
  CONCLUDE: "conclude",
  REVIEW: "review",
  DONE: "review",
};

/** The sheet the control's testing stands on: the open one, else the latest. */
export function sheetOf(
  sheets: readonly TestSheet[],
  controlId: string,
): TestSheet | null {
  const own = sheets.filter((sheet) => sheet.controlId === controlId);
  return own.find((sheet) => sheet.status === "OPEN") ?? own.at(-1) ?? null;
}

/** The control's open round, when one is open. */
export function openRoundOf(
  rounds: readonly TestRound[],
  controlId: string,
): TestRound | null {
  return (
    rounds.find(
      (round) =>
        round.controlId === controlId &&
        (round.status === "REQUESTED" || round.status === "TESTING"),
    ) ?? null
  );
}

function stateOf(
  control: ControlRow,
  sheet: TestSheet | null,
  automation: Automation | null,
): { state: ResultState; label: string; tone: Tone } {
  if (sheet !== null) {
    const headline = sheetHeadline(sheet, automation);
    if (sheet.status === "SIGNED_OFF") {
      return {
        state: "SIGNED_OFF",
        label: headline.label,
        tone: headline.tone,
      };
    }
    if (!sheet.running && sheet.runNote !== "") {
      return { state: "STOPPED", label: headline.label, tone: headline.tone };
    }
    if (sheet.running) {
      return { state: "TESTING", label: headline.label, tone: headline.tone };
    }
    if (sheet.counts.review > 0) {
      return {
        state: "TO_DECIDE",
        label: `${sheet.counts.review} result${sheet.counts.review === 1 ? "" : "s"} to decide`,
        tone: "warning",
      };
    }
    if (sheet.proposedConclusion !== "INCOMPLETE") {
      return { state: "TO_SIGN", label: headline.label, tone: headline.tone };
    }
    return { state: "TESTING", label: headline.label, tone: headline.tone };
  }
  if (control.testStatus === "PROPOSED") {
    return { state: "SAMPLES", label: "Samples proposed", tone: "info" };
  }
  if (control.readinessState !== "READY" && control.readinessLabel !== "") {
    return { state: "BLOCKED", label: control.readinessLabel, tone: "neutral" };
  }
  return { state: "NOT_STARTED", label: "Not started", tone: "neutral" };
}

export function resultRows(input: {
  controls: readonly ControlRow[] | null;
  sheets: readonly TestSheet[] | null;
  rounds: readonly TestRound[] | null;
  automation: Automation | null;
  organizationId: string;
  projectId: string;
}): ResultRow[] {
  const sheets = input.sheets ?? [];
  const rounds = input.rounds ?? [];
  return (input.controls ?? [])
    .filter((control) => control.included)
    .map((control) => {
      const round = openRoundOf(rounds, control.id);
      const sheet =
        round !== null && round.sheetId !== null
          ? (sheets.find((item) => item.id === round.sheetId) ??
            sheetOf(sheets, control.id))
          : sheetOf(sheets, control.id);
      const journey = control.journey ?? null;
      const { state, label, tone } = stateOf(control, sheet, input.automation);
      // The phase of the record shown: the sheet's round (else the interim sheet), or
      // the open round awaiting its testing; never the control's current journey step,
      // which may be about another phase's obligation.
      const sheetRoundId = sheet?.testRoundId ?? null;
      const sheetRound =
        sheetRoundId === null
          ? null
          : (rounds.find((item) => item.id === sheetRoundId) ?? null);
      const phase =
        sheet !== null
          ? (sheetRound?.kind ?? "INTERIM")
          : (round?.kind ?? "INTERIM");
      const step =
        journey !== null
          ? (STEP_SECTIONS[journey.step] ?? "test")
          : state === "SIGNED_OFF"
            ? "conclude"
            : "test";
      return {
        controlId: control.id,
        controlRef: control.controlRef,
        label: control.label,
        application: control.applicationName,
        phase,
        state,
        stateLabel: label,
        tone,
        result: control.conclusion,
        exceptions: sheet?.counts.exceptions ?? 0,
        final: control.final ?? false,
        next: control.nextStep,
        actor: control.actor,
        yours: control.yours,
        href: controlStepHref(
          input.organizationId,
          input.projectId,
          control.id,
          step,
        ),
      };
    });
}

export const RESULT_FILTERS = [
  "all",
  "ready",
  "testing",
  "decide",
  "signed",
  "exceptions",
  "mine",
] as const;
export type ResultFilter = (typeof RESULT_FILTERS)[number];

export const RESULT_FILTER_LABELS: Record<ResultFilter, string> = {
  all: "All",
  ready: "To start",
  testing: "Testing",
  decide: "To decide or sign off",
  signed: "Signed off",
  exceptions: "Exceptions",
  mine: "Mine",
};

export function parseResultFilter(
  value: string | null | undefined,
): ResultFilter {
  return (RESULT_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as ResultFilter)
    : "all";
}

export function filterResults(
  rows: readonly ResultRow[],
  filter: ResultFilter,
  search = "",
): ResultRow[] {
  const words = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (
      words !== "" &&
      !`${row.controlRef} ${row.label} ${row.application}`
        .toLowerCase()
        .includes(words)
    ) {
      return false;
    }
    switch (filter) {
      case "ready":
        return (
          row.state === "NOT_STARTED" ||
          row.state === "SAMPLES" ||
          row.state === "BLOCKED"
        );
      case "testing":
        return row.state === "TESTING" || row.state === "STOPPED";
      case "decide":
        return row.state === "TO_DECIDE" || row.state === "TO_SIGN";
      case "signed":
        return row.state === "SIGNED_OFF";
      case "exceptions":
        return row.exceptions > 0 || row.result === "EXCEPTION";
      case "mine":
        return row.yours;
      default:
        return true;
    }
  });
}

export function resultCounts(
  rows: readonly ResultRow[],
): Record<ResultFilter, number> {
  const counts = {} as Record<ResultFilter, number>;
  for (const filter of RESULT_FILTERS) {
    counts[filter] = filterResults(rows, filter).length;
  }
  return counts;
}

const ACTOR_WORDS: Record<string, string> = {
  PREPARER: "the preparer",
  APPROVER: "an approver",
  REVIEWER: "the independent reviewer",
  CLIENT: "the control owner",
  AGENT: "an agent",
  NONE: "no one",
};

/** "Yours" or "Waits on the preparer". */
export function nextWords(row: Pick<ResultRow, "actor" | "yours">): string {
  if (row.yours) {
    return "Yours";
  }
  return `Waits on ${ACTOR_WORDS[row.actor] ?? row.actor.toLowerCase()}`;
}

// Review

export type ReviewRow = {
  reviewId: string;
  controlId: string;
  controlRef: string;
  label: string;
  round: string | null;
  status: "OPEN" | "SIGNED_OFF";
  stage: string;
  tone: Tone;
  openNotes: number;
  /** The queue's own item on this review, when it has one: the action and whose it is. */
  next: string;
  owner: string;
  mine: boolean;
  signedBy: string | null;
  signedAt: string | null;
  href: string;
};

function reviewStage(review: ControlReview): { stage: string; tone: Tone } {
  if (review.status === "SIGNED_OFF") {
    return { stage: "Signed off", tone: "success" };
  }
  if (review.reperforming) {
    return {
      stage:
        review.reperformState === "RUNNING"
          ? "Re-performing"
          : "Re-performance queued",
      tone: "info",
    };
  }
  if (review.reperformedAt === null && review.reperformNote !== "") {
    return { stage: "Re-performance stopped", tone: "warning" };
  }
  if (review.reperformedAt === null) {
    return { stage: "Not re-performed", tone: "neutral" };
  }
  const proposed = review.notes.filter((note) => note.status === "PROPOSED");
  const open = review.notes.filter((note) => note.status === "OPEN");
  const responded = review.notes.filter((note) => note.status === "RESPONDED");
  if (proposed.length > 0) {
    return { stage: `${proposed.length} proposed to decide`, tone: "warning" };
  }
  if (open.length > 0) {
    return { stage: `${open.length} to answer`, tone: "warning" };
  }
  if (responded.length > 0) {
    return { stage: `${responded.length} answered to clear`, tone: "info" };
  }
  return { stage: "Ready to sign off", tone: "success" };
}

/** The queue's item on a review: the review's own, or the coverage assessment of a
 * signed-off one. */
export function queueItemFor(
  queue: Queue | null,
  review: Pick<ControlReview, "id">,
): QueueItem | null {
  return (
    (queue?.items ?? []).find(
      (item) =>
        (item.kind === "review" || item.kind === "coverage") &&
        item.source.id === review.id,
    ) ?? null
  );
}

export function reviewRows(input: {
  reviews: readonly ControlReview[] | null;
  queue: Queue | null;
  organizationId: string;
  projectId: string;
}): ReviewRow[] {
  const rows = (input.reviews ?? []).map((review): ReviewRow => {
    const { stage, tone } = reviewStage(review);
    const item = queueItemFor(input.queue, review);
    return {
      reviewId: review.id,
      controlId: review.controlId,
      controlRef: review.controlRef,
      label: review.label,
      round: review.roundKind ?? null,
      status: review.status,
      stage,
      tone,
      openNotes: review.notes.filter((note) => note.status !== "CLEARED")
        .length,
      next: item?.title ?? "",
      owner: item === null ? "" : ownerWords(item),
      mine: item?.bucket === "MINE",
      signedBy: review.signedBy,
      signedAt: review.signedAt,
      href: controlStepHref(
        input.organizationId,
        input.projectId,
        review.controlId,
        "review",
      ),
    };
  });
  // Open reviews first, the viewer's own before the rest; then signed-off ones.
  return rows.sort(
    (a, b) =>
      Number(a.status === "SIGNED_OFF") - Number(b.status === "SIGNED_OFF") ||
      Number(b.mine) - Number(a.mine) ||
      a.controlRef.localeCompare(b.controlRef),
  );
}

export const REVIEW_FILTERS = ["open", "mine", "signed", "all"] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

export const REVIEW_FILTER_LABELS: Record<ReviewFilter, string> = {
  open: "Open",
  mine: "Mine",
  signed: "Signed off",
  all: "All",
};

export function parseReviewFilter(
  value: string | null | undefined,
): ReviewFilter {
  return (REVIEW_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as ReviewFilter)
    : "open";
}

export function filterReviews(
  rows: readonly ReviewRow[],
  filter: ReviewFilter,
  search = "",
): ReviewRow[] {
  const words = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (
      words !== "" &&
      !`${row.controlRef} ${row.label}`.toLowerCase().includes(words)
    ) {
      return false;
    }
    switch (filter) {
      case "open":
        return row.status === "OPEN" || row.next !== "";
      case "mine":
        return row.mine;
      case "signed":
        return row.status === "SIGNED_OFF";
      default:
        return true;
    }
  });
}

/** The figures the destination's tabs carry. */
export function testingCounts(input: {
  results: readonly ResultRow[];
  reviews: readonly ReviewRow[];
}): { results: number; review: number } {
  return {
    results: input.results.filter((row) => row.state !== "SIGNED_OFF").length,
    review: input.reviews.filter(
      (row) => row.status === "OPEN" || row.next !== "",
    ).length,
  };
}
