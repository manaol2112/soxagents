// A deficiency's remediation history (Step 5): the lifecycle from the original failed
// test to the closed deficiency, read from the records the engagement already holds (the
// deficiency, its control's sheets, rounds and reviews). Nothing is inferred: a step is
// done only when a record says so, and the original failure stays beside the retest.

import type { Deficiency } from "./engagement-model.ts";
import type { ControlReview } from "./review-model.ts";
import type { TestRound } from "./round-model.ts";
import type { TestSheet } from "./sheet-model.ts";

export type HistoryStep = {
  key:
    | "failed"
    | "logged"
    | "response"
    | "remediated"
    | "evidence"
    | "retested"
    | "reviewed"
    | "closed";
  title: string;
  /** What the records say, or what is still to come. */
  detail: string;
  state: "done" | "failed" | "pending";
  /** Where to see it, when the page exists. */
  href: string | null;
};

export type TestComparison = {
  label: string;
  result: "EFFECTIVE" | "NOT_EFFECTIVE" | "NOT_CONCLUDED";
  items: number;
  exceptions: number;
  signedBy: string | null;
  signedAt: string | null;
  reviewed: boolean;
  href: string | null;
};

export type RemediationHistory = {
  steps: HistoryStep[];
  original: TestComparison | null;
  retest: TestComparison | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}/;

function day(value: string | null): string {
  if (value === null || !DATE.test(value)) {
    return "";
  }
  return value.slice(0, 10);
}

function words(status: string): string {
  return status.replace(/_/g, " ").toLowerCase();
}

/** The control page's address at a step, or null without a control. */
export function controlStepHref(
  organizationId: string,
  projectId: string,
  controlId: string | null,
  step: "plan" | "request" | "test" | "conclude" | "review",
): string | null {
  if (controlId === null) {
    return null;
  }
  const params = new URLSearchParams({
    organization: organizationId,
    project: projectId,
    section: "controls",
    control: controlId,
    step,
  });
  return `/?${params}`;
}

function comparison(
  label: string,
  sheet: TestSheet | null,
  round: TestRound | null,
  reviews: ControlReview[],
  href: string | null,
): TestComparison | null {
  if (sheet === null && round === null) {
    return null;
  }
  const result =
    sheet?.conclusion ?? round?.conclusion ?? ("NOT_CONCLUDED" as const);
  const reviewed = reviews.some(
    (review) =>
      review.status === "SIGNED_OFF" &&
      (round === null
        ? (review.testRoundId ?? null) === null
        : review.testRoundId === round.id),
  );
  return {
    label,
    result,
    items: sheet?.counts.items ?? round?.sampleSize ?? 0,
    exceptions: sheet?.counts.exceptions ?? 0,
    signedBy: sheet?.signedBy ?? null,
    signedAt: sheet?.signedAt ?? null,
    reviewed,
    href,
  };
}

/**
 * The history of one deficiency from its control's records. The original test is the
 * control's interim sheet; the retest is the round the deficiency opened (the latest
 * when there are several). Each step is done, failed (the original test), or pending.
 */
export function remediationHistory(
  item: Deficiency,
  records: {
    sheets: TestSheet[] | null;
    rounds: TestRound[] | null;
    reviews: ControlReview[] | null;
  },
  ids: { organizationId: string; projectId: string },
): RemediationHistory {
  const controlId = item.controlId;
  const sheets = (records.sheets ?? []).filter(
    (sheet) => sheet.controlId === controlId,
  );
  const rounds = (records.rounds ?? []).filter(
    (round) => round.deficiencyId === item.id && round.status !== "CANCELLED",
  );
  const reviews = (records.reviews ?? []).filter(
    (review) => review.controlId === controlId,
  );
  const roundIds = new Set(
    (records.rounds ?? [])
      .filter((round) => round.controlId === controlId)
      .map((round) => round.sheetId)
      .filter((sheetId): sheetId is string => sheetId !== null),
  );
  const interim =
    sheets.find(
      (sheet) => !roundIds.has(sheet.id) && sheet.status === "SIGNED_OFF",
    ) ??
    sheets.find((sheet) => !roundIds.has(sheet.id)) ??
    null;
  const retestRound =
    rounds
      .filter((round) => round.kind === "RETEST")
      .sort((a, b) => b.number - a.number)[0] ?? null;
  const retestSheet =
    retestRound?.sheetId !== null && retestRound !== null
      ? (sheets.find((sheet) => sheet.id === retestRound.sheetId) ?? null)
      : null;
  const testHref = controlStepHref(
    ids.organizationId,
    ids.projectId,
    controlId,
    "test",
  );
  const reviewHref = controlStepHref(
    ids.organizationId,
    ids.projectId,
    controlId,
    "review",
  );
  const closed = item.status === "CLOSED";
  const remediated =
    item.remediatedOn !== null ||
    ["READY_FOR_RETEST", "REMEDIATED", "CLOSED"].includes(item.status);
  const retestDone = retestRound?.status === "SIGNED_OFF";
  const retestReviewed =
    retestRound !== null &&
    reviews.some(
      (review) =>
        review.status === "SIGNED_OFF" && review.testRoundId === retestRound.id,
    );
  const steps: HistoryStep[] = [
    {
      key: "failed",
      title: "Original test failed",
      detail:
        interim === null
          ? "No interim test sheet is on record for this control."
          : interim.conclusion === "NOT_EFFECTIVE"
            ? `${interim.counts.exceptions} of ${interim.counts.items} items tested with exceptions; signed off${interim.signedBy ? ` by ${interim.signedBy}` : ""}${day(interim.signedAt) ? ` on ${day(interim.signedAt)}` : ""}.`
            : `The interim test concluded ${words(interim.conclusion ?? "NOT_CONCLUDED")}.`,
      state:
        interim?.conclusion === "NOT_EFFECTIVE"
          ? "failed"
          : interim
            ? "done"
            : "pending",
      href: testHref,
    },
    {
      key: "logged",
      title: "Deficiency logged",
      detail: `${item.reference}, ${words(item.severity)}, identified by ${item.identifiedBy || "the team"} on ${day(item.identifiedAt) || "a date not recorded"}.`,
      state: "done",
      href: null,
    },
    {
      key: "response",
      title: "Management response",
      detail:
        item.remediationPlan !== ""
          ? `${item.remediationOwner || "Owner not recorded"}: ${item.remediationPlan}${item.remediationDue ? ` Due ${day(item.remediationDue)}.` : ""}`
          : "No remediation plan is recorded yet.",
      state: item.remediationPlan !== "" ? "done" : "pending",
      href: null,
    },
    {
      key: "remediated",
      title: "Remediation in effect",
      detail:
        item.remediatedOn !== null
          ? `The fix took effect on ${day(item.remediatedOn)}.`
          : remediated
            ? "Marked ready for retest; the date the fix took effect is not recorded."
            : "The fix has not been recorded as in effect.",
      state: remediated ? "done" : "pending",
      href: null,
    },
    {
      key: "evidence",
      title: "New evidence received",
      detail:
        retestRound === null
          ? "No retest round is open yet."
          : retestRound.requestStatus === null
            ? "The retest's evidence request is not on record."
            : `Retest ${retestRound.number} evidence request: ${words(retestRound.requestStatus)}; window ${retestRound.windowStart} to ${retestRound.windowEnd}.`,
      state:
        retestRound !== null &&
        ["RECEIVED", "PARTIALLY_RECEIVED", "CLOSED"].includes(
          retestRound.requestStatus ?? "",
        )
          ? "done"
          : "pending",
      href: testHref,
    },
    {
      key: "retested",
      title: "Retested",
      detail:
        retestRound === null
          ? "The retest has not started."
          : retestDone
            ? `Retest ${retestRound.number} concluded ${words(retestRound.conclusion ?? retestSheet?.conclusion ?? "NOT_CONCLUDED")}${retestSheet?.signedBy ? `, signed off by ${retestSheet.signedBy}` : ""}${day(retestSheet?.signedAt ?? null) ? ` on ${day(retestSheet?.signedAt ?? null)}` : ""}.`
            : `Retest ${retestRound.number} is ${words(retestRound.status)}.`,
      state: retestDone ? "done" : "pending",
      href: testHref,
    },
    {
      key: "reviewed",
      title: "Independent review of the retest",
      detail: retestReviewed
        ? "The engagement reviewer signed off the retest."
        : retestDone
          ? "The retest awaits the independent reviewer."
          : "Follows the retest.",
      state: retestReviewed ? "done" : "pending",
      href: reviewHref,
    },
    {
      key: "closed",
      title: closed ? "Deficiency closed" : "Closure",
      detail: closed
        ? `Closed on ${day(item.closedAt) || "a date not recorded"}, approved by the engagement reviewer.`
        : item.pending?.kind === "CLOSE"
          ? "Closure requested; the engagement reviewer decides."
          : `Status: ${words(item.status)}.`,
      state: closed ? "done" : "pending",
      href: null,
    },
  ];
  return {
    steps,
    original: comparison(
      "Original test (interim)",
      interim,
      null,
      reviews,
      testHref,
    ),
    retest: comparison(
      retestRound === null ? "Retest" : `Retest ${retestRound.number}`,
      retestSheet,
      retestRound,
      reviews,
      testHref,
    ),
  };
}
