import { formatDate } from "./format.ts";

/**
 * Roll-forward and remediation retests (Milestone 8.4): the testing rounds that follow
 * interim testing for a control. Each round has its own request, plan, and sheet; this
 * parses them and says, in one line, where each stands.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What a round tests against, as recorded when it opened or was last confirmed. */
export type TestRoundBasis = {
  planRevision: number | null;
  attributes: string[];
  procedures: string[];
  source: string;
  stampedAt: string;
  backfilled: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  currentPlanRevision: number | null;
  stale: boolean;
};

export type TestRound = {
  id: string;
  controlId: string;
  controlRef: string;
  kind: "ROLLFORWARD" | "RETEST";
  number: number;
  status: "REQUESTED" | "TESTING" | "SIGNED_OFF" | "CANCELLED";
  method: "SAMPLE" | "TEST_OF_ONE";
  windowStart: string;
  windowEnd: string;
  testFrom: string;
  sampleSize: number;
  deficiencyId: string | null;
  deficiencyReference: string | null;
  requestId: string | null;
  requestStatus: string | null;
  testId: string | null;
  sheetId: string | null;
  conclusion: "EFFECTIVE" | "NOT_EFFECTIVE" | null;
  cancelReason: string;
  basis: TestRoundBasis | null;
  version: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const id = (value: unknown): string | null =>
  typeof value === "string" && UUID.test(value) ? value : null;
const day = (value: unknown): string =>
  typeof value === "string" && DATE.test(value) ? value : "";

const STATUSES = new Set(["REQUESTED", "TESTING", "SIGNED_OFF", "CANCELLED"]);

export function parseRounds(value: unknown): TestRound[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const rounds: TestRound[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      id(item.id) === null ||
      id(item.control_id) === null ||
      (item.kind !== "ROLLFORWARD" && item.kind !== "RETEST") ||
      typeof item.status !== "string" ||
      !STATUSES.has(item.status)
    ) {
      continue;
    }
    rounds.push({
      id: String(item.id),
      controlId: String(item.control_id),
      controlRef: typeof item.control_ref === "string" ? item.control_ref : "",
      kind: item.kind,
      number: typeof item.number === "number" ? item.number : 1,
      status: item.status as TestRound["status"],
      method: item.method === "TEST_OF_ONE" ? "TEST_OF_ONE" : "SAMPLE",
      windowStart: day(item.window_start),
      windowEnd: day(item.window_end),
      testFrom: day(item.test_from),
      sampleSize: typeof item.sample_size === "number" ? item.sample_size : 0,
      deficiencyId: id(item.deficiency_id),
      deficiencyReference:
        typeof item.deficiency_reference === "string"
          ? item.deficiency_reference
          : null,
      requestId: id(item.request_id),
      requestStatus:
        typeof item.request_status === "string" ? item.request_status : null,
      testId: id(item.test_id),
      sheetId: id(item.sheet_id),
      conclusion:
        item.conclusion === "EFFECTIVE" || item.conclusion === "NOT_EFFECTIVE"
          ? item.conclusion
          : null,
      cancelReason:
        typeof item.cancel_reason === "string" ? item.cancel_reason : "",
      basis: parseBasis(item.basis),
      version: typeof item.version === "number" ? item.version : 1,
    });
  }
  return rounds;
}

function parseBasis(value: unknown): TestRoundBasis | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const list = (item: unknown): string[] =>
    Array.isArray(item)
      ? item.filter((x): x is string => typeof x === "string")
      : [];
  const int = (item: unknown): number | null =>
    typeof item === "number" && Number.isInteger(item) ? item : null;
  return {
    planRevision: int(raw.plan_revision),
    attributes: list(raw.attributes),
    procedures: list(raw.procedures),
    source: typeof raw.source === "string" ? raw.source : "",
    stampedAt: typeof raw.stamped_at === "string" ? raw.stamped_at : "",
    backfilled: raw.backfilled === true,
    confirmedBy: typeof raw.confirmed_by === "string" ? raw.confirmed_by : null,
    confirmedAt: typeof raw.confirmed_at === "string" ? raw.confirmed_at : null,
    currentPlanRevision: int(raw.current_plan_revision),
    stale: raw.stale === true,
  };
}

/** The basis in one line: what the round tests against, and whether it stands. */
export function basisWords(basis: TestRoundBasis | null): string {
  if (basis === null) {
    return "No testing basis is recorded for this round.";
  }
  const revision =
    basis.planRevision === null
      ? "an unapproved plan"
      : `approved plan revision ${basis.planRevision}`;
  const counts = `${basis.attributes.length} attribute${basis.attributes.length === 1 ? "" : "s"}, ${basis.procedures.length} procedure${basis.procedures.length === 1 ? "" : "s"}`;
  const stated = basis.backfilled
    ? "RECONSTRUCTED by migration 0093 from the plan as approved when basis records were introduced, not approved as this round's basis at the time"
    : "stated when the round opened";
  const confirmed =
    basis.confirmedBy !== null
      ? `; confirmed by ${basis.confirmedBy}${basis.confirmedAt !== null ? ` on ${formatDate(basis.confirmedAt)}` : ""}`
      : "";
  const stale = basis.stale
    ? basis.backfilled && basis.confirmedBy === null
      ? " A person confirms the reconstructed basis before the samples are approved."
      : ` The test plan has since moved to revision ${basis.currentPlanRevision}: a person confirms the basis before the samples are approved.`
    : "";
  return `${revision}: ${counts}, carried from the control's approved set and ${stated}${confirmed}.${stale}`;
}

export function roundsFor(
  rounds: readonly TestRound[] | null,
  controlId: string,
): TestRound[] {
  const mine = (rounds ?? []).filter((item) => item.controlId === controlId);
  const open = (item: TestRound) =>
    item.status === "REQUESTED" || item.status === "TESTING";
  return [
    ...mine.filter(open).reverse(),
    ...mine.filter((item) => !open(item)).reverse(),
  ];
}

export function roundTitle(round: TestRound): string {
  if (round.kind === "ROLLFORWARD") {
    return round.number > 1
      ? `Roll-forward ${round.number} to period end`
      : "Roll-forward to period end";
  }
  const of =
    round.deficiencyReference !== null
      ? ` of ${round.deficiencyReference}`
      : "";
  return round.number > 1
    ? `Retest ${round.number} after remediation${of}`
    : `Retest after remediation${of}`;
}

export const ROUND_STATUS: Record<
  TestRound["status"],
  { label: string; tone: string }
> = {
  REQUESTED: { label: "Waiting for evidence", tone: "tone-info" },
  TESTING: { label: "Testing", tone: "tone-warning" },
  SIGNED_OFF: { label: "Signed off", tone: "tone-success" },
  CANCELLED: { label: "Withdrawn", tone: "" },
};

/** Where a round stands, and what happens next, in one line. */
export function roundNext(round: TestRound, today: string): string {
  if (round.status === "CANCELLED") {
    return round.cancelReason || "This round was withdrawn.";
  }
  if (round.status === "SIGNED_OFF") {
    if (round.kind === "RETEST") {
      return round.conclusion === "EFFECTIVE"
        ? `The retest passed, so ${round.deficiencyReference ?? "the deficiency"} is remediated.`
        : `The retest failed, so ${round.deficiencyReference ?? "the deficiency"} is back in remediation.`;
    }
    return round.conclusion === "EFFECTIVE"
      ? "The control operated effectively through period end."
      : "The roll-forward found exceptions. Log or dismiss the proposed deficiency.";
  }
  if (round.status === "TESTING") {
    return round.method === "TEST_OF_ONE"
      ? "The current evidence is on the test sheet. Review the results and sign off the sheet."
      : "Samples are approved. The tester tests their evidence as it arrives.";
  }
  if (round.requestId === null) {
    return "No request could be drafted: the control has no owner and the engagement no PBC coordinator.";
  }
  if (round.requestStatus === "DRAFT") {
    return "The evidence request is drafted. Submit it for approval to send it.";
  }
  if (round.requestStatus === "APPROVAL_PENDING") {
    return "The evidence request is waiting for an approver.";
  }
  if (
    round.kind === "RETEST" &&
    round.testFrom !== "" &&
    round.testFrom > today
  ) {
    return `The fixed control must operate until ${round.testFrom} before it can be retested.`;
  }
  return round.method === "TEST_OF_ONE"
    ? "Waiting for the owner's current evidence."
    : "Waiting for the owner's population; the tester proposes samples from it.";
}

/** The plan or sheet of a round, by its id. */
export function ofRound<T extends { testRoundId: string | null }>(
  items: readonly T[] | null,
  roundId: string,
): T | null {
  return (items ?? []).find((item) => item.testRoundId === roundId) ?? null;
}
