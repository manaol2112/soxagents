/**
 * The control's Evidence tab as one workspace: where the evidence stands, what the agents
 * propose for a person to decide, and the requirements, requests, and files, each read
 * from the API's records (the evidence plan, the control's requests, and its files).
 * Nothing here judges evidence: a requirement is accepted only by a person.
 */

import type { ControlFiles, ControlRequest } from "./engagement-model.ts";
import {
  type Assessment,
  type EvidencePlan,
  PHASES,
  type Phase,
  type PlanPhase,
  type PlanRequirement,
  type RequirementState,
} from "./evidence-plan-model.ts";

export const EVIDENCE_VIEWS = [
  "requirements",
  "requests",
  "files",
  "plan",
] as const;
export type EvidenceView = (typeof EVIDENCE_VIEWS)[number];

export const EVIDENCE_VIEW_LABELS: Record<EvidenceView, string> = {
  requirements: "Evidence plan",
  requests: "Requests",
  files: "Files",
  plan: "Planning basis",
};

const OUT = new Set([
  "SENT",
  "WAITING_FOR_RESPONSE",
  "PARTIALLY_RECEIVED",
  "OVERDUE",
  "ESCALATED",
]);
const ANSWERED = new Set(["RECEIVED", "CLOSED"]);

/** A requirement a person can judge now: something arrived and no one has decided. */
const TO_JUDGE: ReadonlySet<RequirementState> = new Set([
  "RECEIVED",
  "PARTIALLY_RECEIVED",
  "UNDER_REVIEW",
]);
const GAPS: ReadonlySet<RequirementState> = new Set([
  "INSUFFICIENT",
  "FOLLOW_UP_REQUIRED",
  "OVERDUE",
  "CANCELLED",
]);
const NOT_REQUESTED: ReadonlySet<RequirementState> = new Set([
  "NOT_GENERATED",
  "AWAITING_DEPENDENCY",
]);
const WITH_OWNER: ReadonlySet<RequirementState> = new Set(["SENT", "OVERDUE"]);
const UNSENT: ReadonlySet<RequirementState> = new Set([
  "DRAFT",
  "READY_FOR_REVIEW",
  "APPROVAL_PENDING",
]);

/** The requirements of the phases that apply (or may), without the removed ones. */
export function liveRequirements(plan: EvidencePlan | null): PlanRequirement[] {
  return (plan?.phases ?? [])
    .filter((phase) => phase.applicability !== "NOT_APPLICABLE")
    .flatMap((phase) => phase.requirements)
    .filter((q) => q.state !== "REMOVED" && q.state !== "NOT_APPLICABLE");
}

export type EvidenceSummary = {
  requirements: {
    total: number;
    accepted: number;
    toJudge: number;
    gaps: number;
    withOwner: number;
    unsent: number;
    notRequested: number;
  };
  requests: {
    total: number;
    drafted: number;
    approval: number;
    /** Approved and waiting to be sent: no longer awaiting approval. */
    approved: number;
    out: number;
    overdue: number;
    answered: number;
  };
  files: { total: number; read: number; reading: number; failed: number };
  /** What holds the evidence up, in words, most pressing first. */
  blockers: string[];
};

export function evidenceSummary(
  plan: EvidencePlan | null,
  requests: readonly ControlRequest[],
  files: ControlFiles | null,
): EvidenceSummary {
  const live = liveRequirements(plan);
  const count = (set: ReadonlySet<RequirementState>) =>
    live.filter((q) => set.has(q.state)).length;
  const current = requests.filter((r) => r.status !== "CANCELLED");
  const all = files?.files ?? [];
  const blockers: string[] = [];
  for (const phase of plan?.phases ?? []) {
    if (phase.applicability === "PENDING") {
      blockers.push(
        `${phase.label}: ${phase.openQuestion || "whether the phase applies is undecided"}`,
      );
    }
  }
  if (plan !== null && plan.pendingChanges > 0) {
    blockers.push(
      `Planning again proposes ${plural(plan.pendingChanges, "change")} to decide`,
    );
  }
  const overdue = current.filter(
    (r) => r.status === "OVERDUE" || r.status === "ESCALATED",
  ).length;
  if (overdue > 0) {
    blockers.push(`${plural(overdue, "request")} overdue with the owner`);
  }
  const gaps = count(GAPS);
  if (gaps > 0) {
    blockers.push(`${plural(gaps, "requirement")} found short, to follow up`);
  }
  const failed = all.filter((file) => file.readStatus === "FAILED").length;
  if (failed > 0) {
    blockers.push(
      `${plural(failed, "file")} could not be read; a person reviews ${failed === 1 ? "it" : "them"}`,
    );
  }
  return {
    requirements: {
      total: live.length,
      accepted: live.filter((q) => q.state === "ACCEPTED").length,
      toJudge: count(TO_JUDGE),
      gaps,
      withOwner: count(WITH_OWNER),
      unsent: count(UNSENT),
      notRequested: count(NOT_REQUESTED),
    },
    requests: {
      total: current.length,
      drafted: current.filter((r) => r.status === "DRAFT").length,
      approval: current.filter(
        (r) =>
          r.status === "APPROVAL_PENDING" && r.approvalDecision !== "APPROVED",
      ).length,
      approved: current.filter(
        (r) =>
          r.status === "APPROVAL_PENDING" && r.approvalDecision === "APPROVED",
      ).length,
      out: current.filter((r) => OUT.has(r.status)).length,
      overdue,
      answered: current.filter((r) => ANSWERED.has(r.status)).length,
    },
    files: {
      total: all.length,
      read: all.filter((file) => file.readStatus === "READY").length,
      reading: all.filter(
        (file) =>
          file.readStatus === "PENDING" || file.readStatus === "WORKING",
      ).length,
      failed,
    },
    blockers,
  };
}

export type Proposal = {
  requirement: PlanRequirement;
  phaseLabel: string;
  assessment: Assessment;
};

/** What the evidence reader proposes and no person has decided yet: a requirement with
 * something received, not yet judged, and a view from the reader. */
export function proposals(plan: EvidencePlan | null): Proposal[] {
  const order: Assessment["proposal"][] = [
    "INSUFFICIENT",
    "FOLLOW_UP",
    "SUFFICIENT",
  ];
  return (plan?.phases ?? [])
    .flatMap((phase) =>
      phase.requirements.map((requirement) => ({
        requirement,
        phaseLabel: PHASE_NAMES[phase.phase],
        assessment: requirement.assessment,
      })),
    )
    .filter(
      (item) =>
        TO_JUDGE.has(item.requirement.state) &&
        item.assessment.proposal !== "NONE",
    )
    .sort(
      (a, b) =>
        order.indexOf(a.assessment.proposal) -
        order.indexOf(b.assessment.proposal),
    );
}

export const PHASE_NAMES: Record<Phase, string> = {
  DESIGN: "Design",
  INTERIM: "Interim",
  ROLLFORWARD: "Roll-forward",
};

export type RequirementStatusFilter =
  | "all"
  | "decide"
  | "gaps"
  | "waiting"
  | "accepted";

export const STATUS_FILTER_LABELS: Record<RequirementStatusFilter, string> = {
  all: "All statuses",
  decide: "To judge",
  gaps: "Gaps",
  waiting: "Waiting",
  accepted: "Accepted",
};

export function matchesStatus(
  requirement: PlanRequirement,
  filter: RequirementStatusFilter,
): boolean {
  switch (filter) {
    case "decide":
      return (
        TO_JUDGE.has(requirement.state) || requirement.pendingChange !== null
      );
    case "gaps":
      return GAPS.has(requirement.state);
    case "waiting":
      return (
        NOT_REQUESTED.has(requirement.state) ||
        UNSENT.has(requirement.state) ||
        WITH_OWNER.has(requirement.state)
      );
    case "accepted":
      return requirement.state === "ACCEPTED";
    default:
      return true;
  }
}

export type PhaseGroup = {
  phase: PlanPhase;
  items: PlanRequirement[];
};

/** The phase to open: the first that is not signed off, in audit order. Design until
 * it is confirmed, then interim, then roll-forward. A phase that does not apply is skipped. */
export function focusPhase(
  phases: ReadonlyArray<
    Pick<PlanPhase, "phase" | "applicability" | "state" | "testingComplete">
  >,
): Phase {
  const later = [...PHASES];
  for (const key of later) {
    const phase = phases.find((item) => item.phase === key);
    if (phase === undefined) {
      return key;
    }
    if (
      phase.applicability === "NOT_APPLICABLE" ||
      phase.state === "NOT_APPLICABLE" ||
      phase.state === "COMPLETE" ||
      phase.testingComplete
    ) {
      continue;
    }
    return key;
  }
  return later[later.length - 1] ?? "DESIGN";
}

/** The requirements by phase, in audit order, filtered. A phase the plan says does not
 * apply is kept, with no items, so its reason stays in view. */
export function requirementGroups(
  plan: EvidencePlan | null,
  phase: Phase | "all",
  status: RequirementStatusFilter,
): PhaseGroup[] {
  return (plan?.phases ?? [])
    .filter((item) => phase === "all" || item.phase === phase)
    .map((item) => ({
      phase: item,
      items: item.requirements.filter(
        (q) =>
          q.state !== "REMOVED" &&
          (item.applicability !== "NOT_APPLICABLE" ||
            q.state !== "NOT_APPLICABLE") &&
          matchesStatus(q, status),
      ),
    }));
}

export type RequestRow = ControlRequest & {
  /** The plan requirements it carries, by title. */
  carries: string[];
  files: number;
};

/** The control's requests across phases, with what each carries and what came back. */
export function requestRows(
  requests: readonly ControlRequest[],
  plan: EvidencePlan | null,
  files: ControlFiles | null,
): RequestRow[] {
  const all = (plan?.phases ?? []).flatMap((phase) => phase.requirements);
  const order = ["DESIGN", "INTERIM", "ROLLFORWARD", "RETEST", "REMEDIATION"];
  return [...requests]
    .sort(
      (a, b) =>
        order.indexOf(a.phase ?? "INTERIM") -
        order.indexOf(b.phase ?? "INTERIM"),
    )
    .map((request) => ({
      ...request,
      carries: all
        .filter((q) => q.requestId === request.id && q.state !== "REMOVED")
        .map((q) => q.title),
      files: (files?.files ?? []).filter(
        (file) => file.request?.id === request.id,
      ).length,
    }));
}

/** For each file, the requirements it serves: through its request, or linked by a
 * person, with what the reader found. */
export function fileServes(
  plan: EvidencePlan | null,
): Map<string, Array<{ label: string; via: "REQUEST" | "LINK" }>> {
  const serves = new Map<
    string,
    Array<{ label: string; via: "REQUEST" | "LINK" }>
  >();
  for (const phase of plan?.phases ?? []) {
    for (const requirement of phase.requirements) {
      for (const file of requirement.files) {
        const coverage =
          file.coverage === "COVERED"
            ? ", covered"
            : file.coverage === "PARTIAL"
              ? ", partly covered"
              : file.coverage === "NOT_COVERED"
                ? ", not covered"
                : "";
        const list = serves.get(file.fileId) ?? [];
        list.push({
          label: `${PHASE_NAMES[phase.phase]}: ${requirement.title}${coverage}`,
          via: file.via,
        });
        serves.set(file.fileId, list);
      }
    }
  }
  return serves;
}

/** A file of the control, as the requirements view needs it. */
export type HeldFile = {
  id: string;
  fileName: string;
  requestId: string | null;
};

/** The control's files a requirement does not have yet, to link to it: not already
 * serving it, and not on its own request (those serve it already). */
export function linkableFiles(
  requirement: PlanRequirement,
  files: readonly HeldFile[],
): Array<{ id: string; name: string }> {
  const have = new Set(requirement.files.map((file) => file.fileId));
  return files
    .filter(
      (file) =>
        !have.has(file.id) &&
        (requirement.requestId === null ||
          file.requestId !== requirement.requestId),
    )
    .map((file) => ({ id: file.id, name: file.fileName }));
}

export function evidenceViewOf(value: string): EvidenceView {
  return EVIDENCE_VIEWS.find((view) => view === value) ?? "requirements";
}

function plural(count: number, one: string): string {
  return `${count} ${count === 1 ? one : `${one}s`}`;
}

/** The plan requirements a request carries, with why each is needed, for its review. */
export function carriedBy(
  plan: EvidencePlan | null,
  requestId: string,
): Array<{
  phase: string;
  title: string;
  rationale: string;
  necessity: string;
}> {
  return (plan?.phases ?? [])
    .flatMap((phase) => phase.requirements)
    .filter((q) => q.requestId === requestId && q.state !== "REMOVED")
    .map((q) => ({
      phase: q.phase,
      title: q.title,
      rationale: q.rationale,
      necessity: q.necessity,
    }));
}
