/**
 * What a step says when an agent's run ended without a usable answer: it failed, its
 * answer was rejected, it kept the earlier state, or it stopped (product owner, 13
 * November 2026: "I don't want anything like this type of bug", after a run whose
 * answers were all rejected showed nothing). One plain sentence: what happened, what was
 * kept, and the next action, beside where the person looked. Never a spinner that stops
 * with nothing, and never an internal code.
 *
 * Every step model that parses an agent run's status exports `runFailureLine`, built on
 * these helpers (tests/run-failure-lines.test.ts checks that each one does). The server's
 * own sentence for the run, where it sends one, leads: `failure_note` on the run's
 * record (`FAILURE_NOTE_FIELD`), read by `failureNoteOf`.
 */

/** The field every agent run's record carries for its failure sentence, once the server
 * sends it. One name, read by every step through `failureNoteOf`. */
export const FAILURE_NOTE_FIELD = "failure_note";

/** The server's failure sentence on a run's record, or "" where it sent none. */
export function failureNoteOf(record: unknown): string {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return "";
  }
  const value = (record as Record<string, unknown>)[FAILURE_NOTE_FIELD];
  return typeof value === "string" ? plainNote(value) : "";
}

// A code, a key, a trace or a payload: what the server may say to its logs, never to a
// person. A sentence that holds one is not shown; the step's own words stand instead.
const CODE_WORD = /\b[a-z0-9]+_[a-z0-9_]+\b|\b[A-Z0-9]+_[A-Z0-9_]+\b/;
const TRACE =
  /Traceback|\b[A-Z][A-Za-z]*(?:Error|Exception)\b|[{}<>]|^\[|\bundefined\b|\bnull\b|\bNaN\b/;
const ONE_WORD = /^[A-Za-z0-9_.:/-]+$/;

function plainPart(part: string): boolean {
  return !ONE_WORD.test(part) && !CODE_WORD.test(part) && !TRACE.test(part);
}

// A validator's words or a schema path, in brackets: "(answers[0].criteria: Input should
// be a valid string)". The bracket goes; the sentence around it stays.
const VALIDATOR =
  /Input should be|does not match the schema|validation error|Field required|\[\d+\]\.|\w\.\w+\[\d+\]/i;

function withoutValidator(text: string): string {
  return text
    .replace(/\s*\(([^()]*)\)/g, (bracket, inside: string) =>
      VALIDATOR.test(inside) ? "" : bracket,
    )
    .replace(/\s+([.!?,;:])/g, "$1");
}

/** The longest sentence shown: a longer one is left out whole, never cut. */
const SENTENCE_MAX = 300;
/** The most a note shows, in whole sentences: room for every agent's sentence of a run. */
const NOTE_MAX = 1200;

/** A server's note fit to show a person: its plain sentences, ended with a full stop; ""
 * for nothing. A sentence that holds a code, a key, a trace or a payload is left out
 * ("The plan was kept. attribute_id is unknown." reads "The plan was kept."), and so is a
 * bracket of a validator's words or a schema path, with the sentence around it kept.
 * Sentences are kept whole: one over SENTENCE_MAX is left out, and the note ends at the
 * last whole sentence within NOTE_MAX. */
export function plainNote(text: string | null | undefined): string {
  const said = withoutValidator((text ?? "").replace(/\s+/g, " ").trim());
  if (said === "") {
    return "";
  }
  const kept: string[] = [];
  let length = 0;
  for (const part of said.split(/(?<=[.!?])\s+/)) {
    const sentence = /[.!?…]$/.test(part) ? part : `${part}.`;
    if (part === "" || !plainPart(part) || sentence.length > SENTENCE_MAX) {
      continue;
    }
    if (length + sentence.length + (kept.length > 0 ? 1 : 0) > NOTE_MAX) {
      break;
    }
    length += sentence.length + (kept.length > 0 ? 1 : 0);
    kept.push(sentence);
  }
  return kept.join(" ");
}

/** The first of the server's sentences fit to show (its failure sentence first, then the
 * run's note), else the step's own. */
export function failureSentence(
  fallback: string,
  ...said: ReadonlyArray<string | null | undefined>
): string {
  for (const each of said) {
    const plain = plainNote(each);
    if (plain !== "") {
      return plain;
    }
  }
  return fallback;
}

// A sentence's own closing instruction, which `withNext` replaces with the step's.
const CLOSING = /\s*(?:Run (?:it |them )?again|Try again|Check again)\.$/;

/** A sentence of what happened with the step's next action in place of its own closing
 * instruction: "The run stopped. Run again." with "Run again, or write the criteria
 * yourself." reads as one sentence of each, never "Run again. Run again". */
export function withNext(sentence: string, next: string): string {
  const what = sentence.replace(CLOSING, "").trim();
  if (next === "") {
    return what;
  }
  if (what === "") {
    return next;
  }
  return `${/[.!?…]$/.test(what) ? what : `${what}.`} ${next}`;
}
