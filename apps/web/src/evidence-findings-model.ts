/**
 * Evidence findings (docs/evidence-intelligence.md, increment 2; evidence_findings.py):
 * what the agents found wanting, as records a person disposes of. Parsed from the API,
 * never derived here; the labels, the decisions a status allows, and the message a
 * follow-up starts from are pure, so they are tested without a browser.
 */

import type { EvidenceCitation } from "./evidence-preview-model.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FindingSource = "READER" | "RULES" | "MAPPING";

export type FindingKind =
  | "GAP"
  | "PARTIAL"
  | "NOT_COVERED"
  | "PLACEHOLDER"
  | "VERSION"
  | "PERIOD"
  | "MISSING"
  | "CONFLICT"
  | "CONCERN";

export const FINDING_STATUSES = [
  "PROPOSED",
  "ACCEPTED",
  "DISMISSED",
  "SENT",
  "ANSWERED",
  "RESOLVED",
  "CLARIFICATION_ACCEPTED",
  "MORE_NEEDED",
  "NOT_APPLICABLE",
  "ESCALATED",
] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export type FindingDecision =
  | "ACCEPT"
  | "EDIT"
  | "DISMISS"
  | "RESOLVE"
  | "CLARIFICATION_ACCEPTED"
  | "MORE_NEEDED"
  | "NOT_APPLICABLE"
  | "ESCALATE"
  | "REOPEN";

export type FindingEvent = {
  event: string;
  actorKind: "PERSON" | "AGENT" | "SYSTEM";
  actor: string | null;
  note: string;
  question: string;
  pointsAt: Record<string, unknown>;
  createdAt: string;
};

export type EvidenceFinding = {
  id: string;
  fileId: string | null;
  fileName: string;
  analysisId: string | null;
  mappingRunId: string | null;
  requirementId: string | null;
  requirementTitle: string;
  requestId: string | null;
  attributeIndex: number | null;
  /** The approved attribute's own identifier and code (A1…), when the finding concerns one. */
  attributeId: string | null;
  attributeCode: string;
  source: FindingSource;
  kind: FindingKind;
  title: string;
  observation: string;
  question: string;
  expected: string;
  citation: EvidenceCitation | null;
  planRevision: number | null;
  status: FindingStatus;
  stale: boolean;
  staleReason: string;
  sentMessageId: string | null;
  answeredByMessageId: string | null;
  answeredByFileId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  events: FindingEvent[];
};

export const FINDING_STATUS_LABELS: Record<FindingStatus, string> = {
  PROPOSED: "Proposed",
  ACCEPTED: "Accepted",
  DISMISSED: "Dismissed",
  SENT: "Sent to the owner",
  ANSWERED: "Answered",
  RESOLVED: "Resolved",
  CLARIFICATION_ACCEPTED: "Clarification accepted",
  MORE_NEEDED: "More needed",
  NOT_APPLICABLE: "Not applicable",
  ESCALATED: "Escalated for review",
};

export const FINDING_STATUS_TONES: Record<FindingStatus, string> = {
  PROPOSED: "tone-ai",
  ACCEPTED: "tone-info",
  DISMISSED: "tone-neutral",
  SENT: "tone-info",
  ANSWERED: "tone-warning",
  RESOLVED: "tone-success",
  CLARIFICATION_ACCEPTED: "tone-success",
  MORE_NEEDED: "tone-warning",
  NOT_APPLICABLE: "tone-neutral",
  ESCALATED: "tone-danger",
};

export const FINDING_KIND_LABELS: Record<FindingKind, string> = {
  GAP: "Gap",
  PARTIAL: "Covers in part",
  NOT_COVERED: "Not covered",
  PLACEHOLDER: "Placeholder text",
  VERSION: "Version not established",
  PERIOD: "Outside the window",
  MISSING: "Record missing",
  CONFLICT: "Conflicting evidence",
  CONCERN: "Kept apart for review",
};

export const FINDING_SOURCE_LABELS: Record<FindingSource, string> = {
  READER: "The evidence reader",
  RULES: "The standard checks",
  MAPPING: "The evidence mapping",
};

/** Open: a person still has something to do with it. */
export const OPEN_STATUSES: readonly FindingStatus[] = [
  "PROPOSED",
  "ACCEPTED",
  "SENT",
  "ANSWERED",
  "MORE_NEEDED",
  "ESCALATED",
];

export const CLOSED_STATUSES: readonly FindingStatus[] = [
  "DISMISSED",
  "RESOLVED",
  "CLARIFICATION_ACCEPTED",
  "NOT_APPLICABLE",
];

/** A finding is sent to the owner from these. */
export const SENDABLE_STATUSES: readonly FindingStatus[] = [
  "ACCEPTED",
  "MORE_NEEDED",
  "ESCALATED",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const strOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

function parseCitation(value: unknown, label: string): EvidenceCitation | null {
  if (
    !isRecord(value) ||
    typeof value.file_id !== "string" ||
    !UUID.test(value.file_id)
  ) {
    return null;
  }
  const page = value.page;
  return {
    fileId: value.file_id,
    fileName: str(value.file_name),
    quote: str(value.quote),
    found: value.found !== false,
    location: str(value.location),
    page:
      typeof page === "number" && Number.isInteger(page) && page > 0
        ? page
        : null,
    box: null,
    label,
  };
}

function parseEvent(value: unknown): FindingEvent | null {
  if (!isRecord(value) || typeof value.event !== "string") {
    return null;
  }
  const kind = value.actor_kind;
  return {
    event: value.event,
    actorKind:
      kind === "PERSON" || kind === "AGENT" || kind === "SYSTEM"
        ? kind
        : "SYSTEM",
    actor: strOrNull(value.actor),
    note: str(value.note),
    question: str(value.question),
    pointsAt: isRecord(value.points_at) ? value.points_at : {},
    createdAt: str(value.created_at),
  };
}

export function parseFinding(value: unknown): EvidenceFinding | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !UUID.test(value.id)
  ) {
    return null;
  }
  const status = FINDING_STATUSES.find((entry) => entry === value.status);
  const kind = str(value.kind) as FindingKind;
  const source = str(value.source) as FindingSource;
  if (
    status === undefined ||
    !(kind in FINDING_KIND_LABELS) ||
    !(source in FINDING_SOURCE_LABELS)
  ) {
    return null;
  }
  const index = value.attribute_index;
  const revision = value.plan_revision;
  return {
    id: value.id,
    fileId: strOrNull(value.file_id),
    fileName: str(value.file_name),
    analysisId: strOrNull(value.analysis_id),
    mappingRunId: strOrNull(value.mapping_run_id),
    requirementId: strOrNull(value.requirement_id),
    requirementTitle: str(value.requirement_title),
    requestId: strOrNull(value.request_id),
    attributeIndex: typeof index === "number" ? index : null,
    attributeId: strOrNull(value.attribute_id),
    attributeCode: str(value.attribute_code),
    source,
    kind,
    title: str(value.title),
    observation: str(value.observation),
    question: str(value.question),
    expected: str(value.expected),
    citation: parseCitation(value.citation, ""),
    planRevision: typeof revision === "number" ? revision : null,
    status,
    stale: value.stale === true,
    staleReason: str(value.stale_reason),
    sentMessageId: strOrNull(value.sent_message_id),
    answeredByMessageId: strOrNull(value.answered_by_message_id),
    answeredByFileId: strOrNull(value.answered_by_file_id),
    decidedBy: strOrNull(value.decided_by),
    decidedAt: strOrNull(value.decided_at),
    decisionNote: str(value.decision_note),
    createdAt: str(value.created_at),
    updatedAt: str(value.updated_at),
    version: typeof value.version === "number" ? value.version : 1,
    events: (Array.isArray(value.events) ? value.events : [])
      .map(parseEvent)
      .filter((event): event is FindingEvent => event !== null),
  };
}

/** The API's list for a control; null when the body is not one. */
export function parseFindings(value: unknown): EvidenceFinding[] | null {
  if (!isRecord(value) || !Array.isArray(value.findings)) {
    return null;
  }
  return value.findings
    .map(parseFinding)
    .filter((finding): finding is EvidenceFinding => finding !== null);
}

/** The findings that concern one file, open ones first, newest first within a status. */
export function findingsForFile(
  findings: readonly EvidenceFinding[],
  fileId: string,
): EvidenceFinding[] {
  const rank = (finding: EvidenceFinding) =>
    finding.status === "ANSWERED"
      ? 0
      : finding.status === "PROPOSED"
        ? 1
        : OPEN_STATUSES.includes(finding.status)
          ? 2
          : 3;
  return findings
    .filter(
      (finding) =>
        finding.fileId === fileId ||
        (finding.citation !== null && finding.citation.fileId === fileId),
    )
    .sort(
      (a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt),
    );
}

/** The decisions a person may take on a finding in its status, in the order shown. */
export function decisionsFor(status: FindingStatus): FindingDecision[] {
  switch (status) {
    case "PROPOSED":
      return ["ACCEPT", "EDIT", "DISMISS", "NOT_APPLICABLE", "ESCALATE"];
    case "ACCEPTED":
      return [
        "EDIT",
        "RESOLVE",
        "MORE_NEEDED",
        "DISMISS",
        "NOT_APPLICABLE",
        "ESCALATE",
      ];
    case "SENT":
      return [
        "RESOLVE",
        "CLARIFICATION_ACCEPTED",
        "MORE_NEEDED",
        "NOT_APPLICABLE",
        "ESCALATE",
      ];
    case "ANSWERED":
      return [
        "RESOLVE",
        "CLARIFICATION_ACCEPTED",
        "MORE_NEEDED",
        "ACCEPT",
        "DISMISS",
        "NOT_APPLICABLE",
        "ESCALATE",
      ];
    case "MORE_NEEDED":
      return ["RESOLVE", "EDIT", "NOT_APPLICABLE", "ESCALATE"];
    case "ESCALATED":
      return [
        "RESOLVE",
        "CLARIFICATION_ACCEPTED",
        "MORE_NEEDED",
        "NOT_APPLICABLE",
      ];
    default:
      return ["REOPEN"];
  }
}

export const DECISION_LABELS: Record<FindingDecision, string> = {
  ACCEPT: "Accept",
  EDIT: "Edit the question",
  DISMISS: "Dismiss",
  RESOLVE: "Resolved: supported by evidence",
  CLARIFICATION_ACCEPTED: "Clarification accepted",
  MORE_NEEDED: "Additional evidence required",
  NOT_APPLICABLE: "Not applicable",
  ESCALATE: "Escalate for review",
  REOPEN: "Reopen",
};

/** The decisions that need a reason in a sentence, as the API requires. */
export const DECISIONS_NEEDING_NOTE: readonly FindingDecision[] = [
  "CLARIFICATION_ACCEPTED",
  "MORE_NEEDED",
  "NOT_APPLICABLE",
  "ESCALATE",
  "REOPEN",
];

/** The message a follow-up starts from: one numbered question per finding, the same
 * draft the API composes (draft_follow_up). */
export function composeFollowUp(
  findings: ReadonlyArray<Pick<EvidenceFinding, "title" | "question">>,
  controlRef: string,
  controlTitle: string,
): string {
  const lines = [
    `Following up on the evidence for ${controlRef} ${controlTitle}`.trim() +
      ":",
    "",
  ];
  findings.forEach((finding, index) => {
    const ask =
      finding.question !== ""
        ? finding.question
        : `Please confirm: ${finding.title}`;
    lines.push(`${index + 1}. ${ask}`);
  });
  lines.push("", "Thank you.");
  return lines.join("\n");
}

/** What changed on a file's findings since a person last decided: what came back,
 * what the agents propose, what went out, what is out of date. For the line above the
 * list, so the person sees what moved before the detail. */
export function changesOf(findings: readonly EvidenceFinding[]): {
  answered: number;
  proposed: number;
  sent: number;
  stale: number;
  closed: number;
} {
  return {
    answered: findings.filter((f) => f.status === "ANSWERED").length,
    proposed: findings.filter((f) => f.status === "PROPOSED").length,
    sent: findings.filter((f) => f.status === "SENT").length,
    stale: findings.filter((f) => f.stale && OPEN_STATUSES.includes(f.status))
      .length,
    closed: findings.filter((f) => CLOSED_STATUSES.includes(f.status)).length,
  };
}

/** The attribute a finding concerns, by its code; the mapping's position only when the
 * plan carries no code. */
export function attributeLabel(
  finding: Pick<EvidenceFinding, "attributeCode" | "attributeIndex">,
): string {
  if (finding.attributeCode !== "") {
    return finding.attributeCode;
  }
  return finding.attributeIndex === null
    ? ""
    : `attribute ${finding.attributeIndex + 1}`;
}

/** What the last thing that happened to a finding says, for its line. */
export function latestNote(finding: EvidenceFinding): string {
  const last = finding.events[finding.events.length - 1];
  if (finding.stale && finding.staleReason !== "") {
    return `Out of date: ${finding.staleReason}`;
  }
  if (last === undefined) {
    return "";
  }
  if (last.event === "PROPOSED") {
    return "";
  }
  const who = last.actorKind === "PERSON" ? (last.actor ?? "A person") : "";
  return [who, last.note].filter((part) => part !== "").join(": ");
}

type Fields = Record<string, unknown>;
type FindingsWrite =
  | { path: string; body: Record<string, unknown> }
  | { error: "invalid" };

const text = (fields: Fields, key: string): string => str(fields[key]).trim();

/** The API call behind a findings action (the /workspace/evidence-findings route). */
export function findingsWrite(fields: Fields): FindingsWrite {
  const organizationId = text(fields, "organization_id");
  const projectId = text(fields, "project_id");
  const controlId = text(fields, "control_id");
  if (![organizationId, projectId, controlId].every((id) => UUID.test(id))) {
    return { error: "invalid" };
  }
  const control = `/organizations/${organizationId}/projects/${projectId}/controls/${controlId}`;
  const intent = text(fields, "intent");
  if (intent === "decide") {
    const findingId = text(fields, "finding_id");
    const decision = text(fields, "decision");
    const version = fields.version;
    if (
      !UUID.test(findingId) ||
      !(decision in DECISION_LABELS) ||
      typeof version !== "number"
    ) {
      return { error: "invalid" };
    }
    const fileId = text(fields, "file_id");
    return {
      path: `${control}/evidence-findings/${findingId}/decide`,
      body: {
        decision,
        note: text(fields, "note").slice(0, 1000),
        question: text(fields, "question").slice(0, 1000),
        file_id: UUID.test(fileId) ? fileId : null,
        version,
      },
    };
  }
  if (intent === "follow-up") {
    const requestId = text(fields, "request_id");
    const ids = Array.isArray(fields.finding_ids)
      ? fields.finding_ids.filter(
          (id): id is string => typeof id === "string" && UUID.test(id),
        )
      : [];
    const body = text(fields, "body");
    if (!UUID.test(requestId) || ids.length === 0 || body === "") {
      return { error: "invalid" };
    }
    return {
      path: `${control}/evidence-findings/follow-up`,
      body: {
        request_id: requestId,
        finding_ids: ids,
        body: body.slice(0, 4000),
      },
    };
  }
  return { error: "invalid" };
}

/** What a refusal means, in the page's words. */
export function findingsProblem(status: number, detail: string): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 409) {
    return detail !== "" ? detail : "The finding changed; look again.";
  }
  if (status === 403) {
    return "You are not allowed to decide this.";
  }
  if (status === 404) {
    return "The finding is not there any more.";
  }
  if (status === 422) {
    return "Something in the decision is missing.";
  }
  return "The decision could not be saved. Try again.";
}
