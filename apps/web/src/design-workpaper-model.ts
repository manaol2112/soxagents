/**
 * The D&I workpaper in three views (docs/design-workpaper.md): one record, shown as a
 * formal document, as a test matrix, or with its evidence beside it. The server assembles
 * what the views are built from (section 2 of the contract); this reads that answer and
 * arranges it. It decides nothing: an attribute's state, a file's mark, the conclusion and
 * who may edit are the server's, and nothing here prepares, signs or approves.
 */

import {
  type ChoiceFacts,
  CONCLUSION_WORDS,
  type ConclusionChoice,
  type ConclusionKind,
  type ConclusionResult,
  conclusionChoiceOf,
  conclusionKindOf,
  conclusionResultOf,
  type ResultKind,
} from "./design-conclusion-model.ts";
import {
  type Observation,
  observationsOf,
  type Point,
  pointsOf,
} from "./design-points-model.ts";
import { fileQuery } from "./evidence-preview-model.ts";
import { formatDate } from "./format.ts";

/* The section numbers of the Document view (docs/design-workpaper.md, section 3.10): the
 * one source of truth, kept in a module without imports so the models this one imports
 * read it too without an import cycle. */
export {
  DW_SECTION,
  DW_TICKMARKS_ORDER,
  type DwSection,
} from "./design-workpaper-sections.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An evidence reference: E1, E2, … in the order of the evidence index. */
const REF = /^E[1-9]\d{0,2}$/;

/* The views, and the one a browser remembers ------------------------------------------ */

/** The document, the matrix, the evidence, and every review note of the workpaper
 * (docs/workpaper-review.md, section 6). */
export type ViewKey = "document" | "matrix" | "evidence" | "notes";

export const VIEWS: ReadonlyArray<{
  key: ViewKey;
  label: string;
  hint: string;
}> = [
  {
    key: "document",
    label: "Document",
    hint: "The formal workpaper, as it prints",
  },
  {
    key: "matrix",
    label: "Matrix",
    hint: "Each attribute against each file",
  },
  {
    key: "evidence",
    label: "Evidence",
    hint: "The workpaper with its evidence beside it",
  },
  {
    key: "notes",
    label: "Notes",
    hint: "Every review note, with search and filters",
  },
];

/** Where the browser keeps the choice. The address bar is never changed. */
export const VIEW_KEY = "aw.design-workpaper.view";

/** A stored or typed value as a view; anything else is the document. */
export function viewFrom(value: unknown): ViewKey {
  return VIEWS.find((view) => view.key === value)?.key ?? "document";
}

type ReadStore = { getItem: (key: string) => string | null };
type WriteStore = { setItem: (key: string, value: string) => void };

/** The view this browser last chose. `open` hands over the browser's store (reaching for
 * it can itself be refused); a browser that keeps nothing, or refuses to be read (private
 * browsing, a blocked store), gets the document. */
export function rememberedView(
  open: () => ReadStore | null | undefined,
): ViewKey {
  try {
    return viewFrom(open()?.getItem(VIEW_KEY) ?? null);
  } catch {
    return "document";
  }
}

/** Keeps the choice; a store that refuses is left alone, and the view still changes. */
export function rememberView(
  open: () => WriteStore | null | undefined,
  view: ViewKey,
): void {
  try {
    open()?.setItem(VIEW_KEY, view);
  } catch {
    // Nothing to keep it in: the choice lasts for this visit only.
  }
}

/** The view Left, Right, Home or End moves to from `current`; null for any other key (the
 * tab list is horizontal, so Up and Down stay the page's own). The arrows wrap round. */
export function viewForKey(current: ViewKey, key: string): ViewKey | null {
  const at = Math.max(
    0,
    VIEWS.findIndex((view) => view.key === current),
  );
  const to =
    key === "ArrowRight"
      ? (at + 1) % VIEWS.length
      : key === "ArrowLeft"
        ? (at - 1 + VIEWS.length) % VIEWS.length
        : key === "Home"
          ? 0
          : key === "End"
            ? VIEWS.length - 1
            : -1;
  return VIEWS[to]?.key ?? null;
}

/* What the server answers (section 2 of the contract) ---------------------------------- */

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "ai";

export const ATTRIBUTE_STATES = [
  "EXCEPTION",
  "SHOWN",
  "SHOWN_IN_PART",
  "NOT_SHOWN",
  "NOT_CONCLUDED",
  "NOT_TESTED",
  // A person's disposition of the attribute (docs/evidence-assurance.md, section 10.13),
  // read only where the checks do not show it themselves: never counted as shown.
  "SHOWN_ON_REVIEW",
  "NOT_APPLICABLE",
  "NOT_AVAILABLE",
  // A person's exception where the attribute would otherwise read as shown (by a check,
  // or by a closing disposition): never counted as shown, a point to settle, no tickmark.
  "EXCEPTION_RECORDED",
] as const;
/** OTHER: a state this page does not know. It is shown in the server's own words, in a
 * neutral tone, and counts as neither shown nor an exception. */
export type AttributeState = (typeof ATTRIBUTE_STATES)[number] | "OTHER";

/** REVIEWED: the file holds the person's annotation a "Shown, auditor's judgment" rests
 * on (section 10.13), never a check's "shows". */
export const MARKS = [
  "EXCEPTION",
  "SHOWS",
  "REVIEWED",
  "IDENTIFIES",
  "SOURCE",
] as const;
export type Mark = (typeof MARKS)[number] | "OTHER";

/** REVIEWED (†): on the auditor's review, with the reason recorded; only of an attribute
 * that reads "Shown, auditor's judgment". */
export const TICKMARKS = [
  "AGREED",
  "COMPARED",
  "REVIEWED",
  "EXCEPTION",
  "NONE",
] as const;
export type Tickmark = (typeof TICKMARKS)[number];

export type EvidenceEntry = {
  ref: string;
  fileId: string;
  fileName: string;
  kind: string;
  kindWords: string;
  /** The D&I request the file serves; null where the server names none, and the file then
   * opens without annotations. */
  requirementId: string | null;
  requirementTitle: string;
  annotations: number;
  reviewed: number;
  /** The gate's sentence where the current check left the file out. */
  leftOut: string | null;
  image: boolean;
  /** Where a person decided the file is not relied on (docs/evidence-assurance.md,
   * section 10.14): the server's sentence, "Not relied on, recorded by ... Reason: ...".
   * Absent where it sends none. */
  notReliedOn?: string;
  /** Where a person's decision that the file's reliability is established on review
   * stands (section 3.9): the server's sentence, the same words section 6 uses, so a file
   * no section 6 row names still says it on its line. Absent where it sends none. */
  established?: string;
};

export type Reference = {
  ref: string;
  annotationIds: string[];
  numbers: number[];
};

export type WalkStep = {
  number: number;
  when: string;
  step: string;
  who: string;
  evidence: string;
  result: string;
  refs: string[];
};

export type Attribute = {
  id: string;
  code: string;
  text: string;
  state: AttributeState;
  stateWords: string;
  basis: string;
  tickmark: Tickmark;
  refs: Reference[];
  marks: Record<string, Mark>;
  /** Exception marks on files the evidence index does not list: they have no cell or
   * chip to stand in, so the row says so in a line of its own. */
  strayExceptions: number;
  checks: string[];
  notes: string;
  /** How a current check shows an attribute that reads "Shown" (section 3.6): in the
   * records of an instance, or only as a document requires it; or that it is shown only
   * on files a person decided are not relied on (NOT_RELIED, whatever the attribute's
   * state reads); null otherwise, and for anything this page does not know. */
  shownBy: ShownBy | null;
  /** Where a person's tickmark stands without changing the attribute's state (the check
   * shows it, an exception, or not concluded; section 3.9): "Tickmark: “…”, by …, … .
   * Reason: …", the server's sentence. Absent where it sends none. */
  tickmarkNote?: string;
};

export type ShownBy = "IMPLEMENTATION" | "DESIGN" | "NOT_RELIED";

export type DesignWorkpaper = {
  control: {
    id: string;
    ref: string;
    title: string;
    system: string;
    engagement: string;
    area: string;
  };
  workpaper: {
    id: string;
    reference: string;
    status: "DRAFT" | "PREPARED" | "OTHER";
    drafting: boolean;
    version: number;
    shownVersion: number;
    currentVersion: number;
    preparedBy: string | null;
    preparedAt: string | null;
  } | null;
  review: {
    status: "NOT_READY" | "TO_SIGN" | "SIGNED_OFF" | "OUT_OF_DATE" | "OTHER";
    proposed: string | null;
    signedVerdict: string | null;
    signedBy: string | null;
    signedAt: string | null;
    outOfDate: string[];
  };
  risk: string;
  activity: string;
  facts: Array<{ label: string; value: string }>;
  understanding: string;
  procedures: string[];
  evidence: EvidenceEntry[];
  /** How many files on the evidence list the index does not list (section 3.9: said
   * under it, "N more files are not listed"); 0 where none. */
  evidenceMore: number;
  walkthrough: { columns: string[]; steps: WalkStep[]; source: string };
  attributes: Attribute[];
  reports: Array<{
    ref: string;
    report: string;
    source: string;
    procedure: string;
    /** Where a person established the reliability of the file the row names on their
     * review (section 10.14): the server's sentence (who, when and what was relied on),
     * sent with the mark INSPECTED. Absent otherwise. */
    inspected?: string;
  }>;
  /** What waits on a person, at its place (section 3.9): every point of this read, the
   * considered ones included. */
  points: Point[];
  /** The agent's observations: the draft of the message sent with the review request,
   * never part of the workpaper. */
  observations: Observation[];
  /** The viewer may consider a point, or withdraw a consideration, now: a person who may
   * update it, on the design workpaper's draft, not being drafted (the server's word). */
  canSettle: boolean;
  conclusion: {
    text: string;
    source: string;
    proposed: string | null;
    words: string;
    signed: boolean;
    /** The conclusion the records propose now, and why (section 3.6); null where the
     * server does not say, or says a kind this page does not know. */
    proposedConclusion: ConclusionKind | null;
    proposedReasons: string[];
    /** The preparer's conclusion that stands, or null. */
    choice: ConclusionChoice | null;
  };
  /** The design and the implementation result (section 3.6); null where not sent. */
  design: ConclusionResult | null;
  implementation: ConclusionResult | null;
  tickmarks: Array<{ mark: string; symbol: string; meaning: string }>;
  canEdit: boolean;
};

/** The most of each list this page reads: well above what the server sends (60 files,
 * 300 walkthrough rows, about 60 facts, 8 procedures), so nothing it sends is
 * cut, and a view shows every item it is given. */
export const LIMITS = {
  evidence: 240,
  steps: 600,
  facts: 120,
  procedures: 32,
  attributes: 240,
} as const;

type Raw = Record<string, unknown>;

const isRaw = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const raws = (value: unknown): Raw[] =>
  Array.isArray(value) ? value.filter(isRaw) : [];

/** A string as it is shown: trimmed, and never longer than a view can hold. */
const line = (value: unknown, max = 6000): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** A citation mark of a workpaper section ("[^3]"). The answer carries no list of the
 * citations, so a view shows the sentence without its marks; the citations themselves
 * stay in the section editor. */
const CITATION_MARK = /\s*\[\^\d{1,3}\]/g;

/** A section's text as it is shown: as stored, without its citation marks. */
export function uncited(text: string): string {
  return text.replace(CITATION_MARK, "").trim();
}

const prose = (value: unknown, max = 6000): string => uncited(line(value, max));

const lineOrNull = (value: unknown, max = 300): string | null => {
  const said = line(value, max);
  return said === "" ? null : said;
};

const lines = (value: unknown, most: number, max = 2000): string[] =>
  Array.isArray(value)
    ? value
        .map((item) => line(item, max))
        .filter((item) => item !== "")
        .slice(0, most)
    : [];

const count = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;

/** A record's own entry for a key the server supplied: never something inherited
 * ("constructor", "toString"), which is not a word of this page's. */
const own = <T>(record: Readonly<Record<string, T>>, key: string): T | null =>
  Object.hasOwn(record, key) ? (record[key] ?? null) : null;

const oneOf = <T extends string>(
  known: readonly T[],
  value: unknown,
): T | null => known.find((item) => item === value) ?? null;

/** A row's references: the ones the evidence index has, once each, in the row's order. */
function refsOf(value: unknown, known: ReadonlySet<string>): string[] {
  const found: string[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (typeof item === "string" && known.has(item) && !found.includes(item)) {
      found.push(item);
    }
  }
  return found;
}

function evidenceOf(value: unknown): EvidenceEntry[] {
  const entries: EvidenceEntry[] = [];
  for (const item of raws(value)) {
    const ref = line(item.ref, 8);
    const fileId = line(item.file_id, 40);
    // A reference opens a file: an entry that names neither properly is not one.
    if (
      !REF.test(ref) ||
      !UUID.test(fileId) ||
      entries.some((entry) => entry.ref === ref)
    ) {
      continue;
    }
    const requirementId = line(item.requirement_id, 40);
    entries.push({
      ref,
      fileId,
      fileName: line(item.file_name, 300) || "File",
      kind: line(item.kind, 60),
      kindWords: line(item.kind_words, 120),
      requirementId: UUID.test(requirementId) ? requirementId : null,
      requirementTitle: line(item.requirement_title, 300),
      annotations: count(item.annotations),
      // Never more reviewed than there are.
      reviewed: Math.min(count(item.reviewed), count(item.annotations)),
      leftOut: lineOrNull(item.left_out, 600),
      image: item.image === true,
      // A person's decision that the file is not relied on: the server's sentence.
      ...(line(item.not_relied_on, 1200) === ""
        ? {}
        : { notReliedOn: line(item.not_relied_on, 1200) }),
      // A person's decision that its reliability is established on review.
      ...(line(item.established, 1200) === ""
        ? {}
        : { established: line(item.established, 1200) }),
    });
    if (entries.length === LIMITS.evidence) {
      break;
    }
  }
  return entries;
}

/** What stands in for an attribute's wording where the server sends none. */
export const ATTRIBUTE_WITHOUT_TEXT = "Attribute text not stated";

/** The tickmark an attribute may carry: never more than its state says. Agreed and
 * compared stand only on an attribute that is shown, the exception mark only on an
 * exception; anything else, and any mark this page does not know, is no tickmark. */
function tickmarkFor(state: AttributeState, value: unknown): Tickmark {
  const mark = oneOf(TICKMARKS, value);
  if ((mark === "AGREED" || mark === "COMPARED") && state === "SHOWN") {
    return mark;
  }
  // The auditor's own review stands only on "Shown, auditor's judgment".
  if (mark === "REVIEWED" && state === "SHOWN_ON_REVIEW") {
    return mark;
  }
  return mark === "EXCEPTION" && state === "EXCEPTION" ? mark : "NONE";
}

function attributeOf(item: Raw, known: ReadonlySet<string>): Attribute | null {
  const id = line(item.id, 80);
  if (id === "") {
    return null;
  }
  const marks: Record<string, Mark> = {};
  let strayExceptions = 0;
  if (isRaw(item.marks)) {
    for (const [ref, mark] of Object.entries(item.marks)) {
      if (typeof mark !== "string" || mark === "") {
        continue;
      }
      if (known.has(ref)) {
        marks[ref] = oneOf(MARKS, mark) ?? "OTHER";
      } else if (mark === "EXCEPTION") {
        // An exception is never dropped because its file is not in the index.
        strayExceptions += 1;
      }
    }
  }
  const refs: Reference[] = [];
  for (const each of raws(item.refs)) {
    const ref = line(each.ref, 8);
    if (!known.has(ref) || refs.some((other) => other.ref === ref)) {
      continue;
    }
    refs.push({
      ref,
      annotationIds: lines(each.annotation_ids, 50, 40).filter((value) =>
        UUID.test(value),
      ),
      numbers: (Array.isArray(each.numbers) ? each.numbers : [])
        .filter(
          (value): value is number =>
            typeof value === "number" && Number.isInteger(value) && value > 0,
        )
        .slice(0, 50),
    });
  }
  const state = oneOf(ATTRIBUTE_STATES, item.state) ?? "OTHER";
  return {
    id,
    code: line(item.code, 8),
    // An attribute with an id is a row of the workpaper even where its wording is
    // missing: it is shown, and says its wording is not stated.
    text: line(item.text, 2000) || ATTRIBUTE_WITHOUT_TEXT,
    state,
    stateWords: line(item.state_words, 80),
    basis: line(item.basis, 2000),
    tickmark: tickmarkFor(state, item.tickmark),
    refs,
    marks,
    strayExceptions,
    checks: lines(item.checks, 20),
    notes: prose(item.notes, 4000),
    // Only of an attribute that reads "Shown": a way of being shown is never read into
    // another state. That it rests only on files not relied on is said whatever the
    // state reads: it takes nothing for shown.
    shownBy:
      item.shown_by === "NOT_RELIED"
        ? "NOT_RELIED"
        : state === "SHOWN"
          ? oneOf(["IMPLEMENTATION", "DESIGN"] as const, item.shown_by)
          : null,
    // A person's tickmark that does not change the state: the server's sentence.
    ...(line(item.tickmark_note, 1200) === ""
      ? {}
      : { tickmarkNote: line(item.tickmark_note, 1200) }),
  };
}

/** The walkthrough's rows, numbered as the server numbers them, or by position where
 * its numbers repeat (two rows would otherwise read as the same step). */
function stepsOf(value: unknown, known: ReadonlySet<string>): WalkStep[] {
  const steps = raws(value)
    .slice(0, LIMITS.steps)
    .map((step, index) => ({
      number:
        typeof step.number === "number" &&
        Number.isInteger(step.number) &&
        step.number > 0
          ? step.number
          : index + 1,
      // As written in the row: never parsed or reformatted.
      when: prose(step.when, 80),
      step: prose(step.step, 2000),
      who: prose(step.who, 300),
      evidence: prose(step.evidence, 2000),
      result: prose(step.result, 2000),
      refs: refsOf(step.refs, known),
    }))
    .filter(
      (step) => step.step !== "" || step.evidence !== "" || step.result !== "",
    );
  const numbers = new Set(steps.map((step) => step.number));
  return numbers.size === steps.length
    ? steps
    : steps.map((step, index) => ({ ...step, number: index + 1 }));
}

/**
 * The server's answer as the views read it, or null when it is not one (no control to
 * show it for). Everything else is read defensively: a list that is missing is empty, a
 * value this page does not know is kept as OTHER and shown in the server's words, and a
 * reference to a file the evidence index does not have is dropped, so no view can be
 * handed something it cannot draw.
 */
export function parseDesignWorkpaper(value: unknown): DesignWorkpaper | null {
  if (!isRaw(value) || !isRaw(value.control)) {
    return null;
  }
  const controlId = line(value.control.id, 40);
  if (!UUID.test(controlId)) {
    return null;
  }
  const evidence = evidenceOf(value.evidence);
  const known = new Set(evidence.map((entry) => entry.ref));
  const paper = isRaw(value.workpaper) ? value.workpaper : null;
  const paperId = paper === null ? "" : line(paper.id, 40);
  const review = isRaw(value.review) ? value.review : {};
  const walk = isRaw(value.walkthrough) ? value.walkthrough : {};
  const conclusion = isRaw(value.conclusion) ? value.conclusion : {};
  return {
    control: {
      id: controlId,
      ref: line(value.control.ref, 80),
      title: line(value.control.title, 400),
      system: line(value.control.system, 200),
      engagement: line(value.control.engagement, 200),
      area: line(value.control.area, 200),
    },
    workpaper:
      paper === null || !UUID.test(paperId)
        ? null
        : {
            id: paperId,
            reference: line(paper.reference, 120),
            status:
              oneOf(["DRAFT", "PREPARED"] as const, paper.status) ?? "OTHER",
            drafting: paper.drafting === true,
            version: count(paper.version),
            shownVersion: count(paper.shown_version),
            currentVersion: count(paper.current_version),
            preparedBy: lineOrNull(paper.prepared_by),
            preparedAt: lineOrNull(paper.prepared_at, 40),
          },
    review: {
      status:
        oneOf(
          ["NOT_READY", "TO_SIGN", "SIGNED_OFF", "OUT_OF_DATE"] as const,
          review.status,
        ) ?? "OTHER",
      proposed: lineOrNull(review.proposed, 40),
      signedVerdict: lineOrNull(review.signed_verdict, 40),
      signedBy: lineOrNull(review.signed_by),
      signedAt: lineOrNull(review.signed_at, 40),
      outOfDate: lines(review.out_of_date, 12, 400),
    },
    risk: line(value.risk),
    activity: line(value.activity),
    facts: raws(value.facts)
      .map((fact) => ({
        label: line(fact.label, 80),
        value: line(fact.value, 400),
      }))
      .filter((fact) => fact.label !== "" && fact.value !== "")
      .slice(0, LIMITS.facts),
    understanding: prose(value.understanding, 20000),
    procedures: lines(value.procedures, LIMITS.procedures),
    evidence,
    evidenceMore: count(value.evidence_more),
    walkthrough: {
      columns: lines(walk.columns, 12, 80),
      steps: stepsOf(walk.steps, known),
      source: line(walk.source, 40),
    },
    attributes: raws(value.attributes)
      .map((item) => attributeOf(item, known))
      .filter((item): item is Attribute => item !== null)
      // One row per attribute: a repeated id is the same attribute sent twice.
      .filter(
        (item, index, all) =>
          all.findIndex((other) => other.id === item.id) === index,
      )
      .slice(0, LIMITS.attributes)
      // An attribute with no letter is known by its place in the list, never by an
      // empty mark.
      .map((item, index) =>
        item.code === "" ? { ...item, code: String(index + 1) } : item,
      ),
    reports: raws(value.reports)
      .map((report) => ({
        ref: known.has(line(report.ref, 8)) ? line(report.ref, 8) : "",
        report: line(report.report, 400),
        source: line(report.source, 400),
        procedure: line(report.procedure, 2000),
        // The inspected mark only with the sentence that says who established it.
        ...(report.mark === "INSPECTED" && line(report.established, 1200) !== ""
          ? { inspected: line(report.established, 1200) }
          : {}),
      }))
      .filter((report) => report.report !== "")
      .slice(0, 40),
    points: pointsOf(value.points, known),
    observations: observationsOf(value.observations, known),
    canSettle: value.can_settle === true,
    conclusion: {
      text: prose(conclusion.text, 20000),
      source: line(conclusion.source, 40),
      proposed: lineOrNull(conclusion.proposed, 40),
      words: line(conclusion.words, 120),
      // Signed only when the server says so in as many words: anything else is proposed.
      signed: conclusion.signed === true,
      proposedConclusion: conclusionKindOf(conclusion.proposed_conclusion),
      proposedReasons: lines(conclusion.proposed_reasons, 12, 600),
      choice: conclusionChoiceOf(conclusion.choice),
    },
    design: conclusionResultOf(value.design),
    implementation: conclusionResultOf(value.implementation),
    tickmarks: raws(value.tickmarks)
      .map((mark) => ({
        mark: line(mark.mark, 40),
        symbol: line(mark.symbol, 4),
        meaning: line(mark.meaning, 300),
      }))
      .filter((mark) => mark.symbol !== "" && mark.meaning !== "")
      .slice(0, 12),
    canEdit: value.can_edit === true,
  };
}

/* The request ------------------------------------------------------------------------- */

export type WorkpaperScope = {
  organizationId: string;
  projectId: string;
  controlId: string;
};

/** The query the views read the workpaper with, through the proxy route. */
export function designWorkpaperQuery(scope: WorkpaperScope): string {
  return new URLSearchParams({
    organization: scope.organizationId,
    project: scope.projectId,
    control: scope.controlId,
  }).toString();
}

/** The API path that query names, or null when an id is not one. */
export function designWorkpaperPath(params: URLSearchParams): string | null {
  const id = (key: string): string | null => {
    const value = params.get(key) ?? "";
    return UUID.test(value) ? value : null;
  };
  const organization = id("organization");
  const project = id("project");
  const control = id("control");
  if (organization === null || project === null || control === null) {
    return null;
  }
  return `/organizations/${organization}/projects/${project}/controls/${control}/design-workpaper`;
}

/** What a person reads when the views could not be loaded; null when they were. Each
 * sentence says what to do next. */
export function loadProblem(status: number): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 401) {
    return "Your session has ended. Sign in again to see the workpaper.";
  }
  if (status === 403) {
    return "Your role cannot read this engagement's workpapers. Ask an administrator for access.";
  }
  if (status === 404) {
    return "This control is no longer in the engagement. Go back to the controls and open it again.";
  }
  if (status === 422 || status === 400) {
    return "The workpaper could not be found for this control. Refresh the page and try again.";
  }
  return "The workpaper views could not be loaded. Nothing was changed: try again.";
}

/** A file as the preview shows it: the same proxy route the evidence preview reads. */
export function previewUrl(scope: WorkpaperScope, fileId: string): string {
  return `/workspace/evidence-files/${fileId}/preview?${fileQuery(scope.organizationId, scope.projectId)}`;
}

/* Words -------------------------------------------------------------------------------- */

/** The Result of an attribute, as a workpaper says it (product owner, 15 November 2026):
 * "No exceptions noted" where the check shows it, "Exceptions noted" for an exception,
 * the check's or one a person recorded. They were "Shown", "Exception shown" and
 * "Exception recorded by the auditor". Every other state keeps its own words: nothing
 * is said to have no exception that was not shown. */
export const NO_EXCEPTIONS_NOTED = "No exceptions noted";
export const EXCEPTIONS_NOTED = "Exceptions noted";

const STATE_WORDS: Record<AttributeState, { words: string; tone: Tone }> = {
  EXCEPTION: { words: EXCEPTIONS_NOTED, tone: "danger" },
  SHOWN: { words: NO_EXCEPTIONS_NOTED, tone: "success" },
  SHOWN_IN_PART: { words: "Shown in part", tone: "warning" },
  NOT_SHOWN: { words: "Not shown", tone: "warning" },
  NOT_CONCLUDED: { words: "Not concluded", tone: "neutral" },
  NOT_TESTED: { words: "Not tested yet", tone: "neutral" },
  // A person's disposition: in its own words, never the plain "Shown", never green.
  SHOWN_ON_REVIEW: { words: "Shown, auditor's judgment", tone: "neutral" },
  NOT_APPLICABLE: { words: "Not applicable to this instance", tone: "neutral" },
  NOT_AVAILABLE: { words: "Evidence not available, accepted", tone: "neutral" },
  // An exception a person recorded: never "No exceptions noted", whatever the check
  // found. Who recorded it is said in the attribute's own sentence.
  EXCEPTION_RECORDED: { words: EXCEPTIONS_NOTED, tone: "danger" },
  OTHER: { words: "Not stated", tone: "neutral" },
};

/** The words of a known state: this page's, and the server's own for the states this
 * page words differently ("Shown", "Exception shown"). */
const KNOWN_STATE_WORDS = new Set(
  [
    ...ATTRIBUTE_STATES.map((state) => STATE_WORDS[state].words),
    "Shown",
    "Exception shown",
    "Exception recorded by the auditor",
  ].map((words) => words.toLowerCase()),
);

/**
 * An attribute's state in words, with its tone. A state this page knows is worded by
 * this page, whatever words the answer carries beside it, so "No exceptions noted" is
 * only ever said of SHOWN. A state it does not know is shown in the server's words, in a
 * neutral tone, unless those words are a known state's (an unknown state must not read
 * as "Shown" or "No exceptions noted"): it is then "Not stated".
 */
export function stateOf(attribute: Pick<Attribute, "state" | "stateWords">): {
  words: string;
  tone: Tone;
} {
  const known = STATE_WORDS[attribute.state];
  if (attribute.state !== "OTHER") {
    return { words: known.words, tone: known.tone };
  }
  const said = attribute.stateWords.trim();
  return {
    words:
      said === "" || KNOWN_STATE_WORDS.has(said.toLowerCase())
        ? known.words
        : said,
    tone: "neutral",
  };
}

/** What a file does for an attribute, as a symbol with its word: never colour alone. */
export const MARK_WORDS: Record<
  Mark,
  { symbol: string; word: string; meaning: string; tone: Tone }
> = {
  EXCEPTION: {
    symbol: "✗",
    word: "Exception",
    meaning: "Shows an exception to the attribute",
    tone: "danger",
  },
  SHOWS: {
    symbol: "✓",
    word: "Shows",
    meaning: "Shows the attribute",
    tone: "success",
  },
  REVIEWED: {
    symbol: "†",
    word: "Reviewed",
    meaning: "Holds the annotation the auditor's judgment rests on",
    tone: "neutral",
  },
  IDENTIFIES: {
    symbol: "●",
    word: "Identifies",
    meaning: "Identifies the person, system or date",
    tone: "info",
  },
  SOURCE: {
    symbol: "◊",
    word: "Source",
    meaning: "Report or source relied on",
    tone: "ai",
  },
  OTHER: {
    symbol: "•",
    word: "Referenced",
    meaning: "Referenced for the attribute",
    tone: "neutral",
  },
};

const TICKMARK_FALLBACK: Record<string, { symbol: string; meaning: string }> = {
  AGREED: {
    symbol: "✓",
    meaning: "Agreed to the system's own record, without exception.",
  },
  COMPARED: {
    symbol: "≡",
    meaning:
      "Dates or values compared in code, within what the attribute allows.",
  },
  REVIEWED: {
    symbol: "†",
    meaning: "On the auditor's review, with the reason recorded.",
  },
  EXCEPTION: { symbol: "✗", meaning: "Exception shown." },
};

const NO_TICKMARK = { symbol: "", meaning: "No tickmark" } as const;

/** A tickmark as the legend draws it: the server's legend first, then the three the
 * contract fixes for an attribute. No tickmark (NONE, or a mark this page does not know)
 * is empty before the legend is read, so the legend cannot give it a symbol, and it is
 * read aloud as "No tickmark". */
export function tickmarkOf(
  paper: Pick<DesignWorkpaper, "tickmarks">,
  mark: string,
): { symbol: string; meaning: string } {
  const fallback = own(TICKMARK_FALLBACK, mark);
  if (fallback === null) {
    return NO_TICKMARK;
  }
  const listed = paper.tickmarks.find((item) => item.mark === mark);
  return listed === undefined
    ? fallback
    : { symbol: listed.symbol, meaning: listed.meaning };
}

/** The legend under the document: the server's, else the marks the attributes use. */
export function tickmarkLegend(
  paper: Pick<DesignWorkpaper, "tickmarks" | "attributes">,
): Array<{ mark: string; symbol: string; meaning: string }> {
  const used = new Set(paper.attributes.map((attribute) => attribute.tickmark));
  if (paper.tickmarks.length > 0) {
    // The auditor's own review (†) is in the legend only where an attribute carries it.
    return paper.tickmarks.filter(
      (item) => item.mark !== "REVIEWED" || used.has("REVIEWED"),
    );
  }
  return TICKMARKS.filter((mark) => used.has(mark) && mark !== "NONE").map(
    (mark) => ({ mark, ...tickmarkOf(paper, mark) }),
  );
}

const VERDICT_WORDS: Record<string, string> = {
  EFFECTIVE: "Effective",
  NOT_EFFECTIVE: "Not effective",
};

const SOURCE_WORDS: Record<string, string> = {
  AGENT: "the agent",
  PERSON: "a person",
  RECORDS: "the records",
};

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/** "A", "A and C", "A, B and C". */
function listed(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

/* The header, the status and the conclusion -------------------------------------------- */

type Standing = Pick<DesignWorkpaper, "workpaper" | "review" | "conclusion">;

/**
 * Whether a reviewer's sign-off stands. The one rule every view reads: the server says
 * the conclusion is signed, its review is signed off, nothing is listed as out of date,
 * and there is a prepared workpaper for it to be the sign-off of. An answer that
 * disagrees with itself (signed on a draft, signed while "to sign", signed with reasons
 * it is out of date) is not signed: nothing then reads as signed, and no reviewer is
 * named.
 */
export function isSigned(paper: Standing): boolean {
  return (
    paper.conclusion.signed &&
    paper.review.status === "SIGNED_OFF" &&
    paper.review.outOfDate.length === 0 &&
    paper.workpaper !== null &&
    paper.workpaper.status === "PREPARED"
  );
}

/** Whether an earlier sign-off no longer stands: the server says so, or lists why. */
function isStale(paper: Standing): boolean {
  return (
    !isSigned(paper) &&
    (paper.review.status === "OUT_OF_DATE" || paper.review.outOfDate.length > 0)
  );
}

/** Where the workpaper stands, in a few words. A draft is never worded as prepared, and
 * a prepared workpaper is worded as signed off only where the sign-off stands. */
export function statusOf(paper: Standing): { words: string; tone: Tone } {
  const { workpaper } = paper;
  if (workpaper === null) {
    return { words: "No workpaper yet", tone: "neutral" };
  }
  if (workpaper.drafting) {
    return { words: "The agent is drafting", tone: "ai" };
  }
  if (workpaper.currentVersion === 0) {
    return { words: "Not drafted", tone: "neutral" };
  }
  if (workpaper.status === "DRAFT") {
    return { words: "Draft for the preparer", tone: "warning" };
  }
  if (workpaper.status !== "PREPARED") {
    return { words: "Status not stated", tone: "neutral" };
  }
  if (isSigned(paper)) {
    return { words: "Prepared and signed off", tone: "success" };
  }
  if (isStale(paper)) {
    return { words: "Prepared, sign-off out of date", tone: "warning" };
  }
  return { words: "Prepared, waiting for sign-off", tone: "warning" };
}

export type HeaderRow = {
  label: string;
  value: string;
  /** Not on record yet: shown in a quiet tone. */
  pending: boolean;
};

/** Who did something and when, as the records have it; null for what is not on record. */
export type Signature = { by: string | null; on: string | null };

/** The document's header block: who it is for, its reference, and who prepared and
 * reviewed it, or "Not yet". */
export function headerOf(paper: DesignWorkpaper): {
  eyebrow: string;
  control: { ref: string; title: string; system: string };
  rows: HeaderRow[];
  /** For the signature lines: a name and a date only where the records have them. A
   * reviewer is named only where the sign-off stands (`isSigned`). */
  prepared: Signature;
  reviewed: Signature;
  status: { words: string; tone: Tone };
  version: string;
} {
  const { control, workpaper, review } = paper;
  const day = (at: string | null) => (at === null ? null : formatDate(at));
  const prepared: Signature =
    workpaper === null || workpaper.preparedBy === null
      ? { by: null, on: null }
      : { by: workpaper.preparedBy, on: day(workpaper.preparedAt) };
  const reviewed: Signature =
    !isSigned(paper) || review.signedBy === null
      ? { by: null, on: null }
      : { by: review.signedBy, on: day(review.signedAt) };
  const row = (
    label: string,
    who: Signature,
    otherwise = "Not yet",
  ): HeaderRow => ({
    label,
    value:
      who.by === null
        ? otherwise
        : who.on === null
          ? who.by
          : `${who.by}, ${who.on}`,
    pending: who.by === null,
  });
  return {
    prepared,
    reviewed,
    eyebrow: [control.engagement, control.area]
      .filter((part) => part !== "")
      .join(" · "),
    control: { ref: control.ref, title: control.title, system: control.system },
    rows: [
      {
        label: "W/P reference",
        value: workpaper?.reference || "Not assigned yet",
        pending: !workpaper?.reference,
      },
      {
        label: "Engagement",
        value: control.engagement || "Not stated",
        pending: control.engagement === "",
      },
      row("Prepared by", prepared),
      row(
        "Reviewed by",
        reviewed,
        isStale(paper) ? "Sign-off out of date" : "Not yet",
      ),
    ],
    status: statusOf(paper),
    version:
      workpaper === null || workpaper.currentVersion === 0
        ? ""
        : workpaper.shownVersion === workpaper.currentVersion ||
            workpaper.shownVersion === 0
          ? `Version ${workpaper.currentVersion}`
          : `Version ${workpaper.shownVersion} of ${workpaper.currentVersion}`,
  };
}

/** The standing every proposed conclusion carries, in every view. */
export const PROPOSED_BY_AGENT = "Proposed by the agent, not signed";

/** What stands in the verdict's place until the records propose one. */
export const NOT_CONCLUDED = "Not concluded yet";

/** Where a link from another step lands: section 7 of the document, the conclusion
 * (docs/design-workpaper.md, section 3.5). */
export const CONCLUSION_ANCHOR = "di-conclusion";

/** "/?…#di-conclusion": D&I Assessment, at section 7. */
export function conclusionHref(assessmentHref: string): string {
  return `${assessmentHref.split("#")[0] ?? assessmentHref}#${CONCLUSION_ANCHOR}`;
}

/** The pill of the agent's proposal in section 7 until the preparer records a
 * conclusion (docs/design-workpaper.md, sections 3.5 and 3.6). */
export const PROPOSED_REVIEW = "Proposed by the agent · review it";

export type ConclusionView = {
  /** A reviewer's sign-off stands (`isSigned`). */
  signed: boolean;
  /** The preparer's conclusion is recorded and no sign-off of it stands (section 3.6). */
  recorded: boolean;
  /** The conclusion it speaks of, where the server names one of the five; null for the
   * two-value verdict of an answer from before section 3.6. */
  kind: ConclusionKind | null;
  /** The records propose a verdict that no reviewer has signed. */
  proposed: boolean;
  /** An earlier sign-off no longer stands. */
  stale: boolean;
  /** "Effective", or '' where the records propose nothing yet. */
  verdict: string;
  /** "Proposed: Effective", "Signed: Effective", or "Not concluded yet". */
  headline: string;
  /** Who stands behind it: "Proposed by the agent, not signed", who signed and when, that
   * the sign-off is out of date, or when a verdict will be proposed. */
  standing: string;
  tone: Tone;
  text: string;
  /** Why a sign-off no longer stands, in the server's sentences. */
  outOfDate: string[];
};

/**
 * The conclusion as every view words it. Three things it can be, and they never read
 * alike: signed (only where the sign-off stands: `isSigned`), proposed (the records
 * propose a verdict, which is so once the workpaper is prepared: it reads "Proposed", in
 * the tone of agent output, never the tone of something approved), or not concluded yet
 * (a draft: no verdict is worded at all). A sign-off that is out of date is said to be
 * out of date, with who signed, and is never shown as signed.
 *
 * A verdict is worded by this page from its code ("Effective", "Not effective"); the
 * answer's own words stand in only for a code this page does not know.
 */
export function conclusionOf(paper: Standing): ConclusionView {
  const { conclusion, review } = paper;
  const by = review.signedBy === null ? "" : ` by ${review.signedBy}`;
  const on =
    review.signedAt === null ? "" : ` on ${formatDate(review.signedAt)}`;
  const said =
    conclusion.words !== "" && conclusion.words !== NOT_CONCLUDED
      ? conclusion.words
      : "";
  const worded = (code: string | null): string =>
    code === null ? "" : (own(VERDICT_WORDS, code) ?? said);
  const common = {
    text: conclusion.text,
    outOfDate: review.outOfDate,
    recorded: false,
    kind: null,
  };
  const choice = conclusion.choice;
  if (isSigned(paper) && choice !== null) {
    // Section 3.6: the reviewer signed the preparer's conclusion, which still stands (a
    // changed one puts the sign-off out of date, so it is not signed here).
    const verdict = CONCLUSION_WORDS[choice.kind];
    return {
      ...common,
      kind: choice.kind,
      signed: true,
      proposed: false,
      stale: false,
      verdict,
      headline: `Signed: ${verdict}`,
      standing: `Signed${by}${on}`,
      tone: KIND_TONES[choice.kind],
    };
  }
  if (isSigned(paper)) {
    // What the reviewer signed is the verdict on the sign-off, not what is proposed now.
    const code = review.signedVerdict ?? conclusion.proposed ?? review.proposed;
    const verdict = code === null ? said : worded(code);
    return {
      ...common,
      signed: true,
      proposed: false,
      stale: false,
      verdict,
      headline: verdict === "" ? "Signed" : `Signed: ${verdict}`,
      standing: `Signed${by}${on}`,
      tone:
        code === "NOT_EFFECTIVE"
          ? "danger"
          : code === "EFFECTIVE"
            ? "success"
            : "neutral",
    };
  }
  // The earlier sign-off's record is still on the review; the server says why it no
  // longer stands.
  const stale = isStale(paper);
  const staleLine = `The sign-off${by}${on} is out of date`;
  if (choice !== null) {
    // Section 3.6: the preparer's conclusion, recorded and not (or no longer) signed.
    const verdict = CONCLUSION_WORDS[choice.kind];
    return {
      ...common,
      recorded: true,
      kind: choice.kind,
      signed: false,
      proposed: false,
      stale,
      verdict,
      headline: `Recorded: ${verdict}`,
      standing: stale ? staleLine : recordedLine(choice),
      tone: stale ? "warning" : "info",
    };
  }
  const proposal = conclusion.proposedConclusion;
  if (proposal !== null) {
    // Section 3.6: the agent proposes, whatever the workpaper's state, until the
    // preparer records a conclusion.
    const verdict = CONCLUSION_WORDS[proposal];
    return {
      ...common,
      kind: proposal,
      signed: false,
      proposed: true,
      stale,
      verdict,
      headline: `Proposed: ${verdict}`,
      standing: stale ? staleLine : PROPOSED_REVIEW,
      tone: stale ? "warning" : "ai",
    };
  }
  const verdict = worded(conclusion.proposed ?? review.proposed);
  const proposed = verdict !== "";
  const author = own(SOURCE_WORDS, conclusion.source);
  return {
    ...common,
    signed: false,
    proposed,
    stale,
    verdict,
    headline: proposed ? `Proposed: ${verdict}` : NOT_CONCLUDED,
    standing: stale
      ? staleLine
      : !proposed
        ? paper.workpaper !== null && paper.workpaper.status === "PREPARED"
          ? "The records propose no verdict yet"
          : "The conclusion is proposed once the workpaper is prepared"
        : author === null
          ? "Proposed, not signed"
          : author === "the agent"
            ? PROPOSED_BY_AGENT
            : `Proposed by ${author}, not signed`,
    tone: stale ? "warning" : proposed ? "ai" : "neutral",
  };
}

/** A signed conclusion's tone: green for effective only; neutral for no instance (the
 * design alone, never the green of effective: independent review, 15 November 2026);
 * the warning tone for exceptions noted (concluded on, never green); red for not
 * effective. Only of a sign-off that stands. */
const KIND_TONES: Readonly<Record<ConclusionKind, Tone>> = {
  EFFECTIVE: "success",
  NO_INSTANCE: "neutral",
  EXCEPTIONS_NOTED: "warning",
  NOT_EFFECTIVE: "danger",
  NOT_CONCLUDED: "neutral",
};

/** "Recorded by Dana Lee on Nov 15, 2026": who recorded the preparer's conclusion. */
export function recordedLine(choice: ConclusionChoice): string {
  const on =
    choice.recordedAt === "" ? "" : ` on ${formatDate(choice.recordedAt)}`;
  return `Recorded by ${choice.recordedBy || "the preparer"}${on}`;
}

/** The design and the implementation result in the contract's words (section 3.6). */
export const RESULT_WORDS: Readonly<
  Record<"design" | "implementation", Readonly<Record<ResultKind, string>>>
> = {
  design: {
    DESIGNED: "Designed to address the risk",
    IN_PLACE: "Designed to address the risk",
    EXCEPTIONS: "Exceptions noted",
    OPEN: "Not concluded",
  },
  implementation: {
    IN_PLACE: "In place in the instance walked through",
    DESIGNED: "In place in the instance walked through",
    EXCEPTIONS: "Exceptions noted",
    OPEN: "Not concluded",
  },
};

export type ResultBox = {
  label: "Design" | "Implementation";
  words: string;
  sentence: string;
  /** "Not yet shown: B, C", or "" where nothing is open. */
  open: string;
  tone: Tone;
};

/** The two boxes beside the conclusion: the design and the implementation result, each
 * in its words, with the server's sentence and the letters still open. Settled reads in
 * the tone of information, never the green of a sign-off; a result not sent reads as not
 * concluded. */
export function resultBoxes(
  paper: Pick<DesignWorkpaper, "design" | "implementation">,
): ResultBox[] {
  return (["design", "implementation"] as const).map((which) => {
    const result = paper[which];
    const kind: ResultKind = result?.result ?? "OPEN";
    return {
      label: which === "design" ? "Design" : "Implementation",
      words: RESULT_WORDS[which][kind],
      sentence: result?.sentence ?? "",
      open:
        result === null || result.open.length === 0
          ? ""
          : `Not yet shown: ${result.open.join(", ")}`,
      tone:
        kind === "EXCEPTIONS"
          ? "warning"
          : kind === "OPEN"
            ? "neutral"
            : "info",
    };
  });
}

/** Under an attribute's result in section 4: how it is shown (section 3.6), or that it
 * is shown only on files a person decided are not relied on. */
export const SHOWN_BY_WORDS: Readonly<Record<ShownBy, string>> = {
  IMPLEMENTATION: "In the instance",
  DESIGN: "As designed",
  NOT_RELIED: "On files not relied on",
};

/** What the page knows of the records the preparer's choice is ruled by (section 3.6):
 * a design deficiency stands exactly where the agent proposes "Not effective" (the first
 * rule of the proposal); the exceptions are the attributes whose state is one; the
 * results are the server's. */
export function choiceFactsOf(
  paper: Pick<
    DesignWorkpaper,
    "conclusion" | "attributes" | "design" | "implementation"
  >,
): ChoiceFacts {
  return {
    deficiency: paper.conclusion.proposedConclusion === "NOT_EFFECTIVE",
    exceptions: paper.attributes
      .filter(
        (item) =>
          item.state === "EXCEPTION" || item.state === "EXCEPTION_RECORDED",
      )
      .map((item) => item.code),
    design: paper.design?.result ?? null,
    implementation: paper.implementation?.result ?? null,
    designOpen: paper.design?.open ?? [],
    implementationOpen: paper.implementation?.open ?? [],
  };
}

/** Whether section 7 offers "Log a design deficiency": while an exception stands (a
 * deficiency is one way to answer it), or where the conclusion is "Not effective" and no
 * design deficiency is logged yet (its sign-off needs one). */
export function deficiencyWanted(
  facts: ChoiceFacts,
  kind: ConclusionKind | null,
): boolean {
  return (
    facts.exceptions.length > 0 ||
    facts.design === "EXCEPTIONS" ||
    facts.implementation === "EXCEPTIONS" ||
    (kind === "NOT_EFFECTIVE" && !facts.deficiency)
  );
}

/* References --------------------------------------------------------------------------- */

export type RefChip = {
  ref: string;
  /** "E3", or "E3 · 4 5" where the reference names annotations. */
  label: string;
  /** What a screen reader hears: the file, and the annotations by number. */
  name: string;
  /** What the file is, for a tooltip; '' for a reference the index does not have. */
  title: string;
  /** The file it opens; null for a reference the evidence index does not have. */
  entry: EvidenceEntry | null;
  /** The annotation it opens on: the first the reference names. */
  annotationId: string | null;
};

/** One reference as a chip. */
export function refChip(
  reference: Reference | string,
  evidence: readonly EvidenceEntry[],
): RefChip {
  const given: Reference =
    typeof reference === "string"
      ? { ref: reference, annotationIds: [], numbers: [] }
      : reference;
  const entry = evidence.find((item) => item.ref === given.ref) ?? null;
  const numbers = given.numbers;
  const what = entry === null ? "" : `, ${evidenceTitle(entry)}`;
  return {
    ref: given.ref,
    label:
      numbers.length === 0 ? given.ref : `${given.ref} · ${numbers.join(" ")}`,
    name:
      numbers.length === 0
        ? `${given.ref}${what}`
        : `${given.ref}${what}, ${numbers.length === 1 ? "annotation" : "annotations"} ${listed(numbers.map(String))}`,
    title:
      entry === null
        ? ""
        : [entry.fileName, entry.kindWords]
            .filter((part) => part !== "")
            .join(" · "),
    entry,
    annotationId: given.annotationIds[0] ?? null,
  };
}

/** A list of references as chips, in the order given. */
export function refChips(
  references: ReadonlyArray<Reference | string>,
  evidence: readonly EvidenceEntry[],
): RefChip[] {
  return references.map((reference) => refChip(reference, evidence));
}

/** What an evidence entry is called beside its reference: its file's name. The kind
 * ("Walkthrough evidence") is the app's own label, shared by several files, so it is the
 * second line, never the name. */
export function evidenceTitle(entry: EvidenceEntry): string {
  return entry.fileName;
}

/** The line an attribute carries for exceptions on files the evidence index does not
 * list; '' where there are none. */
export function strayLine(
  attribute: Pick<Attribute, "strayExceptions">,
): string {
  return attribute.strayExceptions === 0
    ? ""
    : attribute.strayExceptions === 1
      ? "Exception on a file not listed"
      : `Exceptions on ${attribute.strayExceptions} files not listed`;
}

/* The matrix --------------------------------------------------------------------------- */

export type MatrixCell = {
  ref: string;
  mark: Mark | null;
  symbol: string;
  /** The cell's text: the mark's word, or "None". Every cell has one. */
  word: string;
  tone: Tone;
  /** The first annotation the attribute cites in this file, to open on. */
  annotationId: string | null;
};

export type MatrixRow = {
  id: string;
  code: string;
  text: string;
  state: { words: string; tone: Tone };
  basis: string;
  /** '' or "Exception on a file not listed": an exception that has no column. */
  stray: string;
  cells: MatrixCell[];
};

export type Matrix = {
  columns: EvidenceEntry[];
  rows: MatrixRow[];
  /** The marks in use, strongest first, for the key under the grid. */
  key: Array<{ mark: Mark; symbol: string; meaning: string; tone: Tone }>;
};

/** The grid of attributes against evidence: one row per attribute, one cell per file of
 * the evidence index, each cell saying in a word what that file does for that attribute
 * (`attributes[].marks`), or "None". */
export function matrixOf(
  paper: Pick<DesignWorkpaper, "attributes" | "evidence">,
): Matrix {
  const used = new Set<Mark>();
  const rows = paper.attributes.map(
    (attribute): MatrixRow => ({
      id: attribute.id,
      code: attribute.code,
      text: attribute.text,
      state: stateOf(attribute),
      basis: attribute.basis,
      stray: strayLine(attribute),
      cells: paper.evidence.map((entry): MatrixCell => {
        const mark = own(attribute.marks, entry.ref);
        if (mark === null) {
          return {
            ref: entry.ref,
            mark: null,
            symbol: "",
            word: "None",
            tone: "neutral",
            annotationId: null,
          };
        }
        used.add(mark);
        const words = MARK_WORDS[mark];
        return {
          ref: entry.ref,
          mark,
          symbol: words.symbol,
          word: words.word,
          tone: words.tone,
          annotationId:
            attribute.refs.find((ref) => ref.ref === entry.ref)
              ?.annotationIds[0] ?? null,
        };
      }),
    }),
  );
  const order: Mark[] = [...MARKS, "OTHER"];
  return {
    columns: paper.evidence,
    rows,
    key: order
      .filter((mark) => used.has(mark))
      .map((mark) => ({
        mark,
        symbol: MARK_WORDS[mark].symbol,
        meaning: MARK_WORDS[mark].meaning,
        tone: MARK_WORDS[mark].tone,
      })),
  };
}

/* The tiles ---------------------------------------------------------------------------- */

export type Tile = {
  key: "conclusion" | "attributes" | "exceptions" | "files";
  label: string;
  value: string;
  note: string;
  tone: Tone;
};

/** A person's disposition as the attributes tile counts it: never inside "shown". */
const DISPOSITION_TILE_WORDS: Record<string, string> = {
  SHOWN_ON_REVIEW: "on the auditor's judgment",
  NOT_APPLICABLE: "not applicable",
  NOT_AVAILABLE: "accepted without evidence",
  EXCEPTION_RECORDED: "exception recorded",
};

/** The counts above the matrix. Each is counted from what the server sent: nothing is
 * concluded here. */
export function tilesOf(paper: DesignWorkpaper): Tile[] {
  const conclusion = conclusionOf(paper);
  const { attributes, evidence } = paper;
  const shown = attributes.filter((item) => item.state === "SHOWN");
  const exceptions = attributes.filter((item) => item.state === "EXCEPTION");
  // Recorded by a person on an attribute that would otherwise read as shown: counted
  // apart from "shown", and said beside the exceptions a check shows.
  const recorded = attributes.filter(
    (item) => item.state === "EXCEPTION_RECORDED",
  );
  const rest = new Map<string, number>();
  for (const attribute of attributes) {
    if (attribute.state !== "SHOWN" && attribute.state !== "EXCEPTION") {
      // A person's disposition is counted apart from "shown", in short words of its own.
      const words =
        own(DISPOSITION_TILE_WORDS, attribute.state) ??
        stateOf(attribute).words.toLowerCase();
      rest.set(words, (rest.get(words) ?? 0) + 1);
    }
  }
  const leftOut = evidence.filter((entry) => entry.leftOut !== null).length;
  const annotated = evidence.reduce((sum, entry) => sum + entry.annotations, 0);
  const reviewed = evidence.reduce((sum, entry) => sum + entry.reviewed, 0);
  const codes = (items: readonly Attribute[]) =>
    listed(items.map((item) => item.code).filter((code) => code !== ""));
  return [
    {
      key: "conclusion",
      label: "Conclusion",
      value: conclusion.headline,
      note: conclusion.standing,
      tone: conclusion.tone,
    },
    {
      key: "attributes",
      label: "Attributes",
      value:
        attributes.length === 0
          ? "None approved"
          : `${shown.length} of ${attributes.length} shown`,
      note:
        attributes.length === 0
          ? "The attributes appear once the test plan is approved"
          : rest.size === 0
            ? exceptions.length === 0
              ? "Every attribute is shown"
              : "The rest are exceptions"
            : [...rest].map(([words, n]) => `${n} ${words}`).join(", "),
      tone:
        attributes.length > 0 && shown.length === attributes.length
          ? "success"
          : "neutral",
    },
    {
      key: "exceptions",
      label: "Exceptions",
      value:
        exceptions.length === 0
          ? "None shown"
          : plural(exceptions.length, "exception"),
      note: [
        exceptions.length === 0
          ? "No current check shows one"
          : codes(exceptions) === ""
            ? "See the attributes"
            : `${exceptions.length === 1 ? "Attribute" : "Attributes"} ${codes(exceptions)}`,
        recorded.length === 0
          ? ""
          : `${recorded.length} recorded by the auditor${codes(recorded) === "" ? "" : ` on ${codes(recorded)}`}`,
      ]
        .filter((part) => part !== "")
        .join("; "),
      tone: exceptions.length + recorded.length === 0 ? "neutral" : "danger",
    },
    {
      key: "files",
      label: "Evidence",
      value:
        evidence.length === 0
          ? "No files yet"
          : plural(evidence.length, "file"),
      note:
        evidence.length === 0
          ? "Files appear as the design and implementation requests receive them"
          : [
              annotated === 0
                ? "No annotations yet"
                : `${reviewed} of ${plural(annotated, "annotation")} reviewed`,
              leftOut === 0 ? "" : `${leftOut} left out of the check`,
            ]
              .filter((part) => part !== "")
              .join(", "),
      tone: leftOut === 0 ? "neutral" : "warning",
    },
  ];
}

/* The walkthrough ---------------------------------------------------------------------- */

const WALK_HEADERS = ["Step", "Who", "Evidence inspected", "Result"] as const;
const WHEN_COLUMN = /^(when|date|date and time)$/i;

/** The headers of the walkthrough's four cells: the columns the section was drafted with
 * where they are those four (a When or Date column apart, which has its own place), else
 * the standard template's. */
export function walkthroughHeaders(columns: readonly string[]): {
  step: string;
  who: string;
  evidence: string;
  result: string;
} {
  const own = columns.filter((column) => !WHEN_COLUMN.test(column));
  const [step, who, evidence, result] =
    own.length === WALK_HEADERS.length ? own : WALK_HEADERS;
  return {
    step: step ?? WALK_HEADERS[0],
    who: who ?? WALK_HEADERS[1],
    evidence: evidence ?? WALK_HEADERS[2],
    result: result ?? WALK_HEADERS[3],
  };
}

/** The most stops a timeline lays across the page; a longer walkthrough runs down it. */
export const TIMELINE_ACROSS_MOST = 8;

export type TimelineStop = {
  number: number;
  /** The stop's head: when it happened, as the row states it, else "Step 3". */
  head: string;
  /** Whether the head is a time the row states. */
  dated: boolean;
  text: string;
  who: string;
  evidence: string;
  result: string;
  refs: string[];
};

/** The walkthrough as a timeline: the rows in their own order (the server's, never
 * re-sorted here), each headed by the time its row states or by its step number. */
export function timelineOf(
  walkthrough: DesignWorkpaper["walkthrough"],
): TimelineStop[] {
  return walkthrough.steps.map((step) => ({
    number: step.number,
    head: step.when !== "" ? step.when : `Step ${step.number}`,
    dated: step.when !== "",
    text: step.step !== "" ? step.step : step.evidence,
    who: step.who,
    evidence: step.step !== "" ? step.evidence : "",
    result: step.result,
    refs: step.refs,
  }));
}

/** Whether any row states when it happened: the document then has a When column. */
export function walkthroughIsDated(
  walkthrough: DesignWorkpaper["walkthrough"],
): boolean {
  return walkthrough.steps.some((step) => step.when !== "");
}

/* Sections a preparer may edit ---------------------------------------------------------- */

export type EditableSection =
  | "understanding"
  | "walkthrough"
  | "attributes"
  | "reports"
  | "conclusion";

/**
 * The sections of a view that carry an "Edit" link. The server says whether the viewer may
 * edit (`can_edit`, the existing rule); a link is offered only while there is a draft on
 * screen to edit, and it only opens the existing section editor, which applies the rule
 * itself. Procedures, the points and the header are written from the records and are never
 * edited here.
 */
export function editableSections(
  paper: Pick<DesignWorkpaper, "canEdit" | "workpaper">,
): ReadonlySet<EditableSection> {
  const { workpaper } = paper;
  if (
    !paper.canEdit ||
    workpaper === null ||
    workpaper.drafting ||
    workpaper.status !== "DRAFT" ||
    workpaper.currentVersion === 0 ||
    (workpaper.shownVersion !== 0 &&
      workpaper.shownVersion !== workpaper.currentVersion)
  ) {
    return new Set();
  }
  return new Set([
    "understanding",
    "walkthrough",
    "attributes",
    "reports",
    "conclusion",
  ]);
}

/** How the existing editor's own section key is recognised for each section of a view:
 * the templates name them "walkthrough-of-one-instance", "design-attributes",
 * "information-produced-by-the-entity", "design-conclusion" and so on. */
/** The section the server reads for each part of a view, by the standard templates' own
 * keys (workpapers.py; the understanding goes by one of four, workpaper_fill.py), then,
 * for a firm's own template, by what its key says. Reports are only ever the section the
 * server reads them from: "report-description" is a key report's understanding, and a
 * looser match would open the wrong editor. */
const SECTION_KEYS: Record<
  EditableSection,
  { exact: readonly string[]; loose: RegExp | null }
> = {
  understanding: {
    exact: [
      "understanding-of-the-control",
      "understanding-of-the-configuration",
      "process-narrative",
      "report-description",
    ],
    loose: null,
  },
  walkthrough: { exact: ["walkthrough-of-one-instance"], loose: /walkthrough/ },
  attributes: { exact: ["design-attributes"], loose: /attribute/ },
  reports: {
    exact: ["information-produced-by-the-entity"],
    loose: /information-produced/,
  },
  conclusion: { exact: ["design-conclusion"], loose: /conclusion/ },
};

/** The editor's key for a section of a view, among the keys the editor has on the page;
 * null where it has none, and the fold then opens at its top. */
export function sectionKeyFor(
  section: EditableSection,
  keys: readonly string[],
): string | null {
  const { exact, loose } = SECTION_KEYS[section];
  return (
    exact.find((key) => keys.includes(key)) ??
    (loose === null ? null : (keys.find((key) => loose.test(key)) ?? null))
  );
}

/* The evidence beside the workpaper ---------------------------------------------------- */

export type Selection = {
  ref: string;
  annotationId: string | null;
};

/** The file the evidence pane opens on: the one asked for (with the annotation asked
 * for), else the first an attribute cites, else the first of the index; null with no
 * evidence. An annotation is opened only when a person selects a reference to it, so
 * showing the view never moves the keyboard focus. */
export function startingSelection(
  paper: Pick<DesignWorkpaper, "attributes" | "evidence">,
  wanted: Selection | null = null,
): Selection | null {
  if (
    wanted !== null &&
    paper.evidence.some((entry) => entry.ref === wanted.ref)
  ) {
    return wanted;
  }
  for (const attribute of paper.attributes) {
    const first = attribute.refs[0];
    if (first !== undefined) {
      return { ref: first.ref, annotationId: null };
    }
  }
  const first = paper.evidence[0];
  return first === undefined ? null : { ref: first.ref, annotationId: null };
}

/** A report's row where a person established its reliability (section 10.14): the
 * legend's mark for inspected parameters (◊ where the legend has none), its words, and
 * the server's sentence (who, when and what was relied on). Null where no person did. It
 * is a procedure on record, never a sign that more is shown. */
export function reportInspected(
  paper: Pick<DesignWorkpaper, "tickmarks">,
  report: Pick<DesignWorkpaper["reports"][number], "inspected">,
): { symbol: string; words: string; said: string } | null {
  if (report.inspected === undefined) {
    return null;
  }
  const listed = paper.tickmarks.find((item) => item.mark === "INSPECTED");
  return {
    symbol: listed?.symbol || "◊",
    words: REPORT_INSPECTED,
    said: report.inspected,
  };
}
export const REPORT_INSPECTED = "Report parameters inspected";

/** Said in the evidence index of a file a person decided not to rely on (section 10.14):
 * the server's sentence; "" otherwise. */
export function notReliedOnLine(
  entry: Pick<EvidenceEntry, "notReliedOn">,
): string {
  return entry.notReliedOn ?? "";
}
export const NOT_RELIED_ON = "Not relied on";

/** Said in the evidence index of a file whose reliability a person established on review
 * (section 3.9): the server's sentence; "" otherwise. */
export function establishedLine(
  entry: Pick<EvidenceEntry, "established">,
): string {
  return entry.established ?? "";
}

/** Under the evidence index, where the list has files it does not name (section 3.9):
 * "3 more files are not listed."; "" for none. */
export function moreFilesLine(more: number): string {
  return more <= 0
    ? ""
    : more === 1
      ? "1 more file is not listed."
      : `${more} more files are not listed.`;
}

/** One line on a file of the index: what it is, its request, its annotations. */
export function evidenceLine(entry: EvidenceEntry): string {
  return [
    entry.kindWords,
    entry.requirementTitle,
    entry.annotations === 0
      ? ""
      : `${entry.reviewed} of ${plural(entry.annotations, "annotation")} reviewed`,
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

/** A paragraph of the understanding without its citation markers ("[^3]"): the views
 * carry the evidence references, and the citations stay in the section editor. */
export function paragraphs(text: string): string[] {
  return text
    .replace(CITATION_MARK, "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** Whether no current check covers any attribute: the matrix then says so, and what
 * fills it. False with no attributes at all, which has its own line. */
export function withoutCheck(
  paper: Pick<DesignWorkpaper, "attributes">,
): boolean {
  return (
    paper.attributes.length > 0 &&
    paper.attributes.every(
      (attribute) =>
        attribute.state === "NOT_TESTED" &&
        Object.keys(attribute.marks).length === 0,
    )
  );
}

/** What changes when the workpaper record does: the views read again when this does.
 * Built from the page's own list of the control's workpapers. */
export function recordKey(
  papers: ReadonlyArray<{
    id: string;
    stage: string;
    status: string;
    drafting: boolean;
    version: number;
    currentVersion: number;
    shownVersion: number;
  }> | null,
): string {
  return (papers ?? [])
    .filter((paper) => paper.stage === "DESIGN")
    .map((paper) =>
      [
        paper.id,
        paper.status,
        paper.drafting ? "drafting" : "still",
        paper.version,
        paper.currentVersion,
        paper.shownVersion,
      ].join(":"),
    )
    .join("|");
}

/** Whether the fold under the views starts open: while there is no D&I workpaper, while
 * a draft is running, and while it shows the result of something just done in it. */
export function foldStartsOpen(input: {
  papers: ReadonlyArray<{ stage: string; drafting: boolean }> | null;
  notice: unknown;
  viewing: unknown;
}): boolean {
  const design = (input.papers ?? []).filter(
    (paper) => paper.stage === "DESIGN",
  );
  return (
    input.papers === null ||
    design.length === 0 ||
    design.some((paper) => paper.drafting) ||
    input.notice !== null ||
    input.viewing !== null
  );
}

/** A list with a key for each item: its place in the list, then its own words, so two
 * items that read the same (two identical sentences, two facts with one label, two steps
 * with one number) never share a key. */
export function keyed<T>(
  items: readonly T[],
  wordsOf: (item: T) => string,
): Array<{ key: string; item: T }> {
  return items.map((item, index) => ({
    key: `${index + 1}:${wordsOf(item)}`,
    item,
  }));
}

/** What a person reads when what is on screen could not be read again: it may be out of
 * date, so it says so, and it is not printed until it is read again. */
export function staleProblem(problem: string): string {
  return `What is shown could not be refreshed and may be out of date, so it cannot be printed yet. ${problem}`;
}
