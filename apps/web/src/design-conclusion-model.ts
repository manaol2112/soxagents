/**
 * The D&I conclusion a reviewer signs (product owner, 8 November 2026; the API's
 * design_conclusions.py, migration 0143). The records propose the verdict once the design
 * workpaper is prepared; a reviewer who did not prepare it signs that verdict off, and OE is
 * cleared only by an effective one. This shapes the API's body for the page and builds the
 * writes.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREDENTIAL =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password\s*[:=]|private[_-]?key)/i;

export type DesignVerdict = "EFFECTIVE" | "NOT_EFFECTIVE";
export type DesignConclusionStatus =
  | "NOT_READY"
  | "TO_SIGN"
  | "SIGNED_OFF"
  | "OUT_OF_DATE";

export type DesignSignoff = {
  id: string;
  verdict: DesignVerdict;
  workpaperVersion: number;
  deficiencies: string[];
  signedBy: string;
  signedAt: string;
  note: string;
  reopenedAt: string | null;
  reopenedBy: string;
  reopenReason: string;
  reopenedFrom: "PERSON" | "WORKPAPER" | "SUPERSEDED" | null;
};

export type DesignConclusion = {
  controlId: string;
  status: DesignConclusionStatus;
  proposed: DesignVerdict | null;
  workpaper: {
    id: string;
    status: string;
    preparedBy: string;
    preparedVersion: number | null;
  } | null;
  deficiencies: Array<{ reference: string; title: string; status: string }>;
  signed: DesignSignoff | null;
  outOfDate: string[];
  blocking: string[];
  viewerIsReviewer: boolean;
  viewerPrepared: boolean;
  independenceRequired: boolean;
  canSign: boolean;
  history: DesignSignoff[];
};

export const VERDICT_LABELS: Record<DesignVerdict, string> = {
  EFFECTIVE: "Effective",
  NOT_EFFECTIVE: "Not effective",
};

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const verdictOf = (value: unknown): DesignVerdict | null =>
  value === "EFFECTIVE" || value === "NOT_EFFECTIVE" ? value : null;
const STATUSES: readonly DesignConclusionStatus[] = [
  "NOT_READY",
  "TO_SIGN",
  "SIGNED_OFF",
  "OUT_OF_DATE",
];

function signoffOf(value: unknown): DesignSignoff | null {
  if (!isRaw(value) || typeof value.id !== "string") {
    return null;
  }
  const verdict = verdictOf(value.verdict);
  if (verdict === null || typeof value.workpaper_version !== "number") {
    return null;
  }
  const from = value.reopened_from;
  return {
    id: value.id,
    verdict,
    workpaperVersion: value.workpaper_version,
    deficiencies: Array.isArray(value.deficiencies)
      ? value.deficiencies.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    signedBy: text(value.signed_by),
    signedAt: text(value.signed_at),
    note: text(value.signoff_note),
    reopenedAt:
      typeof value.reopened_at === "string" ? value.reopened_at : null,
    reopenedBy: text(value.reopened_by),
    reopenReason: text(value.reopen_reason),
    reopenedFrom:
      from === "PERSON" || from === "WORKPAPER" || from === "SUPERSEDED"
        ? from
        : null,
  };
}

const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

export function parseDesignConclusion(value: unknown): DesignConclusion | null {
  if (!isRaw(value) || typeof value.control_id !== "string") {
    return null;
  }
  const status = STATUSES.find((item) => item === value.status);
  if (status === undefined) {
    return null;
  }
  const paper = value.workpaper;
  return {
    controlId: value.control_id,
    status,
    proposed: verdictOf(value.proposed),
    workpaper:
      isRaw(paper) && typeof paper.id === "string"
        ? {
            id: paper.id,
            status: text(paper.status),
            preparedBy: text(paper.prepared_by),
            preparedVersion:
              typeof paper.prepared_version === "number"
                ? paper.prepared_version
                : null,
          }
        : null,
    deficiencies: Array.isArray(value.deficiencies)
      ? value.deficiencies.filter(isRaw).map((item) => ({
          reference: text(item.reference),
          title: text(item.title),
          status: text(item.status),
        }))
      : [],
    signed: signoffOf(value.signed),
    outOfDate: strings(value.out_of_date),
    blocking: strings(value.blocking),
    viewerIsReviewer: value.viewer_is_reviewer === true,
    viewerPrepared: value.viewer_prepared === true,
    independenceRequired: value.independence_required !== false,
    canSign: value.can_sign === true,
    history: Array.isArray(value.history)
      ? value.history
          .map(signoffOf)
          .filter((item): item is DesignSignoff => item !== null)
      : [],
  };
}

/** Why the viewer cannot sign, in the page's words; null when they can. */
export function signBlockedReason(conclusion: DesignConclusion): string | null {
  if (conclusion.canSign) {
    return null;
  }
  if (conclusion.status === "SIGNED_OFF") {
    return null;
  }
  if (conclusion.status === "NOT_READY") {
    return "The design workpaper is prepared first, in D&I Assessment.";
  }
  if (!conclusion.viewerIsReviewer) {
    return "A team member with the reviewer role signs off the D&I conclusion.";
  }
  if (conclusion.viewerPrepared && conclusion.independenceRequired) {
    return "The preparer of the design workpaper cannot sign off its conclusion. Another reviewer signs.";
  }
  return conclusion.blocking[0] ?? null;
}

export type DesignConclusionIntent = "sign" | "reopen";

export type DesignConclusionWrite =
  | { error: "invalid" }
  | {
      intent: DesignConclusionIntent;
      path: string;
      body: Record<string, unknown>;
      controlId: string;
    };

export function designConclusionWrite(
  fields: Record<string, string>,
): DesignConclusionWrite {
  const organization = fields.organization_id ?? "";
  const project = fields.project_id ?? "";
  const control = fields.control_id ?? "";
  if (!UUID.test(organization) || !UUID.test(project) || !UUID.test(control)) {
    return { error: "invalid" };
  }
  const path = `/organizations/${organization}/projects/${project}/design-conclusions/${control}`;
  if (fields.intent === "sign") {
    const verdict = verdictOf(fields.verdict);
    const version = Number(fields.workpaper_version ?? "");
    const note = (fields.note ?? "").trim();
    if (
      verdict === null ||
      !Number.isInteger(version) ||
      version < 1 ||
      note.length > 1000 ||
      CREDENTIAL.test(note)
    ) {
      return { error: "invalid" };
    }
    return {
      intent: "sign",
      path: `${path}/sign-off`,
      body: { verdict, workpaper_version: version, note },
      controlId: control,
    };
  }
  if (fields.intent === "reopen") {
    const reason = (fields.reason ?? "").trim();
    if (reason.length < 10 || reason.length > 500 || CREDENTIAL.test(reason)) {
      return { error: "invalid" };
    }
    return {
      intent: "reopen",
      path: `${path}/reopen`,
      body: { reason },
      controlId: control,
    };
  }
  return { error: "invalid" };
}

export type DesignConclusionNotice =
  | "dc-signed"
  | "dc-reopened"
  | "dc-blocked"
  | "dc-denied"
  | "dc-invalid"
  | "dc-trial-ended"
  | "dc-unavailable";

export const DESIGN_CONCLUSION_NOTICES: Record<DesignConclusionNotice, string> =
  {
    "dc-signed": "D&I conclusion signed off.",
    "dc-reopened":
      "D&I conclusion reopened. OE waits until it is signed off again.",
    "dc-blocked":
      "That could not be done: the design workpaper or its deficiencies changed, or the conclusion was already signed off. Review it again.",
    "dc-denied":
      "Only a team member with the reviewer role, who did not prepare the design workpaper, signs off the D&I conclusion.",
    "dc-invalid":
      "Check the entry and try again. A reason of at least 10 characters is needed to reopen.",
    "dc-trial-ended":
      "The free trial has ended. Everything here stays to read; explore plans to keep working.",
    "dc-unavailable": "That could not be saved. Try again.",
  };

const DONE: Record<DesignConclusionIntent, DesignConclusionNotice> = {
  sign: "dc-signed",
  reopen: "dc-reopened",
};

export function designConclusionNoticeFor(
  intent: DesignConclusionIntent,
  status: number,
  detail: string,
): DesignConclusionNotice {
  if (status === 200) {
    return DONE[intent];
  }
  if (status === 409) {
    return /reviewer|prepared the design/.test(detail)
      ? "dc-denied"
      : "dc-blocked";
  }
  // The subscription refused the change (subscriptions.py).
  if (status === 402) {
    return "dc-trial-ended";
  }
  if (status === 403 || status === 404) {
    return "dc-denied";
  }
  if (status === 422) {
    return "dc-invalid";
  }
  return "dc-unavailable";
}

export function parseDesignConclusionNotice(
  value: string | null,
): DesignConclusionNotice | null {
  return (
    (Object.keys(DESIGN_CONCLUSION_NOTICES) as DesignConclusionNotice[]).find(
      (notice) => notice === value,
    ) ?? null
  );
}
