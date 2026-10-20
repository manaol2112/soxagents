/**
 * Roll-forward and remediation retests (Milestone 8.4): the testing rounds that follow
 * interim testing for a control. Each round has its own request, plan, and sheet; this
 * parses them and says, in one line, where each stands.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

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
    });
  }
  return rounds;
}

/** A control's rounds, latest first among the open ones, then the rest in order. */
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
