/**
 * A control's test sheet (Milestone 8.2): every item, its evidence, and the tester's
 * result for each attribute, with a person's overrides. The conclusion comes from the
 * API, derived from the final results; this only shapes it and builds the writes.
 */

import type { EvidenceCitation } from "./evidence-preview-model.ts";
import { type Automation, executionOf } from "./execution-model.ts";
import {
  type CancelState,
  parseCancelState,
  parseRunState,
  type RunState,
} from "./run-state.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREDENTIAL =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password\s*[:=]|private[_-]?key)/i;

// UNABLE is stored for "insufficient evidence"; REVIEW is "human review required".
export type Result =
  | "PASS"
  | "EXCEPTION"
  | "UNABLE"
  | "REVIEW"
  | "NOT_APPLICABLE";
export const RESULTS: readonly Result[] = [
  "PASS",
  "EXCEPTION",
  "UNABLE",
  "REVIEW",
  "NOT_APPLICABLE",
];
export const RESULT_LABELS: Record<Result, string> = {
  PASS: "Pass",
  EXCEPTION: "Exception",
  UNABLE: "Insufficient evidence",
  REVIEW: "Human review required",
  NOT_APPLICABLE: "Not applicable",
};
export const RESULT_MARKS: Record<Result, string> = {
  PASS: "✓",
  EXCEPTION: "✕",
  UNABLE: "?",
  REVIEW: "!",
  NOT_APPLICABLE: "n/a",
};

export type SheetCell = {
  index: number;
  proposed: Result | null;
  note: string;
  final: Result | null;
  overrideReason: string;
  overriddenBy: string | null;
  /** The passages the tester relied on, checked against each file's text. */
  citations: EvidenceCitation[];
};

const CITED_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A result's citations, labelled with its attribute (A1, A2, ...). */
export function cellCitations(
  value: unknown,
  index: number,
): EvidenceCitation[] {
  return (Array.isArray(value) ? value : [])
    .filter(isRecord)
    .filter(
      (item) =>
        typeof item.file_id === "string" &&
        CITED_FILE.test(item.file_id) &&
        typeof item.quote === "string",
    )
    .slice(0, 4)
    .map((item) => {
      const box = isRecord(item.box) ? item.box : null;
      const fraction = (key: string) =>
        box !== null && typeof box[key] === "number"
          ? (box[key] as number)
          : -1;
      const parsed = {
        x: fraction("x"),
        y: fraction("y"),
        w: fraction("w"),
        h: fraction("h"),
      };
      const valid =
        parsed.x >= 0 &&
        parsed.y >= 0 &&
        parsed.w > 0 &&
        parsed.h > 0 &&
        parsed.x + parsed.w <= 1.001 &&
        parsed.y + parsed.h <= 1.001;
      return {
        fileId: String(item.file_id),
        fileName: typeof item.file_name === "string" ? item.file_name : "",
        quote: String(item.quote).slice(0, 300),
        found: item.found !== false,
        location: typeof item.location === "string" ? item.location : "",
        page:
          typeof item.page === "number" && Number.isInteger(item.page)
            ? item.page
            : null,
        box: valid ? parsed : null,
        label: `A${index + 1}`,
      };
    });
}

export type SheetItem = {
  id: string;
  position: number;
  label: string;
  detail: Array<{ column: string; value: string }>;
  files: Array<{ id: string; fileName: string }>;
  state: "NO_EVIDENCE" | "WAITING" | "TESTED";
  source: string | null;
  note: string;
  cells: SheetCell[];
  version: number;
};

export type Placement = {
  fileId: string;
  fileName: string;
  placement: "PLACED" | "UNPLACED" | "EXCLUDED";
  placedBy: "AGENT" | "PERSON";
  reason: string;
};

export type Proposal = {
  title: string;
  condition: string;
  criteria: string;
  cause: string;
  effect: string;
  severity: string;
  severityReason: string;
};

export type TestSheet = {
  id: string;
  controlId: string;
  controlRef: string;
  method: "SAMPLE" | "TEST_OF_ONE";
  attributes: string[];
  status: "OPEN" | "SIGNED_OFF";
  running: boolean;
  runState: RunState;
  /** Why the last run stopped before finishing, or "" (an agent execution failure, not
   * a testing failure: exceptions in the results are results). */
  runNote: string;
  /** A person's cancellation of the run, when one is pending or was the last outcome. */
  cancelState?: CancelState;
  proposedConclusion: "EFFECTIVE" | "NOT_EFFECTIVE" | "INCOMPLETE";
  conclusion: "EFFECTIVE" | "NOT_EFFECTIVE" | null;
  signedBy: string | null;
  signedAt: string | null;
  signoffNote: string;
  items: SheetItem[];
  placements: Placement[];
  counts: {
    items: number;
    tested: number;
    noEvidence: number;
    exceptions: number;
    unable: number;
    review: number;
    unplaced: number;
  };
  blocking: string[];
  proposal: Proposal | null;
  proposalStatus: "NONE" | "PROPOSED" | "LOGGED" | "DISMISSED";
  proposalReason: string;
  deficiencyReference: string | null;
  version: number;
  /** The roll-forward or retest round this sheet is for; null for interim testing. */
  testRoundId: string | null;
  roundKind: "ROLLFORWARD" | "RETEST" | null;
  /** Why the tester waits for this control (its readiness), or "". */
  waitingNote: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const num = (value: unknown): number => (typeof value === "number" ? value : 0);
const result = (value: unknown): Result | null =>
  RESULTS.find((item) => item === value) ?? null;

export function parseSheets(value: unknown): TestSheet[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const sheets: TestSheet[] = [];
  for (const raw of value) {
    if (
      !isRecord(raw) ||
      typeof raw.id !== "string" ||
      !UUID.test(raw.id) ||
      typeof raw.control_id !== "string" ||
      !Array.isArray(raw.items) ||
      !Array.isArray(raw.attributes)
    ) {
      return null;
    }
    const counts = isRecord(raw.counts) ? raw.counts : {};
    const proposal = isRecord(raw.proposal) ? raw.proposal : null;
    sheets.push({
      id: raw.id,
      controlId: raw.control_id,
      controlRef: str(raw.control_ref),
      method: raw.method === "TEST_OF_ONE" ? "TEST_OF_ONE" : "SAMPLE",
      attributes: raw.attributes.map(str),
      status: raw.status === "SIGNED_OFF" ? "SIGNED_OFF" : "OPEN",
      running: raw.running === true,
      runState: parseRunState(raw.run_state, raw.running === true),
      runNote: typeof raw.run_note === "string" ? raw.run_note : "",
      cancelState: parseCancelState(raw.cancel_state),
      proposedConclusion:
        raw.proposed_conclusion === "EFFECTIVE" ||
        raw.proposed_conclusion === "NOT_EFFECTIVE"
          ? raw.proposed_conclusion
          : "INCOMPLETE",
      conclusion:
        raw.conclusion === "EFFECTIVE" || raw.conclusion === "NOT_EFFECTIVE"
          ? raw.conclusion
          : null,
      signedBy: typeof raw.signed_by === "string" ? raw.signed_by : null,
      signedAt: typeof raw.signed_at === "string" ? raw.signed_at : null,
      signoffNote: str(raw.signoff_note),
      items: raw.items.filter(isRecord).map((item) => ({
        id: str(item.id),
        position: num(item.position),
        label: str(item.label),
        detail: (Array.isArray(item.detail) ? item.detail : [])
          .filter(isRecord)
          .map((entry) => ({
            column: str(entry.column),
            value: str(entry.value),
          })),
        files: (Array.isArray(item.files) ? item.files : [])
          .filter(isRecord)
          .map((entry) => ({
            id: str(entry.id),
            fileName: str(entry.file_name),
          })),
        state:
          item.state === "TESTED" || item.state === "WAITING"
            ? item.state
            : "NO_EVIDENCE",
        source: typeof item.source === "string" ? item.source : null,
        note: str(item.note),
        cells: (Array.isArray(item.cells) ? item.cells : [])
          .filter(isRecord)
          .map((cell) => ({
            index: num(cell.index),
            proposed: result(cell.proposed),
            note: str(cell.note),
            final: result(cell.final),
            overrideReason: str(cell.override_reason),
            overriddenBy:
              typeof cell.overridden_by === "string"
                ? cell.overridden_by
                : null,
            citations: cellCitations(cell.citations, num(cell.index)),
          })),
        version: num(item.version),
      })),
      placements: (Array.isArray(raw.placements) ? raw.placements : [])
        .filter(isRecord)
        .map((entry) => ({
          fileId: str(entry.file_id),
          fileName: str(entry.file_name),
          placement:
            entry.placement === "PLACED" || entry.placement === "EXCLUDED"
              ? entry.placement
              : "UNPLACED",
          placedBy: entry.placed_by === "PERSON" ? "PERSON" : "AGENT",
          reason: str(entry.reason),
        })),
      counts: {
        items: num(counts.items),
        tested: num(counts.tested),
        noEvidence: num(counts.no_evidence),
        exceptions: num(counts.exceptions),
        unable: num(counts.unable),
        review: num(counts.review),
        unplaced: num(counts.unplaced),
      },
      blocking: (Array.isArray(raw.blocking) ? raw.blocking : []).map(str),
      proposal:
        proposal === null
          ? null
          : {
              title: str(proposal.title),
              condition: str(proposal.condition),
              criteria: str(proposal.criteria),
              cause: str(proposal.cause),
              effect: str(proposal.effect),
              severity: str(proposal.severity),
              severityReason: str(proposal.severity_reason),
            },
      proposalStatus:
        raw.proposal_status === "PROPOSED" ||
        raw.proposal_status === "LOGGED" ||
        raw.proposal_status === "DISMISSED"
          ? raw.proposal_status
          : "NONE",
      proposalReason: str(raw.proposal_reason),
      deficiencyReference:
        typeof raw.deficiency_reference === "string"
          ? raw.deficiency_reference
          : null,
      version: num(raw.version),
      testRoundId:
        typeof raw.test_round_id === "string" ? raw.test_round_id : null,
      roundKind:
        raw.round_kind === "ROLLFORWARD" || raw.round_kind === "RETEST"
          ? raw.round_kind
          : null,
      waitingNote: typeof raw.waiting_note === "string" ? raw.waiting_note : "",
    });
  }
  return sheets;
}

export function sheetFor(
  sheets: readonly TestSheet[] | null,
  controlId: string,
): TestSheet | null {
  // Interim testing's sheet; a round's sheet shows with its round.
  return (
    sheets?.find(
      (sheet) => sheet.controlId === controlId && sheet.testRoundId === null,
    ) ?? null
  );
}

/** The headline for a sheet: where it stands, in one line. A queued or working run is
 * "running" only when an agent worker exists (execution-model); otherwise automation is
 * unavailable and the headline says so. */
export function sheetHeadline(
  sheet: TestSheet,
  automation: Automation | null = null,
): {
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
} {
  if (sheet.status === "SIGNED_OFF") {
    return sheet.conclusion === "EFFECTIVE"
      ? { label: "Signed off · effective", tone: "success" }
      : { label: "Signed off · not effective", tone: "danger" };
  }
  if (!sheet.running && sheet.runNote !== "") {
    return { label: "Tester run stopped · run again", tone: "warning" };
  }
  if (sheet.running) {
    const run = executionOf({
      agent: "tester",
      run: sheet.runState,
      automation,
    });
    return run.state === "RUNNING"
      ? { label: "The tester is running", tone: "info" }
      : run.state === "QUEUED"
        ? { label: "Queued for the tester", tone: "info" }
        : { label: "Run queued · automation unavailable", tone: "warning" };
  }
  if (sheet.proposedConclusion === "EFFECTIVE") {
    return { label: "Ready to sign off · no exceptions", tone: "success" };
  }
  if (sheet.proposedConclusion === "NOT_EFFECTIVE") {
    return { label: "Ready to sign off · exceptions found", tone: "danger" };
  }
  return { label: "Testing in progress", tone: "warning" };
}

// Writes

export type SheetIntent =
  | "retest"
  | "link"
  | "unlink"
  | "exclude"
  | "include"
  | "override"
  | "sign-off"
  | "reopen"
  | "log"
  | "dismiss";

export type SheetWrite =
  | { error: "invalid" }
  | {
      intent: SheetIntent;
      path: string;
      body: Record<string, unknown>;
      controlId: string | null;
    };

const SEVERITIES = new Set([
  "CONTROL_DEFICIENCY",
  "SIGNIFICANT_DEFICIENCY",
  "MATERIAL_WEAKNESS",
]);

export function sheetWrite(fields: Record<string, string>): SheetWrite {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const sheetId = fields.sheet_id ?? "";
  const intent = fields.intent ?? "";
  const controlId = UUID.test(fields.control_id ?? "")
    ? (fields.control_id ?? null)
    : null;
  const raw = fields.version ?? "";
  if (
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    !UUID.test(sheetId)
  ) {
    return { error: "invalid" };
  }
  const base = `/organizations/${organizationId}/projects/${projectId}/test-sheets/${sheetId}`;
  const version =
    /^\d{1,6}$/.test(raw) && Number(raw) >= 1 ? Number(raw) : null;
  const reason = (fields.reason ?? "").trim();
  const text = (value: string) =>
    value.length <= 1000 && !CREDENTIAL.test(value);
  if (
    intent === "link" ||
    intent === "unlink" ||
    intent === "exclude" ||
    intent === "include"
  ) {
    const fileId = fields.file_id ?? "";
    const itemId = fields.item_id ?? "";
    const needsItem = intent === "link" || intent === "unlink";
    if (
      !UUID.test(fileId) ||
      (needsItem && !UUID.test(itemId)) ||
      reason.length > 300 ||
      !text(reason)
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${base}/links`,
      body: {
        file_id: fileId,
        item_id: needsItem ? itemId : null,
        action: intent.toUpperCase(),
        reason,
      },
      controlId,
    };
  }
  if (version === null) {
    return { error: "invalid" };
  }
  if (intent === "retest") {
    return { intent, path: `${base}/retest`, body: { version }, controlId };
  }
  if (intent === "override") {
    const itemId = fields.item_id ?? "";
    const index = fields.index ?? "";
    const chosen = RESULTS.find((item) => item === fields.result);
    if (
      !UUID.test(itemId) ||
      !/^\d{1,2}$/.test(index) ||
      chosen === undefined ||
      reason.length < 3 ||
      reason.length > 500 ||
      !text(reason)
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${base}/items/${itemId}/override`,
      body: { version, index: Number(index), result: chosen, reason },
      controlId,
    };
  }
  if (intent === "sign-off") {
    const note = (fields.note ?? "").trim();
    if (!text(note)) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${base}/sign-off`,
      body: { version, note },
      controlId,
    };
  }
  if (intent === "reopen") {
    if (reason.length < 3 || reason.length > 500 || !text(reason)) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${base}/reopen`,
      body: { version, reason },
      controlId,
    };
  }
  if (intent === "dismiss") {
    if (reason.length < 3 || reason.length > 500 || !text(reason)) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${base}/deficiency`,
      body: { version, action: "DISMISS", reason },
      controlId,
    };
  }
  if (intent === "log") {
    const body: Record<string, unknown> = { version, action: "LOG" };
    for (const key of ["title", "condition", "criteria", "cause", "effect"]) {
      const value = (fields[key] ?? "").trim();
      if (value.length > 4000 || CREDENTIAL.test(value)) {
        return { error: "invalid" };
      }
      if (value !== "") {
        body[key] = value;
      }
    }
    const severity = fields.severity ?? "";
    if (severity !== "") {
      if (!SEVERITIES.has(severity)) {
        return { error: "invalid" };
      }
      body.severity = severity;
    }
    return { intent, path: `${base}/deficiency`, body, controlId };
  }
  return { error: "invalid" };
}

export type SheetNotice =
  | "sheet-retest"
  | "sheet-linked"
  | "sheet-overridden"
  | "sheet-signed"
  | "sheet-reopened"
  | "sheet-logged"
  | "sheet-dismissed"
  | "sheet-blocked"
  | "sheet-denied"
  | "sheet-invalid"
  | "sheet-unavailable";

export const SHEET_NOTICES: Record<SheetNotice, string> = {
  "sheet-retest":
    "The tester is testing the items again. Results appear as they finish.",
  "sheet-linked": "Evidence updated. The tester tests the changed items again.",
  "sheet-overridden": "Result saved with your reason.",
  "sheet-signed":
    "Testing signed off. The conclusion follows the final results.",
  "sheet-reopened": "The test sheet is open again.",
  "sheet-logged":
    "Deficiency logged in the register, with its source in testing.",
  "sheet-dismissed": "Proposed deficiency dismissed. Your reason is recorded.",
  "sheet-blocked":
    "That could not be done yet: the sheet changed, is still being tested, or has open results. Refresh and check what is left.",
  "sheet-denied": "Your role cannot change this test sheet.",
  "sheet-invalid":
    "Check the fields. A reason is needed to override, reopen, or dismiss.",
  "sheet-unavailable": "That could not be saved. Try again.",
};

const DONE: Record<SheetIntent, SheetNotice> = {
  retest: "sheet-retest",
  link: "sheet-linked",
  unlink: "sheet-linked",
  exclude: "sheet-linked",
  include: "sheet-linked",
  override: "sheet-overridden",
  "sign-off": "sheet-signed",
  reopen: "sheet-reopened",
  log: "sheet-logged",
  dismiss: "sheet-dismissed",
};

export function sheetNoticeFor(
  intent: SheetIntent,
  status: number,
): SheetNotice {
  if (status === 200) {
    return DONE[intent];
  }
  if (status === 409) {
    return "sheet-blocked";
  }
  if (status === 403 || status === 404) {
    return "sheet-denied";
  }
  if (status === 422) {
    return "sheet-invalid";
  }
  return "sheet-unavailable";
}

export function parseSheetNotice(value: string | null): SheetNotice | null {
  return (
    (Object.keys(SHEET_NOTICES) as SheetNotice[]).find(
      (notice) => notice === value,
    ) ?? null
  );
}
