/**
 * Evidence annotations (docs/evidence-annotations.md, section 1): why a file satisfies the
 * request and the attribute, as the agent proposed it and a person reviews it.
 *
 * The server decides what is annotated and who may change it; the preview reads its answer,
 * cautiously where it does not know a value, words it, and places it. An annotation is
 * model-derived text until a person reviews it, so nothing here ever shows one as reviewed
 * that the server did not say was. Everything is pure, so it is tested without a browser.
 */

import type { Box, EvidenceCitation } from "./evidence-preview-model.ts";
import { formatDate } from "./format.ts";
import type { IconName } from "./icon-name.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How much of an answer is read: a longer list or sentence is cut, never trusted. */
export const ANNOTATION_BOUNDS = {
  annotations: 24,
  rects: 8,
  attributes: 30,
  pages: 500,
  label: 60,
  statement: 400,
  quote: 600,
} as const;

export const ANNOTATION_KINDS = [
  "SHOWS",
  "IDENTIFIES",
  "SOURCE",
  "EXCEPTION",
] as const;

/** The four kinds of the contract, and OTHER for a kind this page does not know: it is
 * shown, in a neutral tone, and claims nothing. */
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number] | "OTHER";

export type KindTone =
  | "success"
  | "info"
  | "source"
  | "danger"
  | "neutral"
  | "cited";

/** A kind in words, with its tone and its mark: never colour alone. */
export const KIND_WORDS: Record<
  AnnotationKind,
  { label: string; tone: KindTone; mark: IconName }
> = {
  SHOWS: { label: "Shows an attribute", tone: "success", mark: "check" },
  IDENTIFIES: {
    label: "Right system, person or date",
    tone: "info",
    mark: "target",
  },
  SOURCE: { label: "Source", tone: "source", mark: "file" },
  EXCEPTION: { label: "Shows an exception", tone: "danger", mark: "risk" },
  OTHER: { label: "Annotation", tone: "neutral", mark: "info" },
};

export type AnnotationStatus = "PROPOSED" | "CONFIRMED" | "EDITED";

export type Annotation = {
  id: string;
  /** Its place in the list, from 1: the number on its box and its line. */
  number: number;
  kind: AnnotationKind;
  label: string;
  statement: string;
  /** The agent's own sentence, kept when a person rewrites it; "" for a person's. */
  agentStatement: string;
  quote: string;
  attributeIds: string[];
  /** The letters of the attributes it supports. */
  codes: string[];
  page: number;
  /** Its boxes, one per line of the passage, as fractions of the page. */
  rects: Box[];
  checkSentence: string;
  origin: "AGENT" | "PERSON";
  status: AnnotationStatus;
  version: number;
  decidedByName: string | null;
  decidedAt: string | null;
};

export type AnnotationAttribute = {
  id: string;
  code: string;
  text: string;
  annotationIds: string[];
};

export type AnnotationPage = { page: number; width: number; height: number };

export type AnnotationSet = {
  fileId: string;
  requirementId: string;
  /** Whether the server knows where the file's words sit. */
  positions: boolean;
  pages: AnnotationPage[];
  attributes: AnnotationAttribute[];
  annotations: Annotation[];
  canEdit: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const records = (value: unknown): Record<string, unknown>[] =>
  (Array.isArray(value) ? value : []).filter(isRecord);

/** A line of text: one line, trimmed, bounded. */
const line = (value: unknown, max: number): string =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";

const uuids = (value: unknown, max: number): string[] =>
  [
    ...new Set(
      (Array.isArray(value) ? value : []).filter(
        (id): id is string => typeof id === "string" && UUID.test(id),
      ),
    ),
  ].slice(0, max);

const wholeFrom = (value: unknown, least: number, otherwise: number): number =>
  typeof value === "number" && Number.isInteger(value) && value >= least
    ? value
    : otherwise;

/** The server's `[x, y, width, height]` as a box inside the page, or null. */
function parseRect(value: unknown): Box | null {
  if (!Array.isArray(value) || value.length < 4) {
    return null;
  }
  const [x, y, w, h] = value as unknown[];
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof w !== "number" ||
    typeof h !== "number" ||
    ![x, y, w, h].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    w <= 0 ||
    h <= 0 ||
    x + w > 1.001 ||
    y + h > 1.001
  ) {
    return null;
  }
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

function parseAnnotation(
  item: Record<string, unknown>,
  attributes: readonly AnnotationAttribute[],
): Omit<Annotation, "number"> | null {
  if (typeof item.id !== "string" || !UUID.test(item.id)) {
    return null;
  }
  // The list holds what is in force: one removed or replaced is not shown.
  if (item.status === "REMOVED" || item.status === "SUPERSEDED") {
    return null;
  }
  const attributeIds = uuids(item.attribute_ids, ANNOTATION_BOUNDS.attributes);
  const known = attributes
    .filter((attribute) => attributeIds.includes(attribute.id))
    .map((attribute) => attribute.code);
  const stated = (Array.isArray(item.codes) ? item.codes : [])
    .map((code) => line(code, 4))
    .filter((code) => code !== "")
    .slice(0, ANNOTATION_BOUNDS.attributes);
  const kind = (ANNOTATION_KINDS as readonly unknown[]).includes(item.kind)
    ? (item.kind as AnnotationKind)
    : "OTHER";
  return {
    id: item.id,
    kind,
    label: line(item.label, ANNOTATION_BOUNDS.label),
    statement: line(item.statement, ANNOTATION_BOUNDS.statement),
    agentStatement: line(item.agent_statement, ANNOTATION_BOUNDS.statement),
    quote:
      typeof item.quote === "string"
        ? item.quote.trim().slice(0, ANNOTATION_BOUNDS.quote)
        : "",
    attributeIds,
    codes: known.length > 0 ? known : [...new Set(stated)],
    page: wholeFrom(item.page, 1, 1),
    rects: (Array.isArray(item.rects) ? item.rects : [])
      .map(parseRect)
      .filter((rect): rect is Box => rect !== null)
      .slice(0, ANNOTATION_BOUNDS.rects),
    checkSentence: line(item.check_sentence, ANNOTATION_BOUNDS.statement),
    origin: item.origin === "PERSON" ? "PERSON" : "AGENT",
    // Only what the server calls reviewed reads as reviewed.
    status:
      item.status === "CONFIRMED" || item.status === "EDITED"
        ? item.status
        : "PROPOSED",
    version: wholeFrom(item.version, 0, 0),
    decidedByName: line(item.decided_by_name, 120) || null,
    decidedAt: line(item.decided_at, 40) || null,
  };
}

/**
 * The server's answer for one file on one request, or null when it is not one. Unknown
 * values fall to the cautious reading: an unknown kind claims nothing, an unknown status is
 * a proposal, and only `can_edit: true` offers the actions.
 */
export function parseAnnotations(value: unknown): AnnotationSet | null {
  if (
    !isRecord(value) ||
    typeof value.file_id !== "string" ||
    !UUID.test(value.file_id) ||
    typeof value.requirement_id !== "string" ||
    !UUID.test(value.requirement_id)
  ) {
    return null;
  }
  const attributes: AnnotationAttribute[] = [];
  for (const item of records(value.attributes)) {
    const code = line(item.code, 4);
    if (
      typeof item.id !== "string" ||
      !UUID.test(item.id) ||
      code === "" ||
      attributes.some((attribute) => attribute.id === item.id)
    ) {
      continue;
    }
    attributes.push({
      id: item.id,
      code,
      text: line(item.text, 300),
      annotationIds: uuids(item.annotation_ids, ANNOTATION_BOUNDS.annotations),
    });
    if (attributes.length === ANNOTATION_BOUNDS.attributes) {
      break;
    }
  }
  const annotations: Annotation[] = [];
  for (const item of records(value.annotations)) {
    const parsed = parseAnnotation(item, attributes);
    if (
      parsed === null ||
      annotations.some((annotation) => annotation.id === parsed.id)
    ) {
      continue;
    }
    // The number is the place in the list, so it is counted here, not read.
    annotations.push({ ...parsed, number: annotations.length + 1 });
    if (annotations.length === ANNOTATION_BOUNDS.annotations) {
      break;
    }
  }
  const pages: AnnotationPage[] = [];
  for (const item of records(value.pages).slice(0, ANNOTATION_BOUNDS.pages)) {
    const page = wholeFrom(item.page, 1, 0);
    const { width, height } = item;
    if (
      page > 0 &&
      typeof width === "number" &&
      typeof height === "number" &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0 &&
      !pages.some((each) => each.page === page)
    ) {
      pages.push({ page, width, height });
    }
  }
  return {
    fileId: value.file_id,
    requirementId: value.requirement_id,
    positions: value.positions === true,
    pages,
    attributes,
    annotations,
    canEdit: value.can_edit === true,
  };
}

/** A file shown with no annotations: on no D&I request, or with none that could be read.
 * Nothing is offered to edit. */
export function noAnnotations(fileId: string): AnnotationSet {
  return {
    fileId,
    requirementId: "",
    positions: false,
    pages: [],
    attributes: [],
    annotations: [],
    canEdit: false,
  };
}

/* The words ------------------------------------------------------------------------- */

/** "A", "A and C", "A, B and C". */
function listed(codes: readonly string[]): string {
  return codes.length <= 1
    ? (codes[0] ?? "")
    : `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1] ?? ""}`;
}

/** What an annotation is, with the attributes it bears on: the callout's first line. */
export function kindLine(
  annotation: Pick<Annotation, "kind" | "codes">,
): string {
  const { codes } = annotation;
  const plural = codes.length === 1 ? "attribute" : "attributes";
  if (annotation.kind === "SHOWS" && codes.length > 0) {
    return `Shows ${plural} ${listed(codes)}`;
  }
  if (annotation.kind === "EXCEPTION" && codes.length > 0) {
    return `Shows an exception to ${plural} ${listed(codes)}`;
  }
  return KIND_WORDS[annotation.kind].label;
}

export type ReviewState = "proposed" | "confirmed" | "edited";

/** A review state in a word with its mark; a proposal's mark is an empty dashed ring. */
export const REVIEW_WORDS: Record<ReviewState, { word: string; mark: string }> =
  {
    proposed: { word: "Proposed", mark: "" },
    confirmed: { word: "Confirmed", mark: "✓" },
    edited: { word: "Edited", mark: "✎" },
  };

export function reviewState(
  annotation: Pick<Annotation, "status">,
): ReviewState {
  return annotation.status === "CONFIRMED"
    ? "confirmed"
    : annotation.status === "EDITED"
      ? "edited"
      : "proposed";
}

/** Who stands behind an annotation: the agent's proposal, or the person who reviewed it. */
export function reviewLine(
  annotation: Pick<
    Annotation,
    "status" | "origin" | "decidedByName" | "decidedAt"
  >,
): string {
  if (annotation.status === "PROPOSED") {
    return annotation.origin === "AGENT" ? "Proposed by the agent" : "Proposed";
  }
  const verb =
    annotation.status === "EDITED"
      ? "Edited"
      : annotation.origin === "PERSON"
        ? "Added"
        : "Confirmed";
  const by =
    annotation.decidedByName === null ? "" : ` by ${annotation.decidedByName}`;
  const when =
    annotation.decidedAt === null
      ? ""
      : ` on ${formatDate(annotation.decidedAt)}`;
  return `${verb}${by}${when}`;
}

/** Over the sentence of a comparison made in code, as the check's review words it. */
export const CHECKED_IN_CODE = "Checked in code:";

/** The comparison's sentence under its heading, said once. */
export function checkLine(sentence: string): string {
  const rest = sentence.trim();
  if (rest === "") {
    return "";
  }
  return rest.toLowerCase().startsWith(CHECKED_IN_CODE.toLowerCase())
    ? rest
    : `${CHECKED_IN_CODE} ${rest}`;
}

/* What this file shows ---------------------------------------------------------------- */

export const NOT_IN_FILE = "Not in this file";

export type AttributeRow = {
  id: string;
  code: string;
  text: string;
  /** The annotations that bear on it, in the list's order; none reads NOT_IN_FILE. */
  marks: Array<{ id: string; number: number; kind: AnnotationKind }>;
};

/** One row per approved attribute of the control, with the numbers that bear on it. */
export function attributeRows(set: AnnotationSet): AttributeRow[] {
  return set.attributes.map((attribute) => ({
    id: attribute.id,
    code: attribute.code,
    text: attribute.text,
    marks: set.annotations
      .filter(
        (annotation) =>
          annotation.attributeIds.includes(attribute.id) ||
          attribute.annotationIds.includes(annotation.id),
      )
      .map(({ id, number, kind }) => ({ id, number, kind })),
  }));
}

/* The legend -------------------------------------------------------------------------- */

const WORDS = /[\p{L}\p{N}]+/gu;

/**
 * A short value from the quote for the legend line, where the label does not already say
 * it: the part after a field's colon, without the leading words the label repeats, cut at
 * a word. "" when the label says it all.
 */
export function shortValue(label: string, quote: string, max = 36): string {
  const said = new Set(label.toLowerCase().match(WORDS) ?? []);
  let rest = quote.replace(/\s+/g, " ").trim();
  const colon = rest.indexOf(": ");
  if (colon > 0 && colon < rest.length - 2) {
    rest = rest.slice(colon + 2).trim();
  }
  const words = rest === "" ? [] : rest.split(" ");
  const repeats = (word: string) =>
    (word.toLowerCase().match(WORDS) ?? []).every((part) => said.has(part));
  while (words.length > 0 && repeats(words[0] ?? "")) {
    words.shift();
  }
  if (words.every(repeats)) {
    return "";
  }
  const value = words.join(" ");
  if (value.length <= max) {
    return value;
  }
  const cut = value.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:·-]+$/, "")}…`;
}

export type LegendRow = {
  id: string;
  number: number;
  kind: AnnotationKind;
  label: string;
  value: string;
  codes: string[];
  review: ReviewState;
};

/** One line per annotation, in reading order. */
export function legendRows(set: AnnotationSet): LegendRow[] {
  return set.annotations.map((annotation) => {
    const label =
      annotation.label !== ""
        ? annotation.label
        : KIND_WORDS[annotation.kind].label;
    return {
      id: annotation.id,
      number: annotation.number,
      kind: annotation.kind,
      label,
      value: shortValue(label, annotation.quote),
      codes: annotation.codes,
      review: reviewState(annotation),
    };
  });
}

/** A box or a line's name for a screen reader: its number, what it is, where it stands. */
export function annotationName(annotation: Annotation): string {
  const label = annotation.label !== "" ? `${annotation.label}. ` : "";
  return `Annotation ${annotation.number}: ${label}${kindLine(annotation)}. ${
    REVIEW_WORDS[reviewState(annotation)].word
  }.`;
}

export type ReviewCounts = {
  reviewed: number;
  proposed: number;
  total: number;
};

export function reviewCounts(
  annotations: readonly Pick<Annotation, "status">[],
): ReviewCounts {
  const proposed = annotations.filter(
    (annotation) => annotation.status === "PROPOSED",
  ).length;
  return {
    reviewed: annotations.length - proposed,
    proposed,
    total: annotations.length,
  };
}

/** "2 of 7 reviewed". */
export function reviewedWords(counts: ReviewCounts): string {
  return `${counts.reviewed} of ${counts.total} reviewed`;
}

/** "Confirm all 5 proposed". */
export function confirmAllWords(proposed: number): string {
  return `Confirm all ${proposed} proposed`;
}

/** "5 of 7": where the selected annotation is in the list. */
export function positionWords(
  annotations: readonly Pick<Annotation, "id">[],
  id: string,
): string {
  const at = annotations.findIndex((annotation) => annotation.id === id);
  return at < 0 ? "" : `${at + 1} of ${annotations.length}`;
}

/* Stepping ---------------------------------------------------------------------------- */

/**
 * Where "Confirm & next" goes: the next annotation still proposed after this one, going
 * round to the top; null when no other is left to review.
 */
export function nextToReview(
  annotations: readonly Pick<Annotation, "id" | "status">[],
  currentId: string | null,
): string | null {
  const at = annotations.findIndex((annotation) => annotation.id === currentId);
  for (let step = 1; step <= annotations.length; step += 1) {
    const next = annotations[(at + step) % annotations.length];
    if (
      next !== undefined &&
      next.id !== currentId &&
      next.status === "PROPOSED"
    ) {
      return next.id;
    }
  }
  return null;
}

/**
 * Previous and next, in the list's order; null at an end. With none selected, next is the
 * first and previous the last.
 */
export function stepTo(
  annotations: readonly Pick<Annotation, "id">[],
  currentId: string | null,
  direction: 1 | -1,
): string | null {
  const at = annotations.findIndex((annotation) => annotation.id === currentId);
  if (at < 0) {
    return (
      annotations[direction === 1 ? 0 : annotations.length - 1]?.id ?? null
    );
  }
  return annotations[at + direction]?.id ?? null;
}

/* Where the callout goes -------------------------------------------------------------- */

export type Size = { width: number; height: number };

/** The callout's width beside a box; narrower only where the page is. */
export const CALLOUT_WIDTH = 440;
/** Under this window width the callout is a sheet along the bottom. */
export const SHEET_BELOW = 720;
/** A page narrower than this has no room for a callout on it. */
const NARROW_PAGE = 300;
const BESIDE_GAP = 18;
const STACK_GAP = 12;

export type CalloutPlace =
  | {
      mode: "beside";
      left: number;
      top: number;
      /** Where its pointer sits down its left edge: level with the box. */
      pointer: number;
    }
  | { mode: "below" | "above"; left: number; top: number }
  | { mode: "sheet" };

const between = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high));

/**
 * Where the basis is shown, in pixels of the page: beside the box, in the free space to its
 * right, when it fits there; else below it; else above it; never over it. On a small screen, with no box
 * to stand by, or on a page too narrow to hold it, it is a sheet along the bottom. The
 * choice between the page and the sheet never depends on the callout's height, so a
 * callout that changes size never jumps between them.
 */
export function calloutPlace(input: {
  /** The annotation's box (the bounds of its rects), as fractions of the page. */
  box: Box | null;
  page: Size;
  /** The callout's height as it measures; its width is CALLOUT_WIDTH at most. */
  callout: Size;
  viewportWidth: number;
}): CalloutPlace {
  const { box, page, viewportWidth } = input;
  if (
    box === null ||
    viewportWidth < SHEET_BELOW ||
    page.width < NARROW_PAGE ||
    page.height <= 0
  ) {
    return { mode: "sheet" };
  }
  const width = Math.min(CALLOUT_WIDTH, page.width);
  const { height } = input.callout;
  const left = box.x * page.width;
  const right = (box.x + box.w) * page.width;
  const top = box.y * page.height;
  const bottom = (box.y + box.h) * page.height;
  if (right + BESIDE_GAP + width <= page.width) {
    const at = between(top - 14, 0, page.height - height);
    return {
      mode: "beside",
      left: right + BESIDE_GAP,
      top: at,
      pointer: between((top + bottom) / 2 - at, 16, height - 16),
    };
  }
  const across = between(left, 0, page.width - width);
  const fitsBelow = bottom + STACK_GAP + height <= page.height;
  const fitsAbove = top - STACK_GAP - height >= 0;
  if (!fitsBelow && fitsAbove) {
    return { mode: "above", left: across, top: top - STACK_GAP - height };
  }
  // Below, also where it fits on neither side: it runs past the page's foot and the
  // stage scrolls to it, so the box it speaks of is never under it.
  return { mode: "below", left: across, top: bottom + STACK_GAP };
}

/* The box: moving, resizing, drawing --------------------------------------------------- */

export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type Handle = (typeof HANDLES)[number];

/** A handle in words, for a screen reader. */
export const HANDLE_WORDS: Record<Handle, string> = {
  nw: "top left corner",
  n: "top edge",
  ne: "top right corner",
  e: "right edge",
  se: "bottom right corner",
  s: "bottom edge",
  sw: "bottom left corner",
  w: "left edge",
};

/** Where a handle sits on its box: 0, 0.5 or 1 along each side. */
export function handlePoint(handle: Handle): { x: number; y: number } {
  return {
    x: handle.includes("w") ? 0 : handle.includes("e") ? 1 : 0.5,
    y: handle.includes("n") ? 0 : handle.includes("s") ? 1 : 0.5,
  };
}

/** The smallest box, as fractions of the page: it can still be seen and taken hold of. */
export const MIN_BOX = { w: 0.012, h: 0.012 } as const;

type Least = { w: number; h: number };

const unit = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/** A box held inside the page at no less than the smallest size. */
export function clampBox(box: Box, least: Least = MIN_BOX): Box {
  const w = Math.min(1, Math.max(least.w, unit(box.w)));
  const h = Math.min(1, Math.max(least.h, unit(box.h)));
  return {
    x: Math.min(unit(box.x), 1 - w),
    y: Math.min(unit(box.y), 1 - h),
    w,
    h,
  };
}

/** The box moved by a fraction of the page, its size kept, never past an edge. */
export function moveBox(box: Box, dx: number, dy: number): Box {
  const held = clampBox(box);
  return {
    ...held,
    x: between(held.x + dx, 0, 1 - held.w),
    y: between(held.y + dy, 0, 1 - held.h),
  };
}

/**
 * The box with one handle moved: the opposite side stays where it is, the moved side stops
 * at the page's edge and at the smallest size.
 */
export function resizeBox(
  box: Box,
  handle: Handle,
  dx: number,
  dy: number,
  least: Least = MIN_BOX,
): Box {
  const held = clampBox(box, least);
  let { x, y, w, h } = held;
  if (handle.includes("w")) {
    const edge = held.x + held.w;
    x = between(held.x + dx, 0, edge - least.w);
    w = edge - x;
  } else if (handle.includes("e")) {
    w = between(held.w + dx, least.w, 1 - held.x);
  }
  if (handle.includes("n")) {
    const edge = held.y + held.h;
    y = between(held.y + dy, 0, edge - least.h);
    h = edge - y;
  } else if (handle.includes("s")) {
    h = between(held.h + dy, least.h, 1 - held.y);
  }
  return { x, y, w, h };
}

/** The box drawn from one point of the page to another, in any direction. */
export function drawnBox(
  from: { x: number; y: number },
  to: { x: number; y: number },
  least: Least = MIN_BOX,
): Box {
  const [x0, x1] = [unit(from.x), unit(to.x)].sort((a, b) => a - b);
  const [y0, y1] = [unit(from.y), unit(to.y)].sort((a, b) => a - b);
  return clampBox(
    {
      x: x0 ?? 0,
      y: y0 ?? 0,
      w: (x1 ?? 0) - (x0 ?? 0),
      h: (y1 ?? 0) - (y0 ?? 0),
    },
    least,
  );
}

/** Whether a drag covered enough of the page to be a box and not a slip of the hand. */
export function isDrawn(
  from: { x: number; y: number },
  to: { x: number; y: number },
): boolean {
  return (
    Math.abs(to.x - from.x) >= MIN_BOX.w && Math.abs(to.y - from.y) >= MIN_BOX.h
  );
}

/** A box to start from where none is drawn: the middle of the page, to adjust. */
export const STARTING_BOX: Box = { x: 0.3, y: 0.44, w: 0.4, h: 0.12 };

/** The step an arrow key moves a handle or a box: finer by itself, coarser with Shift. */
export function nudgeOf(
  key: string,
  shift: boolean,
): { dx: number; dy: number } | null {
  const step = shift ? 0.02 : 0.004;
  switch (key) {
    case "ArrowLeft":
      return { dx: -step, dy: 0 };
    case "ArrowRight":
      return { dx: step, dy: 0 };
    case "ArrowUp":
      return { dx: 0, dy: -step };
    case "ArrowDown":
      return { dx: 0, dy: step };
    default:
      return null;
  }
}

/** The one box around an annotation's boxes, or null when it has none. */
export function boundsOf(rects: readonly Box[]): Box | null {
  const [only] = rects;
  if (only === undefined) {
    return null;
  }
  if (rects.length === 1) {
    return { ...only };
  }
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return {
    x,
    y,
    w: Math.max(...rects.map((rect) => rect.x + rect.w)) - x,
    h: Math.max(...rects.map((rect) => rect.y + rect.h)) - y,
  };
}

const sameBox = (a: Box | null, b: Box | null): boolean =>
  a === null || b === null
    ? a === b
    : (["x", "y", "w", "h"] as const).every(
        (key) => Math.abs(a[key] - b[key]) < 0.0005,
      );

/**
 * The runs of text a quote covers on a PDF page, joined into one box per line (at most
 * eight): runs that share most of their height are one line.
 */
export function lineBoxes(boxes: readonly Box[]): Box[] {
  const lines: Box[] = [];
  for (const box of [...boxes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const last = lines[lines.length - 1];
    const overlap =
      last === undefined
        ? 0
        : Math.min(last.y + last.h, box.y + box.h) - Math.max(last.y, box.y);
    if (last !== undefined && overlap >= Math.min(last.h, box.h) / 2) {
      lines[lines.length - 1] = boundsOf([last, box]) ?? last;
    } else {
      lines.push(box);
    }
  }
  return lines.slice(0, ANNOTATION_BOUNDS.rects);
}

export type PageMark = { id: string; rects: Box[] };

/**
 * Each annotation's boxes on the page in view. The server's own boxes come first (an image,
 * or a box a person drew); a text PDF's are the runs its quote covers, found in the browser
 * (`found`, by the annotation's place in the list). `page` is null for a file of one page.
 */
export function pageMarks(
  annotations: readonly Annotation[],
  page: number | null,
  found: ReadonlyArray<{ box: Box; index: number }> = [],
): PageMark[] {
  return annotations.map((annotation, index) => {
    const here = page === null || annotation.page === page;
    return {
      id: annotation.id,
      rects: !here
        ? []
        : annotation.rects.length > 0
          ? annotation.rects
          : lineBoxes(
              found
                .filter((each) => each.index === index)
                .map((each) => each.box),
            ),
    };
  });
}

/**
 * The one quiet line for annotations listed without a box on the page in view, or null
 * when each has one.
 */
export function unboxedLine(
  annotations: readonly Annotation[],
  page: number | null,
  marks: readonly PageMark[],
): string | null {
  const here = annotations.filter(
    (annotation) => page === null || annotation.page === page,
  );
  const without = here.filter(
    (annotation) =>
      (marks.find((mark) => mark.id === annotation.id)?.rects.length ?? 0) ===
      0,
  ).length;
  if (without === 0) {
    return null;
  }
  if (without === here.length) {
    return "The annotations are listed without boxes: where their words sit in this file is not known.";
  }
  return without === 1
    ? "1 annotation is listed without a box: where its words sit in this file is not known."
    : `${without} annotations are listed without a box: where their words sit in this file is not known.`;
}

/** The annotations as cited passages, for the viewers that mark a quote in the file's own
 * text (a text PDF's runs, a spreadsheet's or a document's read text). */
export function annotationCitations(
  set: AnnotationSet,
  fileName: string,
): EvidenceCitation[] {
  return set.annotations.map((annotation) => ({
    fileId: set.fileId,
    fileName,
    quote: annotation.quote.slice(0, 300),
    found: true,
    location: "",
    page: annotation.page,
    box: null,
    label: String(annotation.number),
  }));
}

/* Cited passages (section 5a) ---------------------------------------------------------- */

/** The kind of a passage a screen cites (the console, a workpaper, a finding, a check's
 * passage): in the same legend as the annotations, in its own words and mark, never by
 * colour alone. A citation is never stored, never reviewed and never an annotation. */
export const CITED_WORDS: { label: string; tone: KindTone; mark: IconName } = {
  label: "Cited",
  tone: "cited",
  mark: "tag",
};

/** A cited passage as the viewer shows it: a numbered box where its words are found, and
 * a line in the legend. */
export type CitedMark = {
  /** `cited-<place in the screen's list>`; never an annotation's id. */
  id: string;
  /** The number on its box and its line: after the shown file's annotations. */
  number: number;
  fileId: string;
  fileName: string;
  quote: string;
  /** What the screen calls it ("A2", "[3]"), or "". */
  label: string;
  location: string;
  page: number | null;
  /** A box the screen already knows (an image's), as fractions of the page. */
  box: Box | null;
  /** Whether its words were found in the file's text, or only boxed on an image. */
  found: boolean;
};

const CITED_PREFIX = "cited-";

/** Whether two boxes on a page share some of it. */
function overlaps(a: Box, b: Box): boolean {
  return (
    Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) &&
    Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y)
  );
}

/**
 * Whether a citation of the shown file is the passage an annotation already marks: the
 * same words, on the same page (a citation that names no page is on every one), and, on
 * an image, a box of its own that overlaps one of the annotation's. Anything less is a
 * passage of its own, kept as a cited mark: the same words elsewhere in the file are not
 * the annotated ones, and a citation is never taken for an audit record it only resembles.
 */
function marksSame(
  citation: EvidenceCitation,
  annotation: Pick<Annotation, "quote" | "page" | "rects">,
  image: boolean,
): boolean {
  const key = quoteKey(annotation.quote);
  if (key === "" || key !== quoteKey(citation.quote)) {
    return false;
  }
  if (citation.page !== null && citation.page !== annotation.page) {
    return false;
  }
  if (!image) {
    return true;
  }
  const box = citation.box;
  return box !== null && annotation.rects.some((rect) => overlaps(rect, box));
}

/**
 * The passages a screen cites, in its order, numbered after the shown file's annotations
 * so no two marks in view share a number (with none, 1, 2, 3 as before). A citation of
 * the shown file that is the very passage an annotation marks (marksSame: its words, its
 * page, and on an image its box) is that annotation's box, not a second box on the same
 * words; any other stays a cited mark. Nothing here is stored or sent.
 */
export function citedMarks(
  citations: readonly EvidenceCitation[],
  fileId: string,
  annotations: readonly Pick<Annotation, "quote" | "page" | "rects">[],
  image = false,
): CitedMark[] {
  return citations
    .map((citation, index) => ({ citation, index }))
    .filter(
      ({ citation }) =>
        !(
          citation.fileId === fileId &&
          annotations.some((annotation) =>
            marksSame(citation, annotation, image),
          )
        ),
    )
    .map(({ citation, index }, at) => ({
      id: `${CITED_PREFIX}${index}`,
      number: annotations.length + at + 1,
      fileId: citation.fileId,
      fileName: citation.fileName,
      quote: citation.quote,
      label: citation.label,
      location: citation.location,
      page: citation.page,
      box: citation.box,
      found: citation.found,
    }));
}

/** The cited passages as the file viewers take them, to find their words. */
export function citedCitations(
  cited: readonly CitedMark[],
): EvidenceCitation[] {
  return cited.map((mark) => ({
    fileId: mark.fileId,
    fileName: mark.fileName,
    quote: mark.quote,
    found: mark.found,
    location: mark.location,
    page: mark.page,
    box: mark.box,
    label: mark.label,
  }));
}

/**
 * Each cited passage's boxes on the page in view: the box the screen knows (an image's),
 * else the runs of a text PDF its words cover (`found`, by its place after the
 * annotations, `offset`). `page` is null for a file of one page.
 */
export function citedPageMarks(
  cited: readonly CitedMark[],
  page: number | null,
  found: ReadonlyArray<{ box: Box; index: number }> = [],
  offset = 0,
): PageMark[] {
  return cited.map((mark, index) => {
    const here = page === null || mark.page === null || mark.page === page;
    return {
      id: mark.id,
      rects: !here
        ? []
        : mark.box !== null
          ? [mark.box]
          : lineBoxes(
              found
                .filter((each) => each.index === offset + index)
                .map((each) => each.box),
            ),
    };
  });
}

/** How a file is shown, as the viewer tells the kinds apart (previewKind). */
export type ShownKind = "image" | "pdf" | "text";

/** Why a cited passage has no box, in the words for the file it is in. */
function unboxedWhy(kind: ShownKind, found: boolean, many: boolean): string {
  if (kind === "image") {
    return found
      ? many
        ? "they were found in the file's text and could not be boxed on the image"
        : "it was found in the file's text and could not be boxed on the image"
      : many
        ? "their words were not found in the file's text"
        : "its words were not found in the file's text";
  }
  if (kind === "pdf") {
    return many
      ? "their words were not found on this page"
      : "its words were not found on this page";
  }
  return many
    ? "their words were not found in the file's text"
    : "its words were not found in the file's text";
}

/**
 * The quiet line for cited passages listed without a box on the page in view, or null
 * when each has one: why, in the file's own terms (an image's passage read in its text
 * but not placed on it is not one whose words are missing), one sentence per reason.
 */
export function citedUnboxedLine(
  cited: readonly CitedMark[],
  page: number | null,
  marks: readonly PageMark[],
  kind: ShownKind = "pdf",
): string | null {
  const here = cited.filter(
    (mark) => page === null || mark.page === null || mark.page === page,
  );
  const without = here.filter(
    (mark) =>
      (marks.find((each) => each.id === mark.id)?.rects.length ?? 0) === 0,
  );
  if (without.length === 0) {
    return null;
  }
  // On a PDF or in text the reason is one; on an image it is whether the words were read.
  const groups =
    kind === "image"
      ? [true, false].map((found) => ({
          found,
          count: without.filter((mark) => mark.found === found).length,
        }))
      : [{ found: true, count: without.length }];
  return groups
    .filter((group) => group.count > 0)
    .map((group) =>
      group.count === 1
        ? `1 cited passage is listed beside the file without a box: ${unboxedWhy(kind, group.found, false)}.`
        : `${group.count} cited passages are listed beside the file without a box: ${unboxedWhy(kind, group.found, true)}.`,
    )
    .join(" ");
}

/** A cited box or line's name for a screen reader. */
export function citedName(mark: CitedMark): string {
  const label = mark.label !== "" ? ` ${mark.label}` : "";
  const quote = mark.quote.replace(/\s+/g, " ").trim();
  const said =
    quote === ""
      ? "a passage"
      : quote.length <= 60
        ? quote
        : `${quote.slice(0, 59).trimEnd()}…`;
  return `Cited ${mark.number}${label}: ${said}`;
}

/** What a page asks the viewer to put in view: an annotation or a cited passage by its
 * id, or whichever marks these words (a citation selected elsewhere on the page). */
export type ViewerPick = { id: string } | { quote: string };

/** The id a pick names among the marks of the shown file, or null where none is it. */
export function pickTarget(
  pick: ViewerPick | null,
  annotations: readonly Pick<Annotation, "id" | "quote">[],
  cited: readonly Pick<CitedMark, "id" | "quote">[],
): string | null {
  if (pick === null) {
    return null;
  }
  if ("id" in pick) {
    return [...annotations, ...cited].some((mark) => mark.id === pick.id)
      ? pick.id
      : null;
  }
  const wanted = quoteKey(pick.quote);
  if (wanted === "") {
    return null;
  }
  return (
    cited.find((mark) => quoteKey(mark.quote) === wanted)?.id ??
    annotations.find((annotation) => quoteKey(annotation.quote) === wanted)
      ?.id ??
    null
  );
}

/** The line under the evidence for a file shown as its read text, or "" for a page. */
export function textStageLine(annotated: boolean, cited: boolean): string {
  if (annotated && cited) {
    return "This file is shown as the text read from it: the annotated and cited words are marked, without numbered boxes.";
  }
  if (annotated) {
    return "This file is shown as the text read from it: the annotated words are marked, without numbered boxes.";
  }
  return cited
    ? "This file is shown as the text read from it: the cited words are marked, without numbered boxes."
    : "";
}

/** What a reference from outside the preview asks to see: the annotation that marks a
 * passage for an attribute (a "Shown" row of a finished check, docs/evidence-assurance.md,
 * section 10.12). */
export type AnnotationAsk = { attributeId: string; quote: string };

/** A quote as it is compared: its letters and digits only, in lower case, so case,
 * spacing and punctuation are set aside. */
export function quoteKey(quote: string): string {
  return (quote.toLowerCase().match(WORDS) ?? []).join(" ");
}

/** The kinds a reference prefers: what shows the attribute, or an exception to it,
 * before what only identifies or sources it. */
const ASK_FIRST: readonly AnnotationKind[] = ["SHOWS", "EXCEPTION"];

/** The least a quote may be for one to be taken as holding the other: three words or
 * twenty characters on the shorter side, so that a lone "Yes", a date or a system's name
 * never matches a passage it merely appears in. */
export const ASK_CONTAINED_WORDS = 3;
export const ASK_CONTAINED_CHARACTERS = 20;

/** Whether one quote holds the other, as whole words, where the shorter is long enough to
 * say something by itself. */
function holds(one: string, other: string): boolean {
  const [shorter, longer] =
    one.length <= other.length ? [one, other] : [other, one];
  const long =
    shorter.split(" ").length >= ASK_CONTAINED_WORDS ||
    shorter.length >= ASK_CONTAINED_CHARACTERS;
  return long && ` ${longer} `.includes(` ${shorter} `);
}

/**
 * The annotation a reference opens on, or null where there is none for it. Where any
 * annotation of the file names the attribute, only those are considered, in this order:
 * the one whose quote is the passage's; one whose quote holds the passage or is held by
 * it, where the shorter of the two says something by itself (ASK_CONTAINED_*); the first
 * listed that shows the attribute or an exception to it; the first listed that names it.
 * An annotation of another attribute is never chosen over one of this attribute. Where
 * none names it, only an annotation whose quote is the passage's own words is; else none.
 * It only chooses what is put in view: it confirms, edits and sends nothing.
 */
export function annotationFor(
  set: AnnotationSet,
  ask: AnnotationAsk,
): Annotation | null {
  const wanted = quoteKey(ask.quote);
  const keyOf = (annotation: Annotation) => quoteKey(annotation.quote);
  const naming =
    ask.attributeId === ""
      ? []
      : set.annotations.filter((annotation) =>
          annotation.attributeIds.includes(ask.attributeId),
        );
  if (naming.length === 0) {
    return wanted === ""
      ? null
      : (set.annotations.find((annotation) => keyOf(annotation) === wanted) ??
          null);
  }
  if (wanted !== "") {
    const same = naming.find((annotation) => keyOf(annotation) === wanted);
    if (same !== undefined) {
      return same;
    }
    const within = naming.find((annotation) => {
      const key = keyOf(annotation);
      return key !== "" && holds(key, wanted);
    });
    if (within !== undefined) {
      return within;
    }
  }
  return (
    naming.find((annotation) => ASK_FIRST.includes(annotation.kind)) ??
    naming[0] ??
    null
  );
}

/* What each action sends --------------------------------------------------------------- */

export type AnnotationScope = {
  organizationId: string;
  projectId: string;
  controlId: string;
  requirementId: string;
  fileId: string;
};

/** The query the preview reads a file's annotations with, through the proxy route. */
export function annotationsQuery(scope: AnnotationScope): string {
  return new URLSearchParams({
    organization: scope.organizationId,
    project: scope.projectId,
    control: scope.controlId,
    requirement: scope.requirementId,
    file: scope.fileId,
  }).toString();
}

/** The API path that query names, or null when an id is not one. */
export function annotationReadPath(params: URLSearchParams): string | null {
  const id = (key: string): string | null => {
    const value = params.get(key) ?? "";
    return UUID.test(value) ? value : null;
  };
  const organization = id("organization");
  const project = id("project");
  const control = id("control");
  const requirement = id("requirement");
  const file = id("file");
  if (
    organization === null ||
    project === null ||
    control === null ||
    requirement === null ||
    file === null
  ) {
    return null;
  }
  const query = new URLSearchParams({
    requirement_id: requirement,
    file_id: file,
  });
  return `/organizations/${organization}/projects/${project}/controls/${control}/evidence-annotations?${query}`;
}

/** What a person changed in an annotation: only what differs is sent. */
export type EditChanges = {
  statement?: string;
  attributeIds?: string[];
  rects?: Box[];
};

export type EditDraft = {
  statement: string;
  attributeIds: string[];
  /** The one box the handles adjust; null where the annotation has none. */
  box: Box | null;
};

/** An annotation as its edit starts. Several boxes are adjusted as the one around them. */
export function draftOf(annotation: Annotation): EditDraft {
  return {
    statement: annotation.statement,
    attributeIds: [...annotation.attributeIds],
    box: boundsOf(annotation.rects),
  };
}

/** What the draft changes, or null when it changes nothing or has no sentence. */
export function editChanges(
  annotation: Annotation,
  draft: EditDraft,
): EditChanges | null {
  const statement = draft.statement.replace(/\s+/g, " ").trim();
  if (statement === "") {
    return null;
  }
  const changes: EditChanges = {};
  if (statement !== annotation.statement) {
    changes.statement = statement.slice(0, ANNOTATION_BOUNDS.statement);
  }
  const before = [...annotation.attributeIds].sort();
  const after = [...new Set(draft.attributeIds)].sort();
  if (before.join() !== after.join()) {
    changes.attributeIds = after;
  }
  if (draft.box !== null && !sameBox(draft.box, boundsOf(annotation.rects))) {
    changes.rects = [clampBox(draft.box)];
  }
  return Object.keys(changes).length === 0 ? null : changes;
}

export type AnnotationAction =
  | { intent: "confirm"; id: string; version: number }
  | { intent: "confirm-all" }
  | { intent: "edit"; id: string; version: number; changes: EditChanges }
  | { intent: "remove"; id: string; version: number }
  | {
      intent: "add";
      page: number;
      rects: Box[];
      statement: string;
      attributeIds: string[];
      kind: (typeof ANNOTATION_KINDS)[number];
    };

const round = (value: number): number => Math.round(value * 10000) / 10000;

/** Boxes as the API takes them: `[x, y, width, height]` in fractions of the page. */
export function rectsOf(boxes: readonly Box[]): number[][] {
  return boxes
    .slice(0, ANNOTATION_BOUNDS.rects)
    .map((box) => [round(box.x), round(box.y), round(box.w), round(box.h)]);
}

/** What the preview posts to /workspace/evidence-annotations for an action. */
export function annotationFields(
  scope: AnnotationScope,
  action: AnnotationAction,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    organization_id: scope.organizationId,
    project_id: scope.projectId,
    control_id: scope.controlId,
    requirement_id: scope.requirementId,
    file_id: scope.fileId,
    intent: action.intent,
  };
  switch (action.intent) {
    case "confirm":
    case "remove":
      return { ...fields, annotation_id: action.id, version: action.version };
    case "edit":
      return {
        ...fields,
        annotation_id: action.id,
        version: action.version,
        ...(action.changes.statement !== undefined
          ? { statement: action.changes.statement }
          : {}),
        ...(action.changes.attributeIds !== undefined
          ? { attribute_ids: action.changes.attributeIds }
          : {}),
        ...(action.changes.rects !== undefined
          ? { rects: rectsOf(action.changes.rects) }
          : {}),
      };
    case "add":
      return {
        ...fields,
        page: action.page,
        rects: rectsOf(action.rects),
        statement: action.statement,
        attribute_ids: action.attributeIds,
        kind: action.kind,
      };
    default:
      return fields;
  }
}

type Fields = Record<string, unknown>;
export type AnnotationWrite =
  | { path: string; body: Record<string, unknown> }
  | { error: "invalid" };

const INVALID: AnnotationWrite = { error: "invalid" };

/** Rects as posted, checked again: one to eight boxes inside the page, or null. */
function postedRects(value: unknown): number[][] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > ANNOTATION_BOUNDS.rects
  ) {
    return null;
  }
  const boxes = value.map(parseRect);
  return boxes.some((box) => box === null)
    ? null
    : rectsOf(boxes.filter((box): box is Box => box !== null));
}

function postedIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > ANNOTATION_BOUNDS.attributes) {
    return null;
  }
  return value.every((id) => typeof id === "string" && UUID.test(id))
    ? [...new Set(value as string[])]
    : null;
}

/**
 * The API call behind an action (the /workspace/evidence-annotations route): the path under
 * the control and the body of section 5 of the contract. Anything that is not a well-formed
 * action is refused here, before the API is called.
 */
export function annotationWrite(fields: Fields): AnnotationWrite {
  const id = (key: string): string | null => {
    const value = fields[key];
    return typeof value === "string" && UUID.test(value) ? value : null;
  };
  const organizationId = id("organization_id");
  const projectId = id("project_id");
  const controlId = id("control_id");
  const requirementId = id("requirement_id");
  const fileId = id("file_id");
  if (
    organizationId === null ||
    projectId === null ||
    controlId === null ||
    requirementId === null ||
    fileId === null
  ) {
    return INVALID;
  }
  const base = `/organizations/${organizationId}/projects/${projectId}/controls/${controlId}/evidence-annotations`;
  const { intent } = fields;
  if (intent === "confirm-all") {
    return {
      path: `${base}/confirm-all`,
      body: { requirement_id: requirementId, file_id: fileId },
    };
  }
  const statement =
    typeof fields.statement === "string"
      ? fields.statement.replace(/\s+/g, " ").trim()
      : null;
  if (intent === "add") {
    const rects = postedRects(fields.rects);
    const attributeIds = postedIds(fields.attribute_ids);
    const page = wholeFrom(fields.page, 1, 0);
    if (
      rects === null ||
      attributeIds === null ||
      page === 0 ||
      statement === null ||
      statement === "" ||
      statement.length > ANNOTATION_BOUNDS.statement ||
      !(ANNOTATION_KINDS as readonly unknown[]).includes(fields.kind)
    ) {
      return INVALID;
    }
    return {
      path: base,
      body: {
        requirement_id: requirementId,
        file_id: fileId,
        page,
        rects,
        statement,
        attribute_ids: attributeIds,
        kind: fields.kind,
      },
    };
  }
  const annotationId = id("annotation_id");
  // A version is 1 or more: an annotation read without one cannot be decided.
  const version = wholeFrom(fields.version, 1, 0);
  if (annotationId === null || version === 0) {
    return INVALID;
  }
  if (intent === "confirm" || intent === "remove") {
    return { path: `${base}/${annotationId}/${intent}`, body: { version } };
  }
  if (intent === "edit") {
    const body: Record<string, unknown> = { version };
    if (fields.statement !== undefined) {
      if (
        statement === null ||
        statement === "" ||
        statement.length > ANNOTATION_BOUNDS.statement
      ) {
        return INVALID;
      }
      body.statement = statement;
    }
    if (fields.attribute_ids !== undefined) {
      const attributeIds = postedIds(fields.attribute_ids);
      if (attributeIds === null) {
        return INVALID;
      }
      body.attribute_ids = attributeIds;
    }
    if (fields.rects !== undefined) {
      const rects = postedRects(fields.rects);
      if (rects === null) {
        return INVALID;
      }
      body.rects = rects;
    }
    // At least one change: an edit that changes nothing is not sent.
    return Object.keys(body).length === 1
      ? INVALID
      : { path: `${base}/${annotationId}/edit`, body };
  }
  return INVALID;
}

const asSentence = (text: string): string =>
  /[.!?…]$/.test(text) ? text : `${text}.`;

/**
 * What a person reads when an action did not go through; null when the server confirmed
 * it. The server's own sentence is shown as it is where it gives one for a refusal.
 */
export function annotationProblem(status: number, detail = ""): string | null {
  if (status === 200) {
    return null;
  }
  const said = detail.replace(/\s+/g, " ").trim().slice(0, 300);
  if (status === 409) {
    return said !== ""
      ? asSentence(said)
      : "This annotation changed since the page loaded. The list is read again: try once more.";
  }
  if (status === 403) {
    return "Your role cannot change the annotations of this evidence.";
  }
  if (status === 404) {
    return "This annotation is no longer here. The list is read again.";
  }
  if (status === 422 || status === 400) {
    return said !== ""
      ? asSentence(said)
      : "That change could not be saved. Check the sentence and the box, then try again.";
  }
  return "The change did not reach the server. Nothing was saved: try again.";
}

/** What is said once the server has confirmed an action. */
export function doneWords(
  action: AnnotationAction,
  about: { number?: number; count?: number } = {},
): string {
  const which =
    about.number === undefined ? "Annotation" : `Annotation ${about.number}`;
  switch (action.intent) {
    case "confirm":
      return `${which} confirmed.`;
    case "confirm-all":
      return about.count === 1
        ? "1 annotation confirmed."
        : `${about.count ?? 0} annotations confirmed.`;
    case "edit":
      return `${which} saved.`;
    case "remove":
      return `${which} removed. It stays on record.`;
    default:
      return "Annotation added.";
  }
}

/* The annotated copy ------------------------------------------------------------------- */

/** Whether an annotated copy can be made: of an image, with at least one annotation. */
export function copyOffered(fileName: string, set: AnnotationSet): boolean {
  return (
    /\.(png|jpe?g|gif|webp)$/i.test(fileName) && set.annotations.length > 0
  );
}

/** "<file name> (annotated).png": the file's name without its own extension. */
export function annotatedCopyName(fileName: string): string {
  const base = fileName
    .replace(/[\\/:*?"<>|\n\r\t]+/g, " ")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .trim();
  return `${base === "" ? "Evidence" : base} (annotated).png`;
}

export type CopyRow = {
  number: number;
  kind: AnnotationKind;
  /** "A, C", or "" for one that bears on no attribute. */
  letters: string;
  statement: string;
  /** Who reviewed it; a proposal says no person has. */
  review: string;
};

/** The numbered legend drawn under the evidence on the annotated copy. */
export function copyRows(set: AnnotationSet): CopyRow[] {
  return set.annotations.map((annotation) => ({
    number: annotation.number,
    kind: annotation.kind,
    letters: annotation.codes.join(", "),
    statement:
      annotation.statement !== "" ? annotation.statement : annotation.label,
    review:
      annotation.status === "PROPOSED"
        ? `${reviewLine(annotation)}, not reviewed by a person`
        : reviewLine(annotation),
  }));
}

/** Text broken into lines no wider than `width`, as `measure` sizes them. */
export function wrapText(
  text: string,
  width: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
    const next = current === "" ? word : `${current} ${word}`;
    if (current !== "" && measure(next) > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current !== "") {
    lines.push(current);
  }
  return lines;
}

/** The token each tone is drawn with over the evidence, which is a light page in both
 * themes (globals.css). */
export const MARK_TOKEN: Record<KindTone, string> = {
  success: "--mark-success",
  info: "--mark-info",
  source: "--mark-source",
  danger: "--mark-danger",
  neutral: "--mark-neutral",
  cited: "--mark-cited",
};
