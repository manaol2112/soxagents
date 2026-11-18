/**
 * The Evidence Intelligence Workspace (docs/evidence-intelligence.md, increment 1): what
 * the control's evidence step shows for each file, read from the records that exist. The
 * navigator lists the items by phase with their files; the insight of one file says what
 * the reader found, which requested items it supports (with the denominator), the
 * findings (the reader's gaps and uncovered items, the mapping's missing, conflicts and
 * concerns for the file, the screenshot review's issues), each passage the mapping
 * located in the file, the next action, and the questions to suggest. Everything here is
 * pure and derived; nothing decides, and a passage is shown only where a record located
 * it ("not located in the file" otherwise).
 */

import type { EvidenceAnalysis, EvidenceReview } from "./analysis-model.ts";
import { EVIDENCE_KIND_LABELS, REVIEW_CHECK_LABELS } from "./analysis-model.ts";
import type {
  EvidenceMappingRun,
  MappingReference,
  MappingStatus,
} from "./evidence-mapping-model.ts";
import {
  CONCERN_KIND_LABELS,
  MAPPING_STATUS_LABELS,
  MAPPING_STATUS_TONES,
} from "./evidence-mapping-model.ts";
import type { RegisterFile } from "./evidence-model.ts";
import type {
  EvidencePlan,
  Phase,
  PlanRequirement,
  RequirementFile,
  RequirementState,
} from "./evidence-plan-model.ts";
import {
  REQUIREMENT_STATE_LABELS,
  waitsOnPerson,
} from "./evidence-plan-model.ts";
import type { EvidenceCitation } from "./evidence-preview-model.ts";
import {
  REQUEST_PHASE_LABELS,
  REQUEST_PHASES,
} from "./evidence-requests-model.ts";

export type Register = {
  files: RegisterFile[];
  analyses: EvidenceAnalysis[];
  reviews: EvidenceReview[];
};

export type ReadState = "unread" | "reading" | "ready" | "failed";

/** A file as the navigator lists it under the item it serves. */
export type NavFile = {
  id: string;
  fileName: string;
  requirementId: string;
  requestId: string | null;
  sizeBytes: number | null;
  createdAt: string | null;
  addedBy: string;
  read: ReadState;
  kindLabel: string | null;
  coverage: RequirementFile["coverage"];
  via: RequirementFile["via"];
  /** A person must look: the read failed, or the screenshot review needs a person. */
  attention: boolean;
};

export type NavItem = {
  requirement: PlanRequirement;
  files: NavFile[];
  /** Evidence arrived and no one has judged it, or a change waits on a person. */
  waits: boolean;
  attention: boolean;
};

export type NavPhase = {
  phase: Phase;
  label: string;
  items: NavItem[];
  fileCount: number;
  /** Items waiting on a person, plus files needing one. */
  attention: number;
};

const HIDDEN: readonly RequirementState[] = ["REMOVED"];

function readState(status: string | null | undefined): ReadState {
  if (status === "PENDING" || status === "WORKING") {
    return "reading";
  }
  if (status === "READY") {
    return "ready";
  }
  if (status === "FAILED") {
    return "failed";
  }
  return "unread";
}

/** The items by phase with their files, from the plan and the control's file register. */
export function navigatorOf(
  plan: EvidencePlan | null,
  register: Register | null,
): NavPhase[] {
  if (plan === null) {
    return [];
  }
  const byId = new Map((register?.files ?? []).map((file) => [file.id, file]));
  const needsPerson = new Set(
    (register?.reviews ?? [])
      .filter(
        (review) =>
          review.status === "NEEDS_PERSON" && review.decision === null,
      )
      .map((review) => review.fileId),
  );
  return REQUEST_PHASES.flatMap((phase) => {
    const planPhase = plan.phases.find((entry) => entry.phase === phase);
    if (planPhase === undefined) {
      return [];
    }
    const items: NavItem[] = planPhase.requirements
      .filter((requirement) => !HIDDEN.includes(requirement.state))
      .map((requirement) => {
        const files: NavFile[] = requirement.files.map((file) => {
          const held = byId.get(file.fileId);
          const read = readState(file.readStatus);
          return {
            id: file.fileId,
            fileName: file.name,
            requirementId: requirement.id,
            requestId: requirement.requestId,
            sizeBytes: held?.sizeBytes ?? null,
            createdAt: held?.createdAt ?? null,
            addedBy: held?.addedBy ?? "",
            read,
            kindLabel:
              held?.kindLabel ??
              (file.kind !== null && file.kind in EVIDENCE_KIND_LABELS
                ? EVIDENCE_KIND_LABELS[
                    file.kind as keyof typeof EVIDENCE_KIND_LABELS
                  ]
                : null),
            coverage: file.coverage,
            via: file.via,
            attention: read === "failed" || needsPerson.has(file.fileId),
          };
        });
        return {
          requirement,
          files,
          waits: waitsOnPerson(requirement),
          attention: files.some((file) => file.attention),
        };
      });
    if (items.length === 0) {
      return [];
    }
    return [
      {
        phase,
        label: REQUEST_PHASE_LABELS[phase],
        items,
        fileCount: items.reduce((sum, item) => sum + item.files.length, 0),
        attention: items.reduce(
          (sum, item) =>
            sum +
            (item.waits ? 1 : 0) +
            item.files.filter((f) => f.attention).length,
          0,
        ),
      },
    ];
  });
}

/** The phases narrowed to one phase and a search over item titles and file names. */
export function filterNavigator(
  phases: NavPhase[],
  filter: { phase: Phase | "all"; search: string },
): NavPhase[] {
  const needle = filter.search.trim().toLowerCase();
  return phases
    .filter((phase) => filter.phase === "all" || phase.phase === filter.phase)
    .map((phase) => ({
      ...phase,
      items:
        needle === ""
          ? phase.items
          : phase.items
              .map((item) =>
                item.requirement.title.toLowerCase().includes(needle)
                  ? item
                  : {
                      ...item,
                      files: item.files.filter((file) =>
                        file.fileName.toLowerCase().includes(needle),
                      ),
                    },
              )
              .filter(
                (item) =>
                  item.requirement.title.toLowerCase().includes(needle) ||
                  item.files.length > 0,
              ),
    }))
    .filter((phase) => phase.items.length > 0);
}

/** Every file the navigator shows, once each, in navigator order. */
export function navigatorFiles(phases: NavPhase[]): NavFile[] {
  const seen = new Set<string>();
  const files: NavFile[] = [];
  for (const phase of phases) {
    for (const item of phase.items) {
      for (const file of item.files) {
        if (!seen.has(file.id)) {
          seen.add(file.id);
          files.push(file);
        }
      }
    }
  }
  return files;
}

/** The file to open first: the one a link names, else the first that needs a person,
 * else the newest. */
export function firstFile(
  phases: NavPhase[],
  wanted: string | null,
): NavFile | null {
  const files = navigatorFiles(phases);
  if (wanted !== null) {
    const named = files.find((file) => file.id === wanted);
    if (named !== undefined) {
      return named;
    }
  }
  return (
    files.find((file) => file.attention) ??
    [...files].sort((a, b) =>
      (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
    )[0] ??
    null
  );
}

// --- The insight of one file --------------------------------------------------------

export type CoverageState =
  | "SUPPORTED"
  | "PARTIAL"
  | "NOT_SUPPORTED"
  | "CONFLICTING"
  | "CLARIFICATION"
  | "NOT_ASSESSED";

export const COVERAGE_STATE_LABELS: Record<CoverageState, string> = {
  SUPPORTED: "Supported",
  PARTIAL: "Partially supported",
  NOT_SUPPORTED: "Not supported by reviewed evidence",
  CONFLICTING: "Conflicting evidence",
  CLARIFICATION: "Requires clarification",
  NOT_ASSESSED: "Not yet assessed",
};

export const COVERAGE_STATE_TONES: Record<CoverageState, string> = {
  SUPPORTED: "tone-success",
  PARTIAL: "tone-warning",
  NOT_SUPPORTED: "tone-danger",
  CONFLICTING: "tone-danger",
  CLARIFICATION: "tone-warning",
  NOT_ASSESSED: "tone-neutral",
};

export type CoverageRow = {
  requirementId: string;
  title: string;
  phase: Phase;
  state: CoverageState;
  /** What the reader found for the item in this file. */
  note: string;
  /** The person's judgment of the item, when one stands. */
  decided: RequirementState | null;
  decidedLabel: string;
  attributes: string[];
};

export type FindingKind =
  | "GAP"
  | "PARTIAL"
  | "NOT_COVERED"
  | "MISSING"
  | "CONFLICT"
  | "CONCERN"
  | "REVIEW";

export type FindingTone = "warning" | "danger";

export type Finding = {
  key: string;
  kind: FindingKind;
  tone: FindingTone;
  title: string;
  observation: string;
  /** The attribute code it concerns, "" when it concerns an item. */
  attribute: string;
  requirementId: string | null;
  requirementTitle: string;
  /** The passage a record located in this file; null when none is on record. */
  citation: EvidenceCitation | null;
  source: "READER" | "MAPPING" | "REVIEW";
  next: string;
};

export type Support = {
  key: string;
  title: string;
  note: string;
  attribute: string;
  citation: EvidenceCitation | null;
};

export type TraceRow = {
  code: string;
  attribute: string;
  status: MappingStatus;
  label: string;
  tone: string;
  references: EvidenceCitation[];
  missing: string[];
};

export type FileStatus = {
  state: ReadState;
  label: string;
  detail: string;
  tone: "success" | "info" | "danger" | "neutral";
};

export type FileInsight = {
  file: NavFile;
  analysis: EvidenceAnalysis | null;
  review: EvidenceReview | null;
  status: FileStatus;
  summary: string;
  readBy: string;
  period: string;
  kindLabel: string | null;
  coverage: {
    rows: CoverageRow[];
    supported: number;
    assessed: number;
    total: number;
  };
  findings: Finding[];
  supports: Support[];
  citations: EvidenceCitation[];
  trace: TraceRow[];
  mapping: {
    revision: number | null;
    stale: boolean;
    reasons: string[];
  } | null;
  next: { title: string; detail: string };
  questions: string[];
};

const CODE_PAGE = /page\s+(\d+)/i;

function cite(
  reference: Pick<
    MappingReference,
    "fileId" | "fileName" | "quote" | "location" | "page"
  >,
  label: string,
): EvidenceCitation {
  return {
    fileId: reference.fileId,
    fileName: reference.fileName,
    quote: reference.quote,
    found: true,
    location: reference.location,
    page: reference.page,
    box: null,
    label,
  };
}

function clip(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) {
    return clean;
  }
  const cut = clean.slice(0, limit);
  const stop = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("; "),
    cut.lastIndexOf(", "),
  );
  return `${(stop > limit / 2 ? cut.slice(0, stop) : cut).trim()}…`;
}

/** The attribute's code at a mapping index: the approved attribute's own code, else A1… */
function attributeCode(
  index: number,
  attributes: ReadonlyArray<{ code: string }>,
): string {
  return attributes[index]?.code ?? `A${index + 1}`;
}

function statusOf(
  file: NavFile,
  analysis: EvidenceAnalysis | null,
): FileStatus {
  if (file.read === "reading") {
    return {
      state: "reading",
      label: "Reading the file",
      detail: "The evidence reader is reading it against the request.",
      tone: "info",
    };
  }
  if (file.read === "failed") {
    return {
      state: "failed",
      label: "Could not be read",
      detail:
        analysis?.note ||
        "Reading the file did not finish. A person reviews it.",
      tone: "danger",
    };
  }
  if (file.read === "ready" && analysis?.classification) {
    return {
      state: "ready",
      label: "Evidence analyzed",
      detail:
        analysis.source === "MODEL" || analysis.source === "SEEDED"
          ? "The reader has reviewed this document against the request's items."
          : "Classified by the standard checks, without a model: they match a file's kind, not its detail.",
      tone: "success",
    };
  }
  return {
    state: "unread",
    label: "Not read yet",
    detail: "No reading is on record for this file.",
    tone: "neutral",
  };
}

/** What the records say about one file. Null when the navigator does not list it. */
export function insightOf(
  fileId: string,
  phases: NavPhase[],
  register: Register | null,
  mapping: EvidenceMappingRun | null,
  attributes: ReadonlyArray<{ code: string; text: string }>,
  controlRef: string,
): FileInsight | null {
  const file = navigatorFiles(phases).find((entry) => entry.id === fileId);
  if (file === undefined) {
    return null;
  }
  const analysis =
    register?.analyses.find((entry) => entry.fileId === fileId) ?? null;
  const review =
    register?.reviews.find((entry) => entry.fileId === fileId) ?? null;
  const classification =
    analysis?.status === "READY" ? analysis.classification : null;
  const run = mapping !== null && mapping.mappings.length > 0 ? mapping : null;
  const codeOf = (index: number) => attributeCode(index, attributes);

  // The items this file serves, with the reader's view of each.
  const rows: CoverageRow[] = [];
  for (const phase of phases) {
    for (const item of phase.items) {
      const served = item.requirement.files.find(
        (entry) => entry.fileId === fileId,
      );
      if (served === undefined) {
        continue;
      }
      const requirement = item.requirement;
      let state: CoverageState =
        served.coverage === "COVERED"
          ? "SUPPORTED"
          : served.coverage === "PARTIAL"
            ? "PARTIAL"
            : served.coverage === "NOT_COVERED"
              ? "NOT_SUPPORTED"
              : "NOT_ASSESSED";
      if (requirement.state === "FOLLOW_UP_REQUIRED") {
        state = "CLARIFICATION";
      }
      const decided =
        requirement.state === "ACCEPTED" ||
        requirement.state === "INSUFFICIENT" ||
        requirement.state === "FOLLOW_UP_REQUIRED"
          ? requirement.state
          : null;
      rows.push({
        requirementId: requirement.id,
        title: requirement.title,
        phase: phase.phase,
        state,
        note: served.note,
        decided,
        decidedLabel: decided === null ? "" : REQUIREMENT_STATE_LABELS[decided],
        attributes: requirement.attributes,
      });
    }
  }

  const findings: Finding[] = [];
  const supports: Support[] = [];
  const citations: EvidenceCitation[] = [];

  // What the reader found: each gap, and each item it does not cover or covers in part.
  if (classification !== null) {
    classification.gaps.forEach((gap, index) => {
      findings.push({
        key: `gap-${index}`,
        kind: "GAP",
        tone: "warning",
        title: clip(gap, 90),
        observation: gap,
        attribute: "",
        requirementId: null,
        requirementTitle: "",
        citation: null,
        source: "READER",
        next: "Ask the control owner, or accept the item if the gap does not matter here.",
      });
    });
    for (const row of rows) {
      if (row.state === "NOT_SUPPORTED" || row.state === "PARTIAL") {
        findings.push({
          key: `item-${row.requirementId}`,
          kind: row.state === "PARTIAL" ? "PARTIAL" : "NOT_COVERED",
          tone: row.state === "PARTIAL" ? "warning" : "danger",
          title:
            row.state === "PARTIAL"
              ? `Covers in part: ${row.title}`
              : `Does not cover: ${row.title}`,
          observation:
            row.note || "The reader found nothing in this file for it.",
          attribute: "",
          requirementId: row.requirementId,
          requirementTitle: row.title,
          citation: null,
          source: "READER",
          next:
            row.state === "PARTIAL"
              ? "Follow up on what is missing, or accept the item with what is there."
              : "Another file must show it; the item stays open.",
        });
      } else if (row.state === "SUPPORTED") {
        supports.push({
          key: `covers-${row.requirementId}`,
          title: `Covers: ${row.title}`,
          note: row.note,
          attribute: "",
          citation: null,
        });
      }
    }
  }

  // What the mapping located in this file, and what it found wanting.
  const trace: TraceRow[] = [];
  if (run !== null) {
    const mine = run.files.find((entry) => entry.fileId === fileId);
    const myName = mine?.fileName ?? file.fileName;
    for (const entry of run.mappings) {
      const code = codeOf(entry.index);
      const refs = entry.references
        .map((reference, index) => ({ reference, index }))
        .filter(({ reference }) => reference.fileId === fileId);
      const cited = refs.map(({ reference }) => cite(reference, code));
      citations.push(...cited);
      trace.push({
        code,
        attribute: entry.attribute,
        status: entry.status,
        label: MAPPING_STATUS_LABELS[entry.status],
        tone: MAPPING_STATUS_TONES[entry.status],
        references: cited,
        missing: entry.missing,
      });
      cited.forEach((citation, index) => {
        const fact = entry.facts.find(
          (candidate) => candidate.reference === refs[index]?.index,
        );
        supports.push({
          key: `ref-${entry.index}-${index}`,
          title: `${code}: ${clip(fact?.text ?? entry.attribute, 90)}`,
          note: citation.quote,
          attribute: code,
          citation,
        });
      });
      const candidate = entry.candidates.some((c) => c.fileName === myName);
      if (candidate) {
        entry.missing.forEach((text, index) => {
          findings.push({
            key: `missing-${entry.index}-${index}`,
            kind: "MISSING",
            tone: "warning",
            title: `${code}: ${clip(text, 90)}`,
            observation: text,
            attribute: code,
            requirementId: null,
            requirementTitle: entry.attribute,
            citation: null,
            source: "MAPPING",
            next: "Request the record that shows it; a policy that describes the control does not show it operated.",
          });
        });
      }
      entry.conflicts.forEach((conflict, index) => {
        const here = conflict.references
          .map((at) => entry.references[at])
          .find((reference) => reference?.fileId === fileId);
        if (here === undefined) {
          return;
        }
        findings.push({
          key: `conflict-${entry.index}-${index}`,
          kind: "CONFLICT",
          tone: "danger",
          title: `${code}: ${clip(conflict.text, 90)}`,
          observation: conflict.text,
          attribute: code,
          requirementId: null,
          requirementTitle: entry.attribute,
          citation: cite(here, code),
          source: "MAPPING",
          next: "Ask the control owner which record stands; the attribute is contradictory until then.",
        });
      });
      entry.concerns
        .filter((concern) => concern.fileName === myName)
        .forEach((concern, index) => {
          findings.push({
            key: `concern-${entry.index}-${index}`,
            kind: "CONCERN",
            tone: "danger",
            title: `${CONCERN_KIND_LABELS[concern.kind]}: ${clip(concern.quote, 70)}`,
            observation: concern.reason,
            attribute: code,
            requirementId: null,
            requirementTitle: entry.attribute,
            citation: {
              fileId,
              fileName: myName,
              quote: concern.quote,
              found: true,
              location: concern.location,
              page: CODE_PAGE.exec(concern.location)?.[1]
                ? Number(CODE_PAGE.exec(concern.location)?.[1])
                : null,
              box: null,
              label: code,
            },
            source: "MAPPING",
            next: "Kept apart for a person: it is not support for the attribute.",
          });
        });
    }
    // A conflict on an attribute an item serves makes the item's coverage conflicting.
    const conflicting = new Set(
      findings.filter((f) => f.kind === "CONFLICT").map((f) => f.attribute),
    );
    for (const row of rows) {
      if (row.attributes.some((code) => conflicting.has(code))) {
        row.state = "CONFLICTING";
      }
    }
  }

  // The screenshot review's issues, when the tester's first pass found any.
  if (review !== null && review.decision === null) {
    review.checks
      .filter((check) => check.result !== "OK")
      .forEach((check) => {
        findings.push({
          key: `check-${check.check}`,
          kind: "REVIEW",
          tone: check.result === "ISSUE" ? "danger" : "warning",
          title: `${REVIEW_CHECK_LABELS[check.check]}: ${check.result === "ISSUE" ? "issue" : "unclear"}`,
          observation: check.note,
          attribute: "",
          requirementId: null,
          requirementTitle: "",
          citation: null,
          source: "REVIEW",
          next: "Decide the review on the Details tab, or ask for the screenshot again.",
        });
      });
    review.attributes
      .filter((test) => test.result !== "PASS")
      .forEach((test) => {
        findings.push({
          key: `attr-${test.index}`,
          kind: "REVIEW",
          tone: test.result === "EXCEPTION" ? "danger" : "warning",
          title: `${codeOf(test.index)}: ${test.result === "EXCEPTION" ? "exception" : "not determinable"}`,
          observation: [test.observed, test.note]
            .filter((p) => p !== "")
            .join(" "),
          attribute: codeOf(test.index),
          requirementId: null,
          requirementTitle: test.attribute,
          citation: null,
          source: "REVIEW",
          next: "A person decides the review; an exception is logged from the test sheet.",
        });
      });
  }

  const order: Record<FindingTone, number> = { danger: 0, warning: 1 };
  findings.sort((a, b) => order[a.tone] - order[b.tone]);

  const supported = rows.filter((row) => row.state === "SUPPORTED").length;
  const assessed = rows.filter((row) => row.state !== "NOT_ASSESSED").length;
  const next = nextOf(file, rows, phases, findings);
  const kindLabel =
    analysis?.confirmedKind !== null && analysis?.confirmedKind !== undefined
      ? EVIDENCE_KIND_LABELS[analysis.confirmedKind]
      : classification !== null
        ? EVIDENCE_KIND_LABELS[classification.kind]
        : file.kindLabel;
  return {
    file,
    analysis,
    review,
    status: statusOf(file, analysis),
    summary: classification?.summary ?? "",
    readBy:
      analysis === null
        ? ""
        : analysis.source === "MODEL" || analysis.source === "SEEDED"
          ? "Read by the evidence reader"
          : analysis.source === "FALLBACK"
            ? "Standard checks (the model's answer was not usable)"
            : "Standard checks",
    period: classification?.period ?? "",
    kindLabel,
    coverage: { rows, supported, assessed, total: rows.length },
    findings,
    supports,
    citations,
    trace,
    mapping:
      run === null
        ? null
        : {
            revision: run.planRevision,
            stale: run.stale,
            reasons: run.staleReasons,
          },
    next,
    questions: questionsOf(
      file,
      controlRef,
      findings,
      trace,
      analysis?.confirmedKind ?? classification?.kind ?? null,
      phases,
    ),
  };
}

function nextOf(
  file: NavFile,
  rows: CoverageRow[],
  phases: NavPhase[],
  findings: Finding[],
): { title: string; detail: string } {
  if (file.read === "reading") {
    return {
      title: "Wait for the reader",
      detail:
        "Its view of the file arrives in a moment; nothing to decide yet.",
    };
  }
  if (file.read === "failed") {
    return {
      title: "Read the file yourself, or read it again",
      detail:
        "The reader could not finish; the file is still evidence a person can judge.",
    };
  }
  const items = phases.flatMap((phase) => phase.items);
  const waiting = rows
    .map((row) =>
      items.find((item) => item.requirement.id === row.requirementId),
    )
    .filter((item): item is NavItem => item?.waits === true);
  if (waiting.length > 0) {
    const first = waiting[0] as NavItem;
    return {
      title: `Decide: ${first.requirement.title}`,
      detail:
        findings.length > 0
          ? `Accept it, or follow up on the ${findings.length === 1 ? "finding" : `${findings.length} findings`} below.`
          : "Accept it, or say what is still needed.",
    };
  }
  const clarifying = rows.find((row) => row.decided === "FOLLOW_UP_REQUIRED");
  if (clarifying !== undefined) {
    return {
      title: "Awaiting the control owner",
      detail: `A follow-up is open on ${clarifying.title}; the next reply or file is read against it.`,
    };
  }
  if (rows.some((row) => row.decided === "INSUFFICIENT")) {
    return {
      title: "Awaiting better evidence",
      detail:
        "The item was judged insufficient; what arrives next is read against it.",
    };
  }
  return {
    title: "Nothing waits on you for this file",
    detail:
      rows.length === 0
        ? "It serves no item of the plan; link it to one if it should."
        : "Its items are decided; the reading stays on record.",
  };
}

function questionsOf(
  file: NavFile,
  controlRef: string,
  findings: Finding[],
  trace: TraceRow[],
  kind: string | null,
  phases: NavPhase[],
): string[] {
  const questions = [`What is still missing for ${controlRef}?`];
  if (findings.some((f) => f.source === "READER")) {
    questions.push(
      `Draft follow-up questions for the organization about ${file.fileName}.`,
    );
  }
  if (trace.length > 0) {
    questions.push(`Which attributes does ${file.fileName} support?`);
  }
  if (findings.some((f) => f.kind === "CONFLICT")) {
    questions.push(
      "Are there contradictions between the documents for this control?",
    );
  }
  if (kind === "policy") {
    questions.push("Compare this policy with the prior-year policy.");
  }
  if (navigatorFiles(phases).length > 1) {
    questions.push("What changed after the latest upload?");
  }
  return questions.slice(0, 4);
}

/** A finding's passage, as the viewer focuses it. Null where no record located one. */
export function focusOf(
  finding: Pick<Finding, "citation">,
): EvidenceCitation | null {
  return finding.citation;
}

/** The note a follow-up starts from: the findings ticked, one line each. */
export function followUpNote(
  findings: ReadonlyArray<Pick<Finding, "observation">>,
): string {
  return findings
    .map((finding) => finding.observation.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("; ")
    .slice(0, 1000);
}

/** The phase chip counts the navigator shows. */
export function phaseCounts(phases: NavPhase[]): Array<{
  phase: Phase | "all";
  label: string;
  files: number;
  attention: number;
}> {
  return [
    {
      phase: "all",
      label: "All",
      files: phases.reduce((sum, phase) => sum + phase.fileCount, 0),
      attention: phases.reduce((sum, phase) => sum + phase.attention, 0),
    },
    ...phases.map((phase) => ({
      phase: phase.phase,
      label: phase.label,
      files: phase.fileCount,
      attention: phase.attention,
    })),
  ];
}

/** One line on a file for the navigator: who added it and when, and its size. */
export function fileMeta(
  file: Pick<NavFile, "addedBy" | "createdAt" | "sizeBytes" | "via">,
  formatBytes: (size: number) => string,
  formatDate: (value: string) => string,
): string {
  const parts: string[] = [];
  if (file.createdAt !== null) {
    parts.push(
      file.addedBy !== ""
        ? `${file.addedBy} · ${formatDate(file.createdAt)}`
        : formatDate(file.createdAt),
    );
  }
  if (file.sizeBytes !== null && file.sizeBytes > 0) {
    parts.push(formatBytes(file.sizeBytes));
  }
  if (file.via === "LINK") {
    parts.push("linked");
  } else if (file.via === "SHARED") {
    parts.push("shared from another system");
  }
  return parts.join(" · ");
}

/** The phase whose items hold the file, or null. */
export function phaseOfFile(
  phases: readonly NavPhase[],
  fileId: string | null,
): Phase | null {
  if (fileId === null) {
    return null;
  }
  return (
    phases.find((entry) =>
      entry.items.some((item) => item.files.some((file) => file.id === fileId)),
    )?.phase ?? null
  );
}

/** The item new evidence is added to: the one chosen, else the open file's, else the
 * first requested item still without a file, else the first requested item. An item not
 * yet requested takes no files, so it is never the fallback. */
export function uploadTargetOf(
  phases: readonly NavPhase[],
  chosenItem: string | null,
  fileId: string | null,
): NavItem | null {
  const items = phases.flatMap((entry) => entry.items);
  const fileItem = items.find((item) =>
    item.files.some((file) => file.id === fileId),
  );
  return (
    items.find((item) => item.requirement.id === chosenItem) ??
    fileItem ??
    items.find(
      (item) => item.files.length === 0 && item.requirement.requestId !== null,
    ) ??
    items.find((item) => item.requirement.requestId !== null) ??
    null
  );
}

/** The phase whose items hold the item. */
export function phaseOfItem(
  phases: readonly NavPhase[],
  itemId: string | null,
): Phase | null {
  return (
    phases.find((entry) =>
      entry.items.some((item) => item.requirement.id === itemId),
    )?.phase ?? null
  );
}

/** The navigator's phase sections that start open: the one holding the open file, else
 * the one holding the item new evidence goes to (so its drop zone is in view), else the
 * first with items. */
export function openAtStart(
  phases: readonly NavPhase[],
  fileId: string | null,
): Phase[] {
  const held = phaseOfFile(phases, fileId);
  if (held !== null) {
    return [held];
  }
  const target = uploadTargetOf(phases, null, fileId);
  const phase =
    phaseOfItem(phases, target?.requirement.id ?? null) ??
    phases.find((entry) => entry.items.length > 0)?.phase ??
    null;
  return phase === null ? [] : [phase];
}
