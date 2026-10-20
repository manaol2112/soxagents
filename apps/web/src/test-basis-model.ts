/**
 * A control's test basis and its candidate standards, as the control record reads them
 * (standard library, milestone L2): what the plan is built from, the standard it follows
 * and the firm's review of it, the candidates the rules or the model proposed with their
 * status and rationale, and the decisions a person can make. Nothing here decides.
 */

export const TEST_BASES = ["STANDARD", "CLIENT", "CUSTOM"] as const;
export type TestBasisKind = (typeof TEST_BASES)[number];

export const BASIS_LABELS: Record<TestBasisKind, string> = {
  STANDARD: "Standard",
  CLIENT: "Client's procedures",
  CUSTOM: "Customized standard",
};

export const BASIS_MEANINGS: Record<TestBasisKind, string> = {
  STANDARD:
    "The standard's procedures and attributes govern, with the client's values filled in. A procedure a person rewords is shown as a deviation on the plan review.",
  CLIENT:
    "The client's documented procedures and attributes govern. The standard is reference only; the plan is built from the control's own facts.",
  CUSTOM:
    "The standard is the starting point and the firm tailors it. Edits are recorded as the person's; nothing is flagged as a deviation.",
};

export const MATCH_STATUSES = ["STRONG", "PARTIAL", "NONE"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const MATCH_LABELS: Record<MatchStatus, string> = {
  STRONG: "Strong candidate",
  PARTIAL: "Partial candidate",
  NONE: "No reliable match",
};

export const MATCH_TONES: Record<MatchStatus, string> = {
  STRONG: "tone-success",
  PARTIAL: "tone-warning",
  NONE: "tone-neutral",
};

export type Candidate = {
  libraryKey: string;
  controlRef: string;
  title: string;
  objective: string;
  rank: number;
  status: MatchStatus;
  rationale: string;
  applicable: string[];
  excluded: Array<{ key: string; reason: string }>;
  missing: string[];
  libraryStatus: string;
};

export type TestBasis = {
  controlId: string;
  source: string;
  basis: TestBasisKind;
  decided: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string;
  standard: {
    libraryKey: string;
    controlRef: string;
    title: string;
    libraryStatus: string;
  } | null;
  clientProceduresStated: boolean;
  clientProcedures: string[];
  run: {
    decidedBy: "RULES" | "MODEL";
    note: string;
    noMatch: boolean;
    computedAt: string;
  } | null;
  candidates: Candidate[];
  canDecide: boolean;
  modelAvailable: boolean;
};

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const strOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
const records = (value: unknown): Json[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.find((item) => item === value) ?? fallback;
}

export function parseTestBasis(value: unknown): TestBasis | null {
  if (!isRecord(value) || typeof value.control_id !== "string") {
    return null;
  }
  const run = isRecord(value.run) ? value.run : null;
  const standard = isRecord(value.standard) ? value.standard : null;
  return {
    controlId: value.control_id,
    source: str(value.source),
    basis: oneOf(value.basis, TEST_BASES, "CLIENT"),
    decided: value.decided === true,
    decidedBy: strOrNull(value.decided_by),
    decidedAt: strOrNull(value.decided_at),
    note: str(value.note),
    standard:
      standard === null
        ? null
        : {
            libraryKey: str(standard.library_key),
            controlRef: str(standard.control_ref),
            title: str(standard.title),
            libraryStatus: str(standard.library_status),
          },
    clientProceduresStated: value.client_procedures_stated === true,
    clientProcedures: strings(value.client_procedures),
    run:
      run === null
        ? null
        : {
            decidedBy: run.decided_by === "MODEL" ? "MODEL" : "RULES",
            note: str(run.note),
            noMatch: run.no_match === true,
            computedAt: str(run.computed_at),
          },
    candidates: records(value.candidates).map((item) => ({
      libraryKey: str(item.library_key),
      controlRef: str(item.control_ref),
      title: str(item.title),
      objective: str(item.objective),
      rank: num(item.rank),
      status: oneOf(item.status, MATCH_STATUSES, "NONE"),
      rationale: str(item.rationale),
      applicable: strings(item.applicable),
      excluded: records(item.excluded).map((entry) => ({
        key: str(entry.key),
        reason: str(entry.reason),
      })),
      missing: strings(item.missing),
      libraryStatus: str(item.library_status),
    })),
    canDecide: value.can_decide === true,
    modelAvailable: value.model_available === true,
  };
}

/** The one line the record leads with: what the plan is built from, and from what. */
export function basisLine(basis: TestBasis): string {
  const word = BASIS_LABELS[basis.basis];
  if (basis.basis === "CLIENT") {
    return basis.clientProceduresStated
      ? `${word}: the client's RCM states ${basis.clientProcedures.length} test ${basis.clientProcedures.length === 1 ? "procedure" : "procedures"}.`
      : `${word}: the client's RCM states no specific test procedure, only that the control operates as described.`;
  }
  if (basis.standard === null) {
    return `${word}: no standard is chosen yet.`;
  }
  return `${word}: ${basis.standard.controlRef} ${basis.standard.title}.`;
}

/** Whether a standard's review status should be said beside it. */
export function standardNote(libraryStatus: string): string {
  switch (libraryStatus) {
    case "APPROVED":
      return "";
    case "RETIRED":
      return "Retired on the Library";
    case "SUPERSEDED":
      return "Approved at an earlier library version";
    case "DRAFT":
      return "Draft on the Library";
    default:
      return "Pending methodology review";
  }
}

// Writes

export type BasisWrite =
  | { error: "invalid" }
  | { method: "POST" | "PUT"; path: string; body: Record<string, unknown> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z0-9][a-z0-9-]{1,59}$/;

const text = (fields: Record<string, unknown>, name: string): string =>
  typeof fields[name] === "string" ? (fields[name] as string) : "";

/** The API call a decision on the control's test basis makes. */
export function basisWrite(fields: Record<string, unknown>): BasisWrite {
  const organizationId = text(fields, "organization_id");
  const projectId = text(fields, "project_id");
  const controlId = text(fields, "control_id");
  if (
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    !UUID.test(controlId)
  ) {
    return { error: "invalid" };
  }
  const base = `/organizations/${organizationId}/projects/${projectId}/controls/${controlId}/test-basis`;
  const intent = text(fields, "intent");
  if (intent === "match") {
    return { method: "POST", path: `${base}/match`, body: {} };
  }
  if (intent === "basis") {
    const basis = text(fields, "basis");
    const key = text(fields, "library_key");
    if (!TEST_BASES.includes(basis as TestBasisKind)) {
      return { error: "invalid" };
    }
    if (key !== "" && !KEY.test(key)) {
      return { error: "invalid" };
    }
    return {
      method: "PUT",
      path: base,
      body: {
        basis,
        library_key: key === "" ? null : key,
        note: text(fields, "note"),
      },
    };
  }
  return { error: "invalid" };
}

/** What a failed call tells the person; null when it succeeded. */
export function basisProblem(status: number, detail: string): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 0) {
    return "The control could not be reached. Try again.";
  }
  if (status === 403) {
    return "Only someone who can update the engagement decides the test basis.";
  }
  if (status === 409 && detail !== "") {
    return detail.charAt(0).toUpperCase() + detail.slice(1);
  }
  return "That could not be saved.";
}
