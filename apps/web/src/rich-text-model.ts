// A formatted text section of a workpaper (docs/design-workpaper.md, section 3.3). The
// section's text is stored as plain text with marks; this file reads it (for showing and
// for the editor) and writes it back from the editor's document. Pure: no editor, no DOM.
// The server reads the same grammar (workpaper_marks.plain); the cases both sides are
// tested against are tests/fixtures/rich-text/cases.json.
//
// The grammar. Lines are read without the spaces around them; blocks are separated by a
// blank line. A block whose every line is "- " and some text is a bulleted list; "1. ",
// "2. ", … and some text, a numbered list; any other block is a paragraph whose line
// breaks are line breaks. In a line, `**bold**`, `''italic''`, `++underline++`, nested as
// needed: a mark opens only directly before a character that is not a space and closes at
// the next such mark in the line that stands directly after one, with something between;
// a mark with no partner is plain text. A backslash directly before one of * + ' \ - .
// makes that character plain and is not itself shown; any other backslash is a backslash.

/** A stretch of text with its formatting. */
export type Run = { t: string; b?: true; i?: true; u?: true };

export type Block =
  | { type: "p"; lines: Run[][] }
  | { type: "ul" | "ol"; items: Run[][] };

type MarkKey = "b" | "i" | "u";

const MARKS: ReadonlyArray<{ key: MarkKey; sign: string }> = [
  { key: "b", sign: "**" },
  { key: "i", sign: "''" },
  { key: "u", sign: "++" },
];
const ESCAPABLE = new Set(["*", "+", "'", "\\", "-", "."]);

type Token =
  | { kind: "text"; text: string }
  | {
      kind: "mark";
      mark: MarkKey;
      sign: string;
      canOpen: boolean;
      canClose: boolean;
    };

const spaced = (char: string | undefined) =>
  char === undefined || /\s/.test(char);

function tokens(line: string): Token[] {
  const found: Token[] = [];
  let text = "";
  const flush = () => {
    if (text !== "") {
      found.push({ kind: "text", text });
      text = "";
    }
  };
  let at = 0;
  while (at < line.length) {
    const char = line[at] as string;
    const next = line[at + 1];
    if (char === "\\" && next !== undefined && ESCAPABLE.has(next)) {
      text += next;
      at += 2;
      continue;
    }
    const mark = MARKS.find((item) => line.startsWith(item.sign, at));
    if (mark !== undefined) {
      flush();
      found.push({
        kind: "mark",
        mark: mark.key,
        sign: mark.sign,
        canOpen: !spaced(line[at + 2]),
        canClose: at > 0 && !spaced(line[at - 1]),
      });
      at += 2;
      continue;
    }
    text += char;
    at += 1;
  }
  flush();
  return found;
}

const same = (one: Run, other: Run) =>
  one.b === other.b && one.i === other.i && one.u === other.u;

/** Runs with nothing in them dropped, and neighbours of the same formatting joined. */
function joined(runs: readonly Run[]): Run[] {
  const made: Run[] = [];
  for (const run of runs) {
    if (run.t === "") {
      continue;
    }
    const last = made[made.length - 1];
    if (last !== undefined && same(last, run)) {
      last.t += run.t;
    } else {
      made.push({ ...run });
    }
  }
  return made;
}

/** One line's runs. */
export function parseLine(line: string): Run[] {
  const all = tokens(line);
  // Where each mark may close, in order: the partner of an opener is the first of them
  // after it (and after something), found without reading the line again.
  const closers: Record<MarkKey, number[]> = { b: [], i: [], u: [] };
  all.forEach((token, at) => {
    if (token.kind === "mark" && token.canClose) {
      closers[token.mark].push(at);
    }
  });
  const partner = (mark: MarkKey, after: number, before: number) => {
    const list = closers[mark];
    let low = 0;
    let high = list.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((list[middle] as number) > after) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    const at = list[low];
    return at !== undefined && at < before ? at : -1;
  };
  const read = (from: number, to: number, on: Omit<Run, "t">): Run[] => {
    const runs: Run[] = [];
    let at = from;
    while (at < to) {
      const token = all[at] as Token;
      if (token.kind === "text") {
        runs.push({ t: token.text, ...on });
        at += 1;
        continue;
      }
      // Its partner stands after at least one thing: nothing between is no formatting.
      const close = token.canOpen ? partner(token.mark, at + 1, to) : -1;
      if (close < 0) {
        runs.push({ t: token.sign, ...on });
        at += 1;
        continue;
      }
      runs.push(...read(at + 1, close, { ...on, [token.mark]: true }));
      at = close + 1;
    }
    return runs;
  };
  return joined(read(0, all.length, {}));
}

// Any character may follow, a line separator included: the server reads it so too.
const BULLET = /^- ([\s\S]+)$/;
const NUMBER = /^\d+\. ([\s\S]+)$/;

/** The text as blocks: paragraphs and lists, each line or item as its runs. */
export function parseRich(text: string): Block[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim());
  const blocks: Block[] = [];
  let block: string[] = [];
  const close = () => {
    if (block.length === 0) {
      return;
    }
    const items = (pattern: RegExp) =>
      block.map((line) => pattern.exec(line)?.[1]?.trim() ?? null);
    const bullets = items(BULLET);
    const numbers = items(NUMBER);
    const list = (found: Array<string | null>) =>
      found.every((item): item is string => item !== null && item !== "")
        ? found.map((item) => parseLine(item as string))
        : null;
    const ul = list(bullets);
    const ol = ul === null ? list(numbers) : null;
    if (ul !== null) {
      blocks.push({ type: "ul", items: ul });
    } else if (ol !== null) {
      blocks.push({ type: "ol", items: ol });
    } else {
      blocks.push({ type: "p", lines: block.map(parseLine) });
    }
    block = [];
  };
  for (const line of lines) {
    if (line === "") {
      close();
    } else {
      block.push(line);
    }
  }
  close();
  return blocks;
}

const said = (runs: readonly Run[]) => runs.map((run) => run.t).join("");

/** The text without its marks, as the server's export writes it: a list item keeps its
 * "- " or its number (from one). */
export function plainText(text: string): string {
  return parseRich(text)
    .map((block) =>
      block.type === "p"
        ? block.lines.map(said).join("\n")
        : block.items
            .map(
              (item, at) =>
                `${block.type === "ul" ? "-" : `${at + 1}.`} ${said(item)}`,
            )
            .join("\n"),
    )
    .join("\n\n");
}

/** Whether the text carries any formatting a plain reading would not show. */
export function isFormatted(text: string): boolean {
  return parseRich(text).some((block) =>
    block.type !== "p"
      ? true
      : block.lines.some((line) =>
          line.some(
            (run) => run.b === true || run.i === true || run.u === true,
          ),
        ),
  );
}

/* Writing it back -------------------------------------------------------------------------- */

/** A stretch of typed text as stored: whatever would read as a mark or an escape is made
 * plain with a backslash. A mark's character is escaped where it stands with another, and
 * at either end of the stretch (what follows may be a mark); a backslash where what
 * follows it would otherwise be taken with it, and at the end. */
function escaped(text: string): string {
  let made = "";
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at] as string;
    const next = text[at + 1];
    const before = text[at - 1];
    if (char === "\\") {
      made += next === undefined || ESCAPABLE.has(next) ? "\\\\" : "\\";
    } else if (char === "*" || char === "+" || char === "'") {
      const edge = at === 0 || at === text.length - 1;
      made += edge || next === char || before === char ? `\\${char}` : char;
    } else {
      made += char;
    }
  }
  return made;
}

function lineText(runs: readonly Run[]): string {
  const made = joined(
    runs.map((run) => ({ ...run, t: run.t.replace(/\s*\n\s*/g, " ") })),
  )
    .map((run) => {
      const core = run.t.trim();
      if (core === "") {
        return run.t;
      }
      const lead = run.t.slice(0, run.t.indexOf(core[0] as string));
      const trail = run.t.slice(lead.length + core.length);
      const on = MARKS.filter((mark) => run[mark.key] === true);
      // A mark opens before, and closes after, a character that is not a space: the
      // spaces at the ends of a formatted stretch stand outside its marks.
      return `${lead}${on.map((mark) => mark.sign).join("")}${escaped(core)}${on
        .map((mark) => mark.sign)
        .reverse()
        .join("")}${trail}`;
    })
    .join("")
    .trim();
  // A typed line that would read as a list item is made plain.
  return made.replace(/^-(?= )/, "\\-").replace(/^(\d+)\.(?= )/, "$1\\.");
}

/** Blocks as stored text: the reverse of parseRich. Empty lines, items and blocks are
 * not written. */
export function richToText(blocks: readonly Block[]): string {
  return blocks
    .map((block) => {
      if (block.type === "p") {
        return block.lines
          .map(lineText)
          .filter((line) => line !== "")
          .join("\n");
      }
      // An item is one line, and its own text never reads as a nested item.
      const items = block.items
        .map((item) => lineText(item))
        .filter((line) => line !== "");
      return items
        .map(
          (line, at) => `${block.type === "ul" ? "-" : `${at + 1}.`} ${line}`,
        )
        .join("\n");
    })
    .filter((block) => block !== "")
    .join("\n\n");
}

/* The editor's document -------------------------------------------------------------------- */

/** A node of the editor's document (ProseMirror's JSON, as TipTap gives and takes it). */
export type DocNode = {
  type: string;
  text?: string;
  marks?: Array<{ type: string }>;
  content?: DocNode[];
};

const MARK_NAMES: Record<MarkKey, string> = {
  b: "bold",
  i: "italic",
  u: "underline",
};

function inline(runs: readonly Run[]): DocNode[] {
  return runs
    .filter((run) => run.t !== "")
    .map((run): DocNode => {
      const marks = MARKS.filter((mark) => run[mark.key] === true).map(
        (mark) => ({ type: MARK_NAMES[mark.key] }),
      );
      return marks.length === 0
        ? { type: "text", text: run.t }
        : { type: "text", text: run.t, marks };
    });
}

/** The stored text as the editor's document. Text with nothing in it is one empty
 * paragraph: a document is never empty. */
export function docFromText(text: string): DocNode {
  const content = parseRich(text).map((block): DocNode => {
    if (block.type === "p") {
      const nodes: DocNode[] = [];
      block.lines.forEach((line, at) => {
        if (at > 0) {
          nodes.push({ type: "hardBreak" });
        }
        nodes.push(...inline(line));
      });
      return nodes.length === 0
        ? { type: "paragraph" }
        : { type: "paragraph", content: nodes };
    }
    return {
      type: block.type === "ul" ? "bulletList" : "orderedList",
      content: block.items.map((item) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: inline(item) }],
      })),
    };
  });
  return {
    type: "doc",
    content: content.length === 0 ? [{ type: "paragraph" }] : content,
  };
}

function runOf(node: DocNode): Run {
  const run: Run = { t: node.text ?? "" };
  for (const mark of node.marks ?? []) {
    const key = (Object.keys(MARK_NAMES) as MarkKey[]).find(
      (name) => MARK_NAMES[name] === mark.type,
    );
    if (key !== undefined) {
      run[key] = true;
    }
  }
  return run;
}

/** A block node's lines: its text, broken at each line break. Whatever else is inside
 * is read for its text. */
function linesOf(node: DocNode): Run[][] {
  const lines: Run[][] = [[]];
  const walk = (inner: DocNode) => {
    if (inner.type === "hardBreak") {
      lines.push([]);
    } else if (inner.type === "text") {
      (lines[lines.length - 1] as Run[]).push(runOf(inner));
    } else {
      (inner.content ?? []).forEach(walk);
    }
  };
  (node.content ?? []).forEach(walk);
  return lines;
}

/** A list's items, one line each: an item's paragraphs and line breaks are joined with a
 * space, and a list inside an item gives its items after it (lists are not nested). */
function itemsOf(list: DocNode): Run[][] {
  const items: Run[][] = [];
  for (const item of list.content ?? []) {
    const own: Run[] = [];
    const later: Run[][] = [];
    for (const child of item.content ?? []) {
      if (child.type === "bulletList" || child.type === "orderedList") {
        later.push(...itemsOf(child));
        continue;
      }
      for (const line of linesOf(child)) {
        if (line.length === 0) {
          continue;
        }
        if (own.length > 0) {
          own.push({ t: " " });
        }
        own.push(...line);
      }
    }
    items.push(own, ...later);
  }
  return items;
}

/** The editor's document as blocks. */
export function blocksFromDoc(doc: DocNode): Block[] {
  return (doc.content ?? []).map((node): Block => {
    if (node.type === "bulletList" || node.type === "orderedList") {
      return {
        type: node.type === "bulletList" ? "ul" : "ol",
        items: itemsOf(node),
      };
    }
    return { type: "p", lines: linesOf(node) };
  });
}

/** The editor's document as the text that is stored. */
export function textFromDoc(doc: DocNode): string {
  return richToText(blocksFromDoc(doc));
}
