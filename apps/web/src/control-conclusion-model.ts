/**
 * The Control Conclusion step (B3; product owner, 8 November 2026: "the agent proposes, a
 * person rates"; the API's control_conclusions.py, migration 0144). The records propose the
 * control's conclusion; a person rates each deficiency's severity, with the agent's suggestion
 * beside it; the independent review makes it final. This shapes the API's body for the page
 * and builds the rating.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREDENTIAL =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password\s*[:=]|private[_-]?key)/i;

export type Verdict = "EFFECTIVE" | "NOT_EFFECTIVE";
export type Severity =
  | "CONTROL_DEFICIENCY"
  | "SIGNIFICANT_DEFICIENCY"
  | "MATERIAL_WEAKNESS";
export type ConclusionStatus = "NOT_READY" | "PROPOSED" | "FINAL";
export type PhaseState =
  | "NOT_APPLICABLE"
  | "NOT_PERFORMED"
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "SIGNED_OFF";

export const SEVERITIES: readonly Severity[] = [
  "CONTROL_DEFICIENCY",
  "SIGNIFICANT_DEFICIENCY",
  "MATERIAL_WEAKNESS",
];

export const SEVERITY_LABELS: Record<Severity, string> = {
  CONTROL_DEFICIENCY: "Control deficiency",
  SIGNIFICANT_DEFICIENCY: "Significant deficiency",
  MATERIAL_WEAKNESS: "Material weakness",
};

export const VERDICT_WORDS: Record<Verdict, string> = {
  EFFECTIVE: "Effective",
  NOT_EFFECTIVE: "Not effective",
};

export const PHASE_STATE_WORDS: Record<PhaseState, string> = {
  NOT_APPLICABLE: "Does not apply",
  NOT_PERFORMED: "Not performed",
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SIGNED_OFF: "Signed off",
};

export type ConclusionDeficiency = {
  id: string;
  reference: string;
  title: string;
  type: "DESIGN" | "OPERATING";
  status: string;
  severity: Severity;
  suggested: Severity;
  suggestionReason: string;
  pending: Severity | null;
  rated: boolean;
  rating: {
    severity: Severity;
    rationale: string;
    ratedBy: string;
    ratedAt: string;
  } | null;
  version: number;
};

export type ControlConclusion = {
  controlId: string;
  status: ConclusionStatus;
  proposed: Verdict | null;
  reasons: string[];
  waiting: string[];
  design: Verdict | null;
  phases: Array<{
    phase: "INTERIM" | "ROLLFORWARD";
    label: string;
    state: PhaseState;
    conclusion: Verdict | null;
    retested: boolean;
  }>;
  deficiencies: ConclusionDeficiency[];
  toRate: number;
  review: { status: string; signedBy: string; signedAt: string } | null;
  final: Verdict | null;
  canRate: boolean;
};

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const verdictOf = (value: unknown): Verdict | null =>
  value === "EFFECTIVE" || value === "NOT_EFFECTIVE" ? value : null;
const severityOf = (value: unknown): Severity | null =>
  SEVERITIES.find((item) => item === value) ?? null;
const STATES: readonly PhaseState[] = [
  "NOT_APPLICABLE",
  "NOT_PERFORMED",
  "NOT_STARTED",
  "IN_PROGRESS",
  "SIGNED_OFF",
];

function deficiencyOf(value: unknown): ConclusionDeficiency | null {
  if (!isRaw(value) || typeof value.id !== "string") {
    return null;
  }
  const severity = severityOf(value.severity);
  const suggested = severityOf(value.suggested_severity);
  if (severity === null || suggested === null) {
    return null;
  }
  const rating = isRaw(value.rating) ? value.rating : null;
  const rated = rating === null ? null : severityOf(rating.severity);
  return {
    id: value.id,
    reference: text(value.reference),
    title: text(value.title),
    type: value.type === "DESIGN" ? "DESIGN" : "OPERATING",
    status: text(value.status),
    severity,
    suggested,
    suggestionReason: text(value.suggestion_reason),
    pending: severityOf(value.pending_severity),
    rated: value.rated === true,
    rating:
      rating === null || rated === null
        ? null
        : {
            severity: rated,
            rationale: text(rating.rationale),
            ratedBy: text(rating.rated_by),
            ratedAt: text(rating.rated_at),
          },
    version: typeof value.version === "number" ? value.version : 1,
  };
}

const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

export function parseControlConclusion(
  value: unknown,
): ControlConclusion | null {
  if (!isRaw(value) || typeof value.control_id !== "string") {
    return null;
  }
  const status =
    value.status === "NOT_READY" ||
    value.status === "PROPOSED" ||
    value.status === "FINAL"
      ? value.status
      : null;
  if (status === null) {
    return null;
  }
  const review = isRaw(value.review) ? value.review : null;
  return {
    controlId: value.control_id,
    status,
    proposed: verdictOf(value.proposed),
    reasons: strings(value.reasons),
    waiting: strings(value.waiting),
    design: verdictOf(value.design),
    phases: Array.isArray(value.phases)
      ? value.phases.filter(isRaw).flatMap((item) => {
          const state = STATES.find((s) => s === item.state);
          const phase =
            item.phase === "INTERIM" || item.phase === "ROLLFORWARD"
              ? item.phase
              : null;
          return state === undefined || phase === null
            ? []
            : [
                {
                  phase,
                  label: text(item.label),
                  state,
                  conclusion: verdictOf(item.conclusion),
                  retested: item.retested === true,
                },
              ];
        })
      : [],
    deficiencies: Array.isArray(value.deficiencies)
      ? value.deficiencies
          .map(deficiencyOf)
          .filter((item): item is ConclusionDeficiency => item !== null)
      : [],
    toRate: typeof value.to_rate === "number" ? value.to_rate : 0,
    review:
      review === null
        ? null
        : {
            status: text(review.status),
            signedBy: text(review.signed_by),
            signedAt: text(review.signed_at),
          },
    final: verdictOf(value.final),
    canRate: value.viewer_can_rate === true,
  };
}

/** What a deficiency's rating stands at, in the page's words. */
export function ratingState(item: ConclusionDeficiency): {
  tone: "done" | "attention" | "active";
  label: string;
} {
  if (!item.rated) {
    // A severity requested when it was logged is not a rating: a person rates it.
    return { tone: "attention", label: "To rate" };
  }
  if (item.pending !== null) {
    return {
      tone: "active",
      label: `${SEVERITY_LABELS[item.pending]}: awaiting the reviewer`,
    };
  }
  if (item.rated) {
    return { tone: "done", label: `Rated ${SEVERITY_LABELS[item.severity]}` };
  }
  return { tone: "attention", label: "To rate" };
}

export type RateWrite =
  | { error: "invalid" }
  | { path: string; body: Record<string, unknown>; controlId: string };

export function rateWrite(fields: Record<string, string>): RateWrite {
  const organization = fields.organization_id ?? "";
  const project = fields.project_id ?? "";
  const control = fields.control_id ?? "";
  const deficiency = fields.deficiency_id ?? "";
  if (
    ![organization, project, control, deficiency].every((id) => UUID.test(id))
  ) {
    return { error: "invalid" };
  }
  const severity = severityOf(fields.severity);
  const version = Number(fields.version ?? "");
  const rationale = (fields.rationale ?? "").trim();
  if (
    severity === null ||
    !Number.isInteger(version) ||
    version < 1 ||
    rationale.length < 10 ||
    rationale.length > 1000 ||
    CREDENTIAL.test(rationale)
  ) {
    return { error: "invalid" };
  }
  return {
    path: `/organizations/${organization}/projects/${project}/control-conclusions/${control}/deficiencies/${deficiency}/rate`,
    body: { severity, version, rationale },
    controlId: control,
  };
}

export type ConclusionNotice =
  | "cc-rated"
  | "cc-review"
  | "cc-blocked"
  | "cc-denied"
  | "cc-invalid"
  | "cc-trial-ended"
  | "cc-unavailable";

export const CONCLUSION_NOTICES: Record<ConclusionNotice, string> = {
  "cc-rated": "Severity rated.",
  "cc-review":
    "Severity rated. A significant deficiency or material weakness takes effect once the reviewer approves it.",
  "cc-blocked":
    "That could not be done: the deficiency changed, a change to it awaits the reviewer, or the review is signed off. Review it again.",
  "cc-denied": "Only a team member on this engagement rates a severity.",
  "cc-invalid":
    "Check the entry and try again. A rationale of at least 10 characters is needed.",
  "cc-trial-ended":
    "The free trial has ended. Everything here stays to read; explore plans to keep working.",
  "cc-unavailable": "That could not be saved. Try again.",
};

export function conclusionNoticeFor(
  status: number,
  severe: boolean,
): ConclusionNotice {
  if (status === 200) {
    return severe ? "cc-review" : "cc-rated";
  }
  if (status === 409) {
    return "cc-blocked";
  }
  if (status === 402) {
    return "cc-trial-ended";
  }
  if (status === 403 || status === 404) {
    return "cc-denied";
  }
  if (status === 422) {
    return "cc-invalid";
  }
  return "cc-unavailable";
}

export function parseConclusionNotice(
  value: string | null,
): ConclusionNotice | null {
  return (
    (Object.keys(CONCLUSION_NOTICES) as ConclusionNotice[]).find(
      (notice) => notice === value,
    ) ?? null
  );
}
