/** Test plans and sample selection (Milestone 8.1). */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREDENTIAL =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|private[_-]?key)\s*[:=]\s*\S{8,}|password\s*[:=]\s*(?=\S*[0-9])(?=\S*[A-Za-z])\S{6,}|(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/i;

export type PopulationCheck = {
  check: string;
  result: "OK" | "ISSUE" | "INFO";
  detail: string;
};

export type Sample = {
  position: number;
  rowNumber: number;
  keyValue: string;
  rowValues: string[];
  selection: "RANDOM" | "HAPHAZARD" | "TARGETED";
  reason: string;
  replacedBy: string | null;
};

export type ControlTest = {
  id: string;
  controlId: string;
  controlRef: string;
  status: "PROPOSED" | "APPROVED";
  sampleSize: number;
  populationFileId: string;
  populationFileName: string;
  populationSha256: string;
  populationRows: number;
  frameRows: number;
  keyColumn: string;
  dateColumn: string;
  columns: string[];
  checks: PopulationCheck[];
  seed: string;
  explanation: string;
  approvedBy: string | null;
  approvedAt: string | null;
  sampleRequestId: string | null;
  sampleRequestStatus: string | null;
  samples: Sample[];
  version: number;
  /** The roll-forward or retest round this plan is for; null for interim testing. */
  testRoundId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function maybe(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function oneOf<T extends string>(
  value: unknown,
  options: readonly T[],
): T | null {
  return options.find((option) => option === value) ?? null;
}

export function parseTests(value: unknown): ControlTest[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const tests: ControlTest[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      !UUID.test(item.id) ||
      typeof item.engagement_control_id !== "string" ||
      !UUID.test(item.engagement_control_id)
    ) {
      return null;
    }
    const status = oneOf(item.status, ["PROPOSED", "APPROVED"] as const);
    if (status === null) {
      return null;
    }
    const checks: PopulationCheck[] = [];
    for (const check of Array.isArray(item.checks) ? item.checks : []) {
      if (!isRecord(check)) {
        continue;
      }
      const result = oneOf(check.result, ["OK", "ISSUE", "INFO"] as const);
      if (result !== null) {
        checks.push({
          check: str(check.check),
          result,
          detail: str(check.detail),
        });
      }
    }
    const samples: Sample[] = [];
    for (const sample of Array.isArray(item.samples) ? item.samples : []) {
      if (!isRecord(sample)) {
        continue;
      }
      const position = int(sample.position);
      const row = int(sample.row_number);
      const selection = oneOf(sample.selection, [
        "RANDOM",
        "HAPHAZARD",
        "TARGETED",
      ] as const);
      if (position === null || row === null || selection === null) {
        continue;
      }
      samples.push({
        position,
        rowNumber: row,
        keyValue: str(sample.key_value),
        rowValues: Array.isArray(sample.row_values)
          ? sample.row_values.map((v) => (typeof v === "string" ? v : ""))
          : [],
        selection,
        reason: str(sample.reason),
        replacedBy: maybe(sample.replaced_by_name),
      });
    }
    tests.push({
      id: item.id,
      controlId: item.engagement_control_id,
      controlRef: str(item.control_ref),
      status,
      sampleSize: int(item.sample_size) ?? 0,
      populationFileId: str(item.population_file_id),
      populationFileName: str(item.population_file_name),
      populationSha256: str(item.population_sha256),
      populationRows: int(item.population_rows) ?? 0,
      frameRows: int(item.frame_rows) ?? 0,
      keyColumn: str(item.key_column),
      dateColumn: str(item.date_column),
      columns: Array.isArray(item.columns)
        ? item.columns.filter((c): c is string => typeof c === "string")
        : [],
      checks,
      seed: str(item.seed),
      explanation: str(item.explanation),
      approvedBy: maybe(item.approved_by_name),
      approvedAt: maybe(item.approved_at),
      sampleRequestId: maybe(item.sample_request_id),
      sampleRequestStatus: maybe(item.sample_request_status),
      samples,
      version: int(item.version) ?? 1,
      testRoundId: maybe(item.test_round_id),
    });
  }
  return tests;
}

export function testFor(
  tests: readonly ControlTest[] | null,
  controlId: string,
): ControlTest | null {
  // Interim testing's plan; a round's plan shows with its round.
  return (
    (tests ?? []).find(
      (test) => test.controlId === controlId && test.testRoundId === null,
    ) ?? null
  );
}

/** The few columns worth showing for a sample, after its key. */
export function shownColumns(test: ControlTest, limit = 3): number[] {
  return test.columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => column !== "" && column !== test.keyColumn)
    .slice(0, limit)
    .map(({ index }) => index);
}

export type TestIntent = "propose" | "replace" | "approve";

export type TestWrite =
  | { error: "invalid" }
  | {
      intent: TestIntent;
      path: string;
      body: Record<string, unknown>;
      controlId: string | null;
    };

export function testWrite(fields: Record<string, string>): TestWrite {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const intent = fields.intent ?? "";
  const controlId = UUID.test(fields.control_id ?? "")
    ? (fields.control_id ?? null)
    : null;
  if (!UUID.test(organizationId) || !UUID.test(projectId)) {
    return { error: "invalid" };
  }
  const base = `/organizations/${organizationId}/projects/${projectId}/control-tests`;
  if (intent === "propose") {
    const fileId = fields.evidence_file_id ?? "";
    if (!UUID.test(fileId)) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${base}/propose`,
      body: { evidence_file_id: fileId },
      controlId,
    };
  }
  const testId = fields.test_id ?? "";
  const raw = fields.version ?? "";
  if (!UUID.test(testId) || !/^\d{1,6}$/.test(raw) || Number(raw) < 1) {
    return { error: "invalid" };
  }
  const version = Number(raw);
  if (intent === "approve") {
    return {
      intent,
      path: `${base}/${testId}/approve`,
      body: { version },
      controlId,
    };
  }
  if (intent === "replace") {
    const position = fields.position ?? "";
    const row = fields.row_number ?? "";
    const selection = oneOf(fields.selection, [
      "HAPHAZARD",
      "TARGETED",
    ] as const);
    const reason = (fields.reason ?? "").trim();
    if (
      !/^\d{1,3}$/.test(position) ||
      !/^\d{1,7}$/.test(row) ||
      Number(row) < 1 ||
      selection === null ||
      reason.length < 3 ||
      reason.length > 500 ||
      CREDENTIAL.test(reason)
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${base}/${testId}/samples/${Number(position)}/replace`,
      body: { version, row_number: Number(row), selection, reason },
      controlId,
    };
  }
  return { error: "invalid" };
}

export type TestNotice =
  | "samples-proposed"
  | "sample-replaced"
  | "samples-approved"
  | "test-changed"
  | "test-denied"
  | "test-invalid"
  | "test-not-ready"
  | "test-unavailable";

export const TEST_NOTICES: Record<TestNotice, string> = {
  "samples-proposed":
    "The tester drew a new selection with a new seed. Review it before approving.",
  "sample-replaced": "Sample replaced. Your reason is recorded with it.",
  "samples-approved":
    "Samples approved. The sample evidence request is drafted and goes out only after the usual approval.",
  "test-changed":
    "The test plan changed, is already approved, or that row is not available. Refresh and try again.",
  "test-denied": "Your role cannot change this test plan.",
  "test-invalid":
    "Check the fields and try again. A replacement needs a row and a reason.",
  "test-not-ready":
    "This control is not ready for testing. Readiness on the Overview tab says what is missing and how to resolve it.",
  "test-unavailable": "That could not be saved. Try again.",
};

export function parseTestNotice(value: string | null): TestNotice | null {
  return (
    (Object.keys(TEST_NOTICES) as TestNotice[]).find(
      (notice) => notice === value,
    ) ?? null
  );
}

export function testNoticeFor(
  intent: TestIntent,
  status: number,
  detail = "",
): TestNotice {
  if (status === 200) {
    return intent === "propose"
      ? "samples-proposed"
      : intent === "replace"
        ? "sample-replaced"
        : "samples-approved";
  }
  if (status === 409) {
    return detail === "control not ready" ? "test-not-ready" : "test-changed";
  }
  if (status === 403 || status === 404) {
    return "test-denied";
  }
  if (status === 422) {
    return "test-invalid";
  }
  return "test-unavailable";
}
