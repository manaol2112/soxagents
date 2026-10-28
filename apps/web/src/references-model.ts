/**
 * Policies and procedures, and prior-year references, on the Systems & Processes page
 * (decided by the product owner on 25 October 2026; governing_documents.py, prior_year.py).
 *
 * A policy or procedure governs any number of systems and processes, and every control
 * under them can cite it. A prior-year reference is matched by the agent to this year's
 * controls; a person confirms each match, then accepts or dismisses what the agent
 * proposes from it. Nothing here decides: it reads what the API returns and says it.
 */

export type GoverningKind = "POLICY" | "PROCEDURE" | "NARRATIVE" | "FLOWCHART";

/** Policies and procedures govern; process narratives and flow diagrams describe (the
 * References tab, decided by the product owner on 26 October 2026). */
export const POLICY_KINDS: readonly GoverningKind[] = ["POLICY", "PROCEDURE"];
export const DESCRIPTION_KINDS: readonly GoverningKind[] = [
  "NARRATIVE",
  "FLOWCHART",
];

export const KIND_LABEL: Record<GoverningKind, string> = {
  POLICY: "Policy",
  PROCEDURE: "Procedure",
  NARRATIVE: "Process narrative",
  FLOWCHART: "Flow diagram",
};

export type Policy = {
  id: string;
  kind: GoverningKind;
  title: string;
  fileName: string;
  excerpt: string;
  createdBy: string | null;
  createdAt: string;
  systemIds: string[];
  processIds: string[];
  /** The engagement's controls it applies to, and those a person took it off. */
  controls: number;
  excluded: number;
};

export type ProposalKind =
  | "ANSWER"
  | "EXCEPTION"
  | "APPROACH"
  | "DESIGN_CHANGE";

export type Proposal = {
  id: string;
  matchId: string;
  controlId: string;
  kind: ProposalKind;
  slotKey: string;
  value: string;
  title: string;
  detail: string;
  quote: string;
  status: "PROPOSED" | "ACCEPTED" | "DISMISSED";
  decidedBy: string | null;
  version: number;
};

export type MatchStatus =
  | "PROPOSED"
  | "CONFIRMED"
  | "REJECTED"
  | "UNMATCHED"
  | "DISMISSED";

export type Match = {
  id: string;
  priorRef: string;
  priorTitle: string;
  excerpt: string;
  controlId: string | null;
  controlRef: string;
  controlTitle: string;
  systemName: string;
  basis: "REFERENCE" | "DESCRIPTION" | "PERSON" | "NONE";
  status: MatchStatus;
  analysisStatus: "PENDING" | "DONE" | "SKIPPED";
  version: number;
  proposals: Proposal[];
};

export type PriorYearReference = {
  id: string;
  title: string;
  fileName: string;
  createdBy: string | null;
  createdAt: string;
  runStatus: "PENDING" | "WORKING" | "IDLE" | "FAILED";
  runNote: string;
  matches: Match[];
};

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
function oneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

export function parsePolicy(value: unknown): Policy | null {
  const item = record(value);
  if (item === null || str(item.id) === "") {
    return null;
  }
  return {
    id: str(item.id),
    kind: oneOf(
      item.kind,
      ["POLICY", "PROCEDURE", "NARRATIVE", "FLOWCHART"] as const,
      "POLICY",
    ),
    title: str(item.title),
    fileName: str(item.file_name),
    excerpt: str(item.excerpt),
    createdBy: typeof item.created_by === "string" ? item.created_by : null,
    createdAt: str(item.created_at),
    systemIds: strings(item.system_ids),
    processIds: strings(item.process_ids),
    controls: num(item.controls),
    excluded: num(item.excluded),
  };
}

export function parsePolicies(value: unknown): Policy[] {
  return Array.isArray(value)
    ? value.map(parsePolicy).filter((item): item is Policy => item !== null)
    : [];
}

const PROPOSAL_KINDS = [
  "ANSWER",
  "EXCEPTION",
  "APPROACH",
  "DESIGN_CHANGE",
] as const;

export function parseProposal(value: unknown): Proposal | null {
  const item = record(value);
  if (item === null || str(item.id) === "") {
    return null;
  }
  return {
    id: str(item.id),
    matchId: str(item.match_id),
    controlId: str(item.control_id),
    kind: oneOf(item.kind, PROPOSAL_KINDS, "APPROACH"),
    slotKey: str(item.slot_key),
    value: str(item.value),
    title: str(item.title),
    detail: str(item.detail),
    quote: str(item.quote),
    status: oneOf(
      item.status,
      ["PROPOSED", "ACCEPTED", "DISMISSED"] as const,
      "PROPOSED",
    ),
    decidedBy: typeof item.decided_by === "string" ? item.decided_by : null,
    version: num(item.version),
  };
}

export function parseProposals(value: unknown): Proposal[] {
  return Array.isArray(value)
    ? value.map(parseProposal).filter((item): item is Proposal => item !== null)
    : [];
}

function parseMatch(value: unknown): Match | null {
  const item = record(value);
  if (item === null || str(item.id) === "") {
    return null;
  }
  return {
    id: str(item.id),
    priorRef: str(item.prior_ref),
    priorTitle: str(item.prior_title),
    excerpt: str(item.excerpt),
    controlId: typeof item.control_id === "string" ? item.control_id : null,
    controlRef: str(item.control_ref),
    controlTitle: str(item.control_title),
    systemName: str(item.system_name),
    basis: oneOf(
      item.basis,
      ["REFERENCE", "DESCRIPTION", "PERSON", "NONE"] as const,
      "NONE",
    ),
    status: oneOf(
      item.status,
      ["PROPOSED", "CONFIRMED", "REJECTED", "UNMATCHED", "DISMISSED"] as const,
      "PROPOSED",
    ),
    analysisStatus: oneOf(
      item.analysis_status,
      ["PENDING", "DONE", "SKIPPED"] as const,
      "PENDING",
    ),
    version: num(item.version),
    proposals: parseProposals(item.proposals),
  };
}

export function parseReference(value: unknown): PriorYearReference | null {
  const item = record(value);
  if (item === null || str(item.id) === "") {
    return null;
  }
  return {
    id: str(item.id),
    title: str(item.title),
    fileName: str(item.file_name),
    createdBy: typeof item.created_by === "string" ? item.created_by : null,
    createdAt: str(item.created_at),
    runStatus: oneOf(
      item.run_status,
      ["PENDING", "WORKING", "IDLE", "FAILED"] as const,
      "IDLE",
    ),
    runNote: str(item.run_note),
    matches: Array.isArray(item.matches)
      ? item.matches
          .map(parseMatch)
          .filter((match): match is Match => match !== null)
      : [],
  };
}

export function parseReferences(value: unknown): PriorYearReference[] {
  return Array.isArray(value)
    ? value
        .map(parseReference)
        .filter((item): item is PriorYearReference => item !== null)
    : [];
}

/** What a policy governs, by name, systems first; one the page no longer lists is left out. */
export function governedNames(
  policy: Policy,
  systems: ReadonlyArray<{ id: string; name: string }>,
  processes: ReadonlyArray<{ id: string; name: string }>,
): string[] {
  const named = (
    ids: string[],
    list: ReadonlyArray<{ id: string; name: string }>,
  ) =>
    ids
      .map((id) => list.find((item) => item.id === id)?.name ?? "")
      .filter((name) => name !== "");
  return [
    ...named(policy.systemIds, systems),
    ...named(policy.processIds, processes),
  ];
}

export function running(reference: PriorYearReference): boolean {
  return reference.runStatus === "PENDING" || reference.runStatus === "WORKING";
}

export type ReferenceSummary = {
  /** Matches waiting for a person to confirm. */
  toConfirm: number;
  confirmed: number;
  /** Items no control matches, waiting for a person to assign or set aside. */
  unmatched: number;
  /** Proposals of confirmed matches still waiting for a decision. */
  toDecide: number;
};

export function summarize(reference: PriorYearReference): ReferenceSummary {
  const count = (status: MatchStatus) =>
    reference.matches.filter((match) => match.status === status).length;
  return {
    toConfirm: count("PROPOSED"),
    confirmed: count("CONFIRMED"),
    unmatched: count("UNMATCHED"),
    toDecide: reference.matches
      .filter((match) => match.status === "CONFIRMED")
      .reduce(
        (sum, match) =>
          sum +
          match.proposals.filter((item) => item.status === "PROPOSED").length,
        0,
      ),
  };
}

/** Matches by how they were found, for one grouped decision each. */
export function matchGroups(reference: PriorYearReference): {
  byReference: Match[];
  byDescription: Match[];
  unmatched: Match[];
} {
  const proposed = reference.matches.filter(
    (match) => match.status === "PROPOSED",
  );
  return {
    byReference: proposed.filter((match) => match.basis === "REFERENCE"),
    byDescription: proposed.filter((match) => match.basis === "DESCRIPTION"),
    unmatched: reference.matches.filter(
      (match) => match.status === "UNMATCHED",
    ),
  };
}

export const PROPOSAL_LABEL: Record<ProposalKind, string> = {
  ANSWER: "Client-specific answers",
  EXCEPTION: "Prior-year exceptions",
  APPROACH: "Prior test approach",
  DESIGN_CHANGE: "Design changes",
};

export const PROPOSAL_DETAIL: Record<ProposalKind, string> = {
  ANSWER: "Accepted answers fill the control's questions.",
  EXCEPTION: "Accepted exceptions become points this year's plan addresses.",
  APPROACH:
    "Accepted approaches inform this year's plan; they are not evidence.",
  DESIGN_CHANGE:
    "Accepted changes are raised as issues to resolve on the control.",
};

export type ProposalRow = Proposal & {
  controlRef: string;
  controlTitle: string;
  systemName: string;
};

/** The proposals still waiting, from confirmed matches, grouped by kind in order. */
export function proposalGroups(
  references: readonly PriorYearReference[],
): Array<{ kind: ProposalKind; rows: ProposalRow[] }> {
  const rows: ProposalRow[] = references.flatMap((reference) =>
    reference.matches
      .filter((match) => match.status === "CONFIRMED")
      .flatMap((match) =>
        match.proposals
          .filter((item) => item.status === "PROPOSED")
          .map((item) => ({
            ...item,
            controlRef: match.controlRef,
            controlTitle: match.controlTitle,
            systemName: match.systemName,
          })),
      ),
  );
  return PROPOSAL_KINDS.map((kind) => ({
    kind,
    rows: rows.filter((row) => row.kind === kind),
  })).filter((group) => group.rows.length > 0);
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The tiles' counts and statuses beside Systems, Processes and Controls. */
export function policiesTile(policies: readonly Policy[]): {
  count: number;
  status: string;
} {
  if (policies.length === 0) {
    return { count: 0, status: "None added" };
  }
  const controls = policies.reduce((sum, item) => sum + item.controls, 0);
  return {
    count: policies.length,
    status: controls === 0 ? "No controls" : "In use",
  };
}

/** The References tile: the narratives and diagrams, and the prior-year references. */
export function referencesTile(
  descriptions: readonly Policy[],
  references: readonly PriorYearReference[],
): { count: number; status: string } {
  const count = descriptions.length + references.length;
  if (count === 0) {
    return { count: 0, status: "None added" };
  }
  if (references.length > 0) {
    const year = priorYearTile(references);
    if (year.status !== "Reviewed") {
      return { count, status: year.status };
    }
  }
  return { count, status: "In use" };
}

export function priorYearTile(references: readonly PriorYearReference[]): {
  count: number;
  status: string;
} {
  if (references.length === 0) {
    return { count: 0, status: "None added" };
  }
  if (references.some(running)) {
    return { count: references.length, status: "Analysing" };
  }
  const waiting = references
    .map(summarize)
    .reduce(
      (sum, item) => sum + item.toConfirm + item.unmatched + item.toDecide,
      0,
    );
  return {
    count: references.length,
    status: waiting === 0 ? "Reviewed" : `${waiting} to review`,
  };
}
