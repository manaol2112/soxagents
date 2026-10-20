/**
 * Plan-revision impact assessments (plan_impact.py, W3): results signed off under a
 * plan revision that was later revised, or never recorded, await an independent
 * reviewer's decision. The agent recommends with its rationale and never decides; the
 * workspace shows the recommendation as advice and the decision as the reviewer's.
 */
export type ImpactStatus = "PENDING" | "VALID" | "REPERFORM" | "SUPERSEDED";

export type ImpactAssessment = {
  id: string;
  controlId: string;
  controlRef: string;
  testSheetId: string;
  testRoundId: string | null;
  roundKind: "ROLLFORWARD" | "RETEST" | null;
  signedBy: string | null;
  signedAt: string;
  conclusion: string;
  fromRevision: number | null;
  toRevision: number;
  status: ImpactStatus;
  recommendation: {
    decision: "VALID" | "REPERFORM" | null;
    rationale: string;
    changes: {
      section: string;
      code: string;
      change: string;
      detail: string;
    }[];
  };
  decidedBy: string | null;
  decidedAt: string | null;
  rationale: string;
  viewerCanDecide: boolean;
  version: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const maybe = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const STATUSES: ImpactStatus[] = [
  "PENDING",
  "VALID",
  "REPERFORM",
  "SUPERSEDED",
];

export function parseImpact(value: unknown): ImpactAssessment[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const found: ImpactAssessment[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.control_id !== "string"
    ) {
      continue;
    }
    const advice = isRecord(item.recommendation) ? item.recommendation : {};
    const decision = advice.decision;
    found.push({
      id: item.id,
      controlId: item.control_id,
      controlRef: str(item.control_ref),
      testSheetId: str(item.test_sheet_id),
      testRoundId: maybe(item.test_round_id),
      roundKind:
        item.round_kind === "ROLLFORWARD" || item.round_kind === "RETEST"
          ? item.round_kind
          : null,
      signedBy: maybe(item.signed_by),
      signedAt: str(item.signed_at),
      conclusion: str(item.conclusion),
      fromRevision: num(item.from_revision),
      toRevision: num(item.to_revision) ?? 0,
      status: STATUSES.find((status) => status === item.status) ?? "PENDING",
      recommendation: {
        decision:
          decision === "VALID" || decision === "REPERFORM" ? decision : null,
        rationale: str(advice.rationale),
        changes: (Array.isArray(advice.changes) ? advice.changes : [])
          .filter(isRecord)
          .map((change) => ({
            section: str(change.section),
            code: str(change.code),
            change: str(change.change),
            detail: str(change.detail),
          })),
      },
      decidedBy: maybe(item.decided_by),
      decidedAt: maybe(item.decided_at),
      rationale: str(item.rationale),
      viewerCanDecide: item.viewer_can_decide === true,
      version: num(item.version) ?? 1,
    });
  }
  return found;
}

/** The control's assessments, pending first, then newest. */
export function impactFor(
  assessments: readonly ImpactAssessment[] | null,
  controlId: string,
): ImpactAssessment[] {
  return (assessments ?? [])
    .filter((item) => item.controlId === controlId)
    .sort((a, b) => {
      if ((a.status === "PENDING") !== (b.status === "PENDING")) {
        return a.status === "PENDING" ? -1 : 1;
      }
      return a.signedAt < b.signedAt ? 1 : -1;
    });
}

/** What was tested, in words: "Interim testing signed off not effective by Dana". */
export function resultsWords(item: ImpactAssessment): string {
  const what =
    item.roundKind === "RETEST"
      ? "Retest"
      : item.roundKind === "ROLLFORWARD"
        ? "Roll-forward"
        : "Interim testing";
  const conclusion =
    item.conclusion === "EFFECTIVE"
      ? "effective"
      : item.conclusion === "NOT_EFFECTIVE"
        ? "not effective"
        : item.conclusion.toLowerCase();
  return `${what} signed off ${conclusion}${item.signedBy !== null ? ` by ${item.signedBy}` : ""}`;
}

/** The revision gap in words. */
export function revisionWords(item: ImpactAssessment): string {
  return item.fromRevision === null
    ? `tested under a revision that was not recorded; the plan is now at revision ${item.toRevision}`
    : `tested under revision ${item.fromRevision}; the plan is now at revision ${item.toRevision}`;
}

/** "The agent recommends … because …", or that it has no recommendation. */
export function adviceWords(item: ImpactAssessment): {
  headline: string;
  because: string;
} {
  const advice = item.recommendation;
  if (advice.decision === null) {
    return {
      headline: "The agent has no recommendation",
      because: advice.rationale,
    };
  }
  return {
    headline: `The agent recommends ${advice.decision === "VALID" ? "that the results stand (VALID)" : "re-performance (REPERFORM)"}`,
    because: advice.rationale,
  };
}

export const IMPACT_STATUS_LABEL: Record<ImpactStatus, string> = {
  PENDING: "Awaiting a reviewer's decision",
  VALID: "Results stand",
  REPERFORM: "Re-performance required",
  SUPERSEDED: "Superseded by a later revision",
};

export type ImpactWrite =
  | { error: "invalid" }
  | { path: string; method: "POST"; body: Record<string, unknown> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREDENTIAL =
  /(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*\S|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b/i;

/** A reviewer's decision on an assessment, checked before it leaves the browser. The
 * API checks the role, the signer's exclusion and the version again. */
export function impactWrite(fields: Record<string, unknown>): ImpactWrite {
  const organizationId =
    typeof fields.organization_id === "string" ? fields.organization_id : "";
  const projectId =
    typeof fields.project_id === "string" ? fields.project_id : "";
  const assessmentId =
    typeof fields.assessment_id === "string" ? fields.assessment_id : "";
  const decision = fields.decision;
  const rationale =
    typeof fields.rationale === "string" ? fields.rationale.trim() : "";
  const version =
    typeof fields.version === "number"
      ? fields.version
      : Number(fields.version);
  if (
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    !UUID.test(assessmentId) ||
    (decision !== "VALID" && decision !== "REPERFORM") ||
    rationale.length < 3 ||
    rationale.length > 2000 ||
    CREDENTIAL.test(rationale) ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    return { error: "invalid" };
  }
  return {
    path: `/organizations/${organizationId}/projects/${projectId}/impact/${assessmentId}/decide`,
    method: "POST",
    body: { version, decision, rationale },
  };
}

/** What a refused decision means for the person, from the API's answer. */
export function impactProblem(status: number, detail: string): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 409) {
    // The API says what conflicts ("the assessment changed", "you signed off this
    // testing"); the person is told what to do about it.
    const why =
      detail !== ""
        ? detail.charAt(0).toUpperCase() + detail.slice(1).replace(/\.$/, "")
        : "The assessment changed";
    return `${why}. Reload to see what is on record.`;
  }
  if (status === 403 || status === 404) {
    return "Only the engagement's reviewer decides an impact assessment.";
  }
  if (status === 422) {
    return "Give a rationale of at least three characters.";
  }
  return "The decision could not be recorded. Try again.";
}
