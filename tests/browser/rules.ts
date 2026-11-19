/**
 * What the browser checks assert, as pure functions over what a page measured (no browser
 * here, so tests/browser-rules.test.ts runs them in the node suite).
 */
import { CASUAL, FIRST_PERSON, INTERNAL, NOT_A_PERSON } from "../copy-rules.ts";

/** The gutter at phone width: nothing a person reads crosses it (docs/design-system.md). */
export const GUTTER = 16;
/** Widths below this are phone widths, where the gutter is asserted. */
export const PHONE = 500;

/** A button or link label short enough to be the person's own command ("Guide me"). A
 * longer one (a card that is a link) is prose and is checked like any other text. */
export const LABEL_WORDS = 4;
export const LABEL_CHARS = 32;

/** Copy that breaks the product's rules, with the offending words quoted. `actions`: the
 * labels of the screen's buttons and links; the short ones speak in the person's voice
 * ("Guide me"), so the agent's first person is looked for in the rest. */
export function copyFindings(
  text: string,
  actions: readonly string[] = [],
): string[] {
  const found: string[] = [];
  const flat = text.replace(/[ \t\r\n]+/g, " ");
  const near = (index: number) =>
    flat.slice(Math.max(0, index - 30), index + 30).trim();
  // A double full stop (".." but not an ellipsis "..."), or a space before one.
  for (const match of flat.matchAll(/(?<![.])\.\.(?![.])|\w \.(?:\s|$)/g)) {
    found.push(`double or spaced full stop: "${near(match.index)}"`);
  }
  // (".," is left out: "e.g.," is correct.)
  for (const match of flat.matchAll(/[?!]\.|\.[?!]|,\.|::/g)) {
    found.push(`doubled punctuation: "${near(match.index)}"`);
  }
  for (const pattern of [...INTERNAL, ...CASUAL]) {
    const match = flat.match(pattern);
    if (match?.index !== undefined) {
      found.push(`banned wording ${pattern}: "${near(match.index)}"`);
    }
  }
  let prose = flat.replace(NOT_A_PERSON, "");
  for (const label of actions) {
    const clean = label.replace(/[ \t\r\n]+/g, " ").trim();
    const short =
      clean.length <= LABEL_CHARS && clean.split(" ").length <= LABEL_WORDS;
    if (clean !== "" && short) {
      prose = prose.split(clean).join(" ");
    }
  }
  const person = prose.match(FIRST_PERSON);
  if (person?.index !== undefined) {
    found.push(`first person "${person[0]}"`);
  }
  return found;
}

/** One screen, one story: each declared text is shown, each forbidden one is not. */
export function storyFindings(
  text: string,
  shows: readonly (string | RegExp)[],
  never: readonly (string | RegExp)[] = [],
): string[] {
  const flat = text.replace(/[ \t\r\n]+/g, " ");
  const has = (want: string | RegExp) =>
    typeof want === "string" ? flat.includes(want) : want.test(flat);
  return [
    ...shows.filter((want) => !has(want)).map((want) => `missing: ${want}`),
    ...never.filter(has).map((want) => `contradicts: ${want}`),
  ];
}

export type Box = { left: number; right: number; width: number };

/** A row declared to span its container spans its content box (within 2 px). */
export function spanFindings(
  name: string,
  row: Box | null,
  inner: Box | null,
): string[] {
  if (row === null || inner === null) {
    return [`${name}: not on the screen`];
  }
  const off = Math.max(
    Math.abs(row.left - inner.left),
    Math.abs(row.right - inner.right),
  );
  return off <= 2
    ? []
    : [
        `${name}: spans ${row.left}-${row.right}, its container ${inner.left}-${inner.right}`,
      ];
}

/** Warnings that are defects though React only warns: an update loop, a state update
 * during another component's render, a list without keys, a hydration mismatch. */
export const CONSOLE_WARNINGS =
  /Maximum update depth|Cannot update a component|unique "key"|hydrat/i;

/** Console lines that are the development tooling's own, not the app's. Each is named on
 * purpose: anything else an error or a listed warning says fails the check. */
export const CONSOLE_ALLOWED: readonly RegExp[] = [
  /Download the React DevTools/,
  /^\[HMR\]/,
  /^\[Fast Refresh\]/,
];

/** The console line as a failure, or null when it is not one. */
export function consoleProblem(type: string, text: string): string | null {
  const line = text.replace(/\s+/g, " ").trim();
  if (CONSOLE_ALLOWED.some((allowed) => allowed.test(line))) {
    return null;
  }
  if (type === "error" || (type === "warning" && CONSOLE_WARNINGS.test(line))) {
    return `console ${type}: ${line.slice(0, 200)}`;
  }
  return null;
}

/** What a page measured at one width and theme (lib.ts measure()). */
export type Measured = {
  width: number;
  docScrollWidth: number;
  docClientWidth: number;
  gutterBreaks: string[];
  undeclaredScrollers: string[];
  /** Elements wider than the container that clips them, and words given no width. */
  clipped: string[];
  focus: string | null;
};

export function layoutFindings(m: Measured): string[] {
  const found: string[] = [];
  if (m.docScrollWidth > m.docClientWidth) {
    found.push(
      `the page scrolls sideways: ${m.docScrollWidth} > ${m.docClientWidth}`,
    );
  }
  if (m.width < PHONE) {
    found.push(
      ...m.gutterBreaks.map(
        (what) => `crosses the ${GUTTER}px gutter: ${what}`,
      ),
    );
  }
  found.push(
    ...m.undeclaredScrollers.map(
      (what) => `scrolls sideways, not declared: ${what}`,
    ),
  );
  found.push(...m.clipped.map((what) => `cut off: ${what}`));
  if (m.focus === "body") {
    found.push("focus is on the page body after the action");
  }
  return found;
}
