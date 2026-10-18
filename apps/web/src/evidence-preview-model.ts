/**
 * Previewing evidence with what the tester relied on highlighted (Milestone 8.4b).
 *
 * A citation names a file, the file's own words, where they sit (a page, a sheet, an
 * image), and for a screenshot a box in fractions of the image. The preview shows a PDF
 * page, an image, or the text read from a spreadsheet or document, and marks each cited
 * passage on it. Everything here is pure, so the matching is tested without a browser.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Box = { x: number; y: number; w: number; h: number };

export type EvidenceCitation = {
  fileId: string;
  fileName: string;
  quote: string;
  /** Whether the words were found in the file's text, or only boxed on an image. */
  found: boolean;
  location: string;
  page: number | null;
  box: Box | null;
  /** The attribute the citation supports, such as "A1", when shown for a result. */
  label: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseBox(value: unknown): Box | null {
  if (!isRecord(value)) {
    return null;
  }
  const [x, y, w, h] = ["x", "y", "w", "h"].map((key) => value[key]);
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof w !== "number" ||
    typeof h !== "number" ||
    x < 0 ||
    y < 0 ||
    w <= 0 ||
    h <= 0 ||
    x + w > 1.001 ||
    y + h > 1.001
  ) {
    return null;
  }
  return { x, y, w, h };
}

export function parseCitations(value: unknown, label = ""): EvidenceCitation[] {
  return (Array.isArray(value) ? value : [])
    .filter(isRecord)
    .filter(
      (item) =>
        typeof item.file_id === "string" &&
        UUID.test(item.file_id) &&
        typeof item.quote === "string",
    )
    .slice(0, 8)
    .map((item) => ({
      fileId: String(item.file_id),
      fileName: typeof item.file_name === "string" ? item.file_name : "",
      quote: String(item.quote).slice(0, 300),
      found: item.found !== false,
      location: typeof item.location === "string" ? item.location : "",
      page:
        typeof item.page === "number" && Number.isInteger(item.page)
          ? item.page
          : null,
      box: parseBox(item.box),
      label,
    }));
}

export type PreviewKind = "pdf" | "image" | "text";

/** How a file is shown: a rendered PDF, an image, or the text read from it. */
export function previewKind(fileName: string): PreviewKind {
  if (/\.pdf$/i.test(fileName)) {
    return "pdf";
  }
  if (/\.(png|jpe?g|gif|webp)$/i.test(fileName)) {
    return "image";
  }
  return "text";
}

/** Text folded for matching: quotes, dashes, spaces, and case do not matter. */
export function fold(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Where the quote is in the text, as [start, end) offsets of the original text. */
export function findSpan(text: string, quote: string): [number, number] | null {
  const needle = fold(quote)
    .trim()
    .replace(/[ .…]+$/, "");
  if (needle.length < 3) {
    return null;
  }
  // Fold the text while remembering where each folded character came from.
  let folded = "";
  const origin: number[] = [];
  let spaced = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = fold(text[index] ?? "");
    if (char === " ") {
      if (spaced) {
        continue;
      }
      spaced = true;
    } else {
      spaced = false;
    }
    folded += char;
    origin.push(index);
  }
  const at = folded.indexOf(needle);
  if (at < 0) {
    return null;
  }
  const last = origin[at + needle.length - 1];
  const first = origin[at];
  return first === undefined || last === undefined ? null : [first, last + 1];
}

/**
 * The PDF text runs a quote covers. pdf.js gives a page's text as runs; the quote may
 * span several. Returns the indexes of the runs to highlight, or [] when not found.
 */
export function pdfRuns(runs: readonly string[], quote: string): number[] {
  let joined = "";
  const owner: number[] = [];
  runs.forEach((run, index) => {
    const piece = `${run} `;
    joined += piece;
    for (let char = 0; char < piece.length; char += 1) {
      owner.push(index);
    }
  });
  const span = findSpan(joined, quote);
  if (span === null) {
    return [];
  }
  const found = new Set<number>();
  for (let char = span[0]; char < span[1]; char += 1) {
    const index = owner[char];
    if (index !== undefined && (runs[index] ?? "").trim() !== "") {
      found.add(index);
    }
  }
  return [...found].sort((a, b) => a - b);
}

export type TextBlock =
  | { kind: "heading"; text: string }
  | { kind: "table"; rows: string[][] }
  | { kind: "text"; text: string };

/**
 * The read text of a file as blocks: sheet and page headings, tables (rows of cells
 * separated by " | "), and plain text.
 */
export function readingBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let table: string[][] | null = null;
  let prose: string[] = [];
  const flushProse = () => {
    if (prose.join("").trim() !== "") {
      blocks.push({ kind: "text", text: prose.join("\n").trim() });
    }
    prose = [];
  };
  const flushTable = () => {
    if (table !== null && table.length > 0) {
      blocks.push({ kind: "table", rows: table });
    }
    table = null;
  };
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const sheet = /^## Sheet: (.+)$/.exec(line);
    const page = /^\[(Page \d+|Image \d+)[^\]]*\]$/.exec(line.trim());
    if (sheet !== null || page !== null) {
      flushProse();
      flushTable();
      blocks.push({
        kind: "heading",
        text: sheet !== null ? `Sheet ${sheet[1]}` : (page?.[1] ?? ""),
      });
      continue;
    }
    if (line.includes(" | ")) {
      flushProse();
      table = table ?? [];
      table.push(line.split(" | ").map((cell) => cell.trim()));
      continue;
    }
    flushTable();
    prose.push(line);
  }
  flushProse();
  flushTable();
  return blocks;
}

/** A text split into plain and marked parts, for the quotes found in it. */
export function markParts(
  text: string,
  quotes: readonly string[],
): Array<{ text: string; mark: boolean }> {
  const spans = quotes
    .map((quote) => findSpan(text, quote))
    .filter((span): span is [number, number] => span !== null)
    .sort((a, b) => a[0] - b[0]);
  const parts: Array<{ text: string; mark: boolean }> = [];
  let at = 0;
  for (const [start, end] of spans) {
    if (start < at) {
      continue;
    }
    if (start > at) {
      parts.push({ text: text.slice(at, start), mark: false });
    }
    parts.push({ text: text.slice(start, end), mark: true });
    at = end;
  }
  if (at < text.length) {
    parts.push({ text: text.slice(at), mark: false });
  }
  return parts;
}

/** The query that names an evidence file for the proxy routes. */
export function fileQuery(organizationId: string, projectId: string): string {
  return new URLSearchParams({
    organization: organizationId,
    project: projectId,
  }).toString();
}
