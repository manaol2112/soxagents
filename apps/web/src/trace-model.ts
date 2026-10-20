import type { ControlJourney, Step } from "./control-journey-model.ts";
import type { Deficiency } from "./engagement-model.ts";
import type { EvidencePlan, PlanPhase } from "./evidence-plan-model.ts";
import type { ControlReview } from "./review-model.ts";
import type { TestSheet } from "./sheet-model.ts";

/**
 * The trace rail (Milestone 1c): the chain from control objective to independent review,
 * each link stated only from a record that exists. A link without a record is shown as
 * missing, never filled in; a link whose records are incomplete is partial.
 */
export type TraceKind =
  | "objective"
  | "risk"
  | "procedure"
  | "attribute"
  | "evidence"
  | "result"
  | "exception"
  | "conclusion"
  | "review";

export type TraceNode = {
  kind: TraceKind;
  label: string;
  state: "recorded" | "partial" | "missing";
  /** One line: what the record says, or why there is none. */
  summary: string;
  /** The records themselves, for the expanded rail. */
  items: string[];
  href: string | null;
};

/** One attribute's row: what evidence its results cite and what they found. */
export type TraceRow = {
  code: string;
  attribute: string;
  evidence: string[];
  pass: number;
  exceptions: number;
  unable: number;
  review: number;
  untested: number;
  exceptionItems: string[];
};

export type TraceInput = {
  journey: ControlJourney | null;
  risk: string;
  statement: string;
  attributes: string[];
  plan: EvidencePlan | null;
  sheet: TestSheet | null;
  review: ControlReview | null;
  deficiencies: Deficiency[];
  conclusion: "NOT_CONCLUDED" | "EFFECTIVE" | "EXCEPTION";
  hrefs: Record<Step, string>;
  /** The round the step is about (a roll-forward or retest), when there is one. */
  round?: TraceRound | null;
};

/** What the rail needs of a round: its kind, what it retests, and its request. */
export type TraceRound = {
  kind: "ROLLFORWARD" | "RETEST";
  number: number;
  deficiencyReference: string | null;
  requestStatus: string | null;
};

export const TRACE_LABELS: Record<TraceKind, string> = {
  objective: "Objective",
  risk: "Risk",
  procedure: "Procedure",
  attribute: "Attribute",
  evidence: "Evidence",
  result: "Result",
  exception: "Exception",
  conclusion: "Conclusion",
  review: "Review",
};

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

function phaseOf(
  plan: EvidencePlan | null,
  journey: ControlJourney | null,
): PlanPhase | null {
  if (plan === null) {
    return null;
  }
  const wanted = journey?.stepPhase ?? null;
  const exact =
    wanted !== null
      ? plan.phases.find((phase) => phase.phase === wanted)
      : undefined;
  if (exact !== undefined) {
    return exact;
  }
  if (wanted === "RETEST" || wanted === "REMEDIATION") {
    // No plan phase records a retest: the rail says so rather than borrowing the
    // interim's objective, procedures and evidence requirements (M1d).
    return null;
  }
  return (
    plan.phases.find((phase) => phase.phase === "INTERIM") ??
    plan.phases[0] ??
    null
  );
}

/** Whether the step is a retest, which the approved plan has no phase for. */
function retestOf(input: TraceInput): TraceRound | null {
  const round = input.round ?? null;
  const phase = input.journey?.stepPhase ?? null;
  return round !== null && round.kind === "RETEST" && phase === "RETEST"
    ? round
    : null;
}

function resultOf(
  cell: { final: string | null; proposed: string | null } | undefined,
): string | null {
  if (cell === undefined) {
    return null;
  }
  return cell.final ?? cell.proposed;
}

export function traceRows(input: TraceInput): TraceRow[] {
  const sheet = input.sheet;
  const attributes = sheet?.attributes ?? input.attributes;
  return attributes.map((attribute, index) => {
    const row: TraceRow = {
      code: `A${index + 1}`,
      attribute,
      evidence: [],
      pass: 0,
      exceptions: 0,
      unable: 0,
      review: 0,
      untested: 0,
      exceptionItems: [],
    };
    const files = new Set<string>();
    for (const item of sheet?.items ?? []) {
      const cell = item.cells.find((candidate) => candidate.index === index);
      const result = resultOf(cell);
      if (result === "PASS") {
        row.pass += 1;
      } else if (result === "EXCEPTION") {
        row.exceptions += 1;
        row.exceptionItems.push(item.label);
      } else if (result === "UNABLE") {
        row.unable += 1;
      } else if (result === "REVIEW") {
        row.review += 1;
      } else if (result !== "NOT_APPLICABLE") {
        row.untested += 1;
      }
      for (const citation of cell?.citations ?? []) {
        if (citation.fileName !== "") {
          files.add(citation.fileName);
        }
      }
    }
    row.evidence = [...files];
    return row;
  });
}

export function traceOf(input: TraceInput): TraceNode[] {
  const phase = phaseOf(input.plan, input.journey);
  const rows = traceRows(input);
  const sheet = input.sheet;
  const review = input.review;
  const nodes: TraceNode[] = [];

  const retest = retestOf(input);
  const objectives = phase?.objectives ?? [];
  nodes.push(
    objectives.length > 0
      ? {
          kind: "objective",
          label: TRACE_LABELS.objective,
          state: "recorded",
          summary: objectives[0] ?? "",
          items: objectives,
          href: input.hrefs.PLAN ?? null,
        }
      : retest !== null
        ? {
            kind: "objective",
            label: TRACE_LABELS.objective,
            state: "partial",
            summary: `Retest round ${retest.number}${retest.deficiencyReference !== null ? ` of ${retest.deficiencyReference}` : ""}: the round record states what is retested; no retest-specific objective is on the approved plan.`,
            items: [],
            href: input.hrefs.TEST ?? null,
          }
        : {
            kind: "objective",
            label: TRACE_LABELS.objective,
            state: "missing",
            summary: "No control objective is recorded on the test plan.",
            items: [],
            href: input.hrefs.PLAN ?? null,
          },
  );

  nodes.push(
    input.risk.trim() !== ""
      ? {
          kind: "risk",
          label: TRACE_LABELS.risk,
          state: "recorded",
          summary: input.risk.trim(),
          items: [input.risk.trim()],
          href: input.hrefs.PLAN ?? null,
        }
      : {
          kind: "risk",
          label: TRACE_LABELS.risk,
          state: "missing",
          summary: "No risk statement is recorded for this control.",
          items: [],
          href: input.hrefs.PLAN ?? null,
        },
  );

  const procedures = phase?.procedures ?? [];
  nodes.push({
    kind: "procedure",
    label: TRACE_LABELS.procedure,
    state: procedures.length > 0 ? "recorded" : "missing",
    summary:
      procedures.length > 0
        ? `${plural(procedures.length, "test procedure")}${phase !== null ? ` for ${phase.label.toLowerCase()}` : ""}`
        : retest !== null
          ? "No retest-specific procedures are approved on the plan; the interim procedures are not shown as the retest's."
          : "No test procedures are recorded on the plan.",
    items: procedures,
    href: input.hrefs.PLAN ?? null,
  });

  nodes.push({
    kind: "attribute",
    label: TRACE_LABELS.attribute,
    state: rows.length > 0 ? "recorded" : "missing",
    summary:
      rows.length > 0
        ? `${plural(rows.length, "test attribute")}${sheet === null ? " (approved; not yet on a test sheet)" : retest !== null ? " on the retest sheet, carried from the control's approved set" : ""}`
        : "No test attributes are approved.",
    items: rows.map((row) => `${row.code} ${row.attribute}`),
    href: input.hrefs.PLAN ?? null,
  });

  const requirementFiles = (phase?.requirements ?? []).flatMap((item) =>
    item.files.map((file) => file.name),
  );
  const citedFiles = new Set(rows.flatMap((row) => row.evidence));
  const sampleFiles = new Set(
    (sheet?.items ?? []).flatMap((item) =>
      (item.files ?? []).map((f) => f.fileName),
    ),
  );
  const requirements = phase?.requirements ?? [];
  const received = requirements.filter((item) => item.files.length > 0).length;
  if (retest !== null) {
    const files = new Set([...sampleFiles, ...citedFiles]);
    const requested =
      retest.requestStatus !== null &&
      ["PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"].includes(
        retest.requestStatus,
      );
    nodes.push({
      kind: "evidence",
      label: TRACE_LABELS.evidence,
      state: files.size > 0 ? "recorded" : requested ? "partial" : "missing",
      summary:
        files.size > 0
          ? `${plural(files.size, "file")} on the retest samples; ${plural(citedFiles.size, "file")} cited by results. The interim evidence requirements are not the retest's.`
          : requested
            ? "The retest request is received; no file is on a retest sample yet."
            : `No evidence for the retest yet${retest.requestStatus !== null ? ` (request ${retest.requestStatus.toLowerCase().replaceAll("_", " ")})` : ""}.`,
      items: [...files],
      href: input.hrefs.TEST ?? null,
    });
  } else {
    nodes.push({
      kind: "evidence",
      label: TRACE_LABELS.evidence,
      state:
        requirementFiles.length === 0 && citedFiles.size === 0
          ? "missing"
          : requirements.length > 0 && received < requirements.length
            ? "partial"
            : "recorded",
      summary:
        requirementFiles.length === 0 && citedFiles.size === 0
          ? "No evidence is on file for this phase."
          : `${plural(requirementFiles.length, "file")} on ${plural(requirements.length, "evidence requirement")} (${received} with evidence); ${plural(citedFiles.size, "file")} cited by results`,
      items: [...new Set([...requirementFiles, ...citedFiles])],
      href: input.hrefs.REQUEST ?? null,
    });
  }

  const tested = sheet?.counts.tested ?? 0;
  const items = sheet?.counts.items ?? 0;
  const pass = rows.reduce((n, row) => n + row.pass, 0);
  const exceptions = rows.reduce((n, row) => n + row.exceptions, 0);
  const unable = rows.reduce((n, row) => n + row.unable, 0);
  const needsReview = rows.reduce((n, row) => n + row.review, 0);
  nodes.push({
    kind: "result",
    label: TRACE_LABELS.result,
    state:
      sheet === null || tested === 0
        ? "missing"
        : tested < items
          ? "partial"
          : "recorded",
    summary:
      sheet === null
        ? "No test sheet: nothing tested yet."
        : tested === 0
          ? `${plural(items, "sample")} selected; none tested yet.`
          : `${tested} of ${plural(items, "sample")} tested: ${pass} pass, ${exceptions} exception${exceptions === 1 ? "" : "s"}, ${unable} insufficient evidence, ${needsReview} for review`,
    items: rows
      .filter((row) => row.pass + row.exceptions + row.unable + row.review > 0)
      .map(
        (row) =>
          `${row.code}: ${row.pass} pass, ${row.exceptions} exception${row.exceptions === 1 ? "" : "s"}${row.unable > 0 ? `, ${row.unable} insufficient` : ""}${row.review > 0 ? `, ${row.review} for review` : ""}`,
      ),
    href: input.hrefs.TEST ?? null,
  });

  const open = input.deficiencies.filter((item) => item.status !== "CLOSED");
  const proposal = sheet?.proposal ?? null;
  nodes.push({
    kind: "exception",
    label: TRACE_LABELS.exception,
    state:
      sheet === null || tested === 0
        ? "missing"
        : exceptions > 0 &&
            open.length === 0 &&
            sheet.proposalStatus !== "DISMISSED"
          ? "partial"
          : "recorded",
    summary:
      sheet === null || tested === 0
        ? "No results, so no exceptions yet."
        : exceptions === 0
          ? "No exceptions in the tested samples."
          : open.length > 0
            ? `${plural(exceptions, "exception")} → ${open.map((item) => `${item.reference} (${item.status.toLowerCase().replaceAll("_", " ")})`).join(", ")}`
            : sheet.proposalStatus === "DISMISSED"
              ? `${plural(exceptions, "exception")}; the proposed deficiency was dismissed by a person${sheet.proposalReason !== "" ? `: ${sheet.proposalReason}` : ""}`
              : proposal !== null
                ? `${plural(exceptions, "exception")}; a deficiency is proposed (${proposal.title}), not yet logged`
                : `${plural(exceptions, "exception")}; no deficiency proposed or logged yet`,
    items: rows
      .filter((row) => row.exceptions > 0)
      .map((row) => `${row.code}: ${row.exceptionItems.join(", ")}`),
    href: input.hrefs.CONCLUDE ?? null,
  });

  const sheetConclusion = sheet?.conclusion ?? null;
  nodes.push({
    kind: "conclusion",
    label: TRACE_LABELS.conclusion,
    state:
      input.conclusion !== "NOT_CONCLUDED"
        ? "recorded"
        : sheetConclusion !== null
          ? "partial"
          : "missing",
    summary:
      input.conclusion !== "NOT_CONCLUDED"
        ? `${input.conclusion === "EFFECTIVE" ? "Effective" : "Concluded with exceptions"}, on the signed-off review`
        : sheetConclusion !== null
          ? `Testing signed off ${sheetConclusion === "EFFECTIVE" ? "effective" : "not effective"}${sheet?.signedBy ? ` by ${sheet.signedBy}` : ""}; the conclusion waits for the review`
          : "No conclusion: the testing is not signed off.",
    items: [],
    href: input.hrefs.CONCLUDE ?? null,
  });

  nodes.push(
    review === null
      ? {
          kind: "review",
          label: TRACE_LABELS.review,
          state: "missing",
          summary: "No independent review has opened.",
          items: [],
          href: input.hrefs.REVIEW ?? null,
        }
      : review.status === "SIGNED_OFF"
        ? {
            kind: "review",
            label: TRACE_LABELS.review,
            state: "recorded",
            summary: `Signed off by ${review.signedBy ?? "the reviewer"}; ${plural(review.notes.length, "note")} decided`,
            items: review.notes.map(
              (note) =>
                `#${note.number} ${note.status.toLowerCase()}: ${note.text}`,
            ),
            href: input.hrefs.REVIEW ?? null,
          }
        : {
            kind: "review",
            label: TRACE_LABELS.review,
            state: "partial",
            summary: `Open: ${plural(review.notes.filter((note) => note.status === "PROPOSED").length, "note")} to decide${review.blocking.length > 0 ? `; ${review.blocking[0]}` : ""}`,
            items: review.notes.map(
              (note) =>
                `#${note.number} ${note.status.toLowerCase()}: ${note.text}`,
            ),
            href: input.hrefs.REVIEW ?? null,
          },
  );
  return nodes;
}

/** The links that are missing or only partly supported, for the report and the rail. */
export function unsupportedLinks(nodes: TraceNode[]): string[] {
  return nodes
    .filter((node) => node.state !== "recorded")
    .map((node) => `${node.label}: ${node.summary}`);
}

/** The rail's one-line verdict: how many links lack a record, or are only partly on
 * record, or that every link has one. */
export function traceSummary(nodes: TraceNode[]): string {
  const missing = nodes.filter((node) => node.state === "missing").length;
  const partial = nodes.filter((node) => node.state === "partial").length;
  if (missing > 0) {
    return `${missing} link${missing === 1 ? "" : "s"} without a record`;
  }
  if (partial > 0) {
    return `${partial} link${partial === 1 ? "" : "s"} partly on record`;
  }
  return "Every link has a record";
}
