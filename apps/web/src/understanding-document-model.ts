/**
 * The understanding as a document, the left pane of Control Understanding (prototype approved
 * 17 November 2026: "professional, clean, and SaaS grade"). The statement first, as the
 * summary; the key facts it rests on as a strip; each walkthrough topic as a labelled section;
 * and the same answers as a table of facts and their sources. Pure: the pane renders what
 * this says, and every answer keeps opening to change as before.
 */

import type {
  NarrativeTopic,
  Need,
  Review,
} from "./understanding-chat-model.ts";
import { dayWords } from "./understanding-once-model.ts";

export type DocView = "narrative" | "facts";

export type KeyFact = { key: string; label: string; value: string };

/** At most this many facts in the strip: a glance, not the record. */
export const KEY_FACTS = 6;

/** A label as a fact's heading: the library writes labels mid-sentence ("the access request
 * tool"), the strip names them ("Access request tool"). */
export function factLabel(label: string): string {
  const trimmed = label.trim().replace(/^(the|a|an)\s+/i, "");
  return trimmed === ""
    ? ""
    : `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

/** The facts the statement rests on, in the statement's order: each confirmed point it
 * names, once, with its answer. A point not confirmed is not a fact yet. */
export function keyFacts(review: Review): KeyFact[] {
  const byKey = new Map(review.needs.map((need) => [need.key, need]));
  const seen = new Set<string>();
  const facts: KeyFact[] = [];
  for (const part of review.statement) {
    if (part.key === null || seen.has(part.key)) {
      continue;
    }
    seen.add(part.key);
    const need = byKey.get(part.key);
    if (need === undefined || need.status !== "CONFIRMED") {
      continue;
    }
    const value = need.value.trim();
    const label = factLabel(need.label);
    if (value === "" || label === "") {
      continue;
    }
    facts.push({ key: need.key, label, value });
    if (facts.length === KEY_FACTS) {
      break;
    }
  }
  return facts;
}

/** How many answers a walkthrough section names: "2 answers". */
export function sectionCount(topic: NarrativeTopic): string {
  const count = new Set(
    topic.parts.flatMap((part) => (part.key === null ? [] : [part.key])),
  ).size;
  return count === 0 ? "" : `${count} answer${count === 1 ? "" : "s"}`;
}

/** An answer carried from last year's workpaper is marked apart from one given this year. */
export function carriedFromLastYear(need: Need): boolean {
  return need.source === "PRIOR_YEAR";
}

/** The document's line beside its title: when it was confirmed, once complete, and how many
 * answers are on record. "" where there is nothing to say. */
export function documentMeta(
  completedAt: string | null,
  answers: number,
  timeZone?: string,
): { confirmed: string; answers: string } {
  const day = completedAt === null ? "" : dayWords(completedAt, timeZone);
  return {
    confirmed: day === "" ? "" : `Confirmed ${day}`,
    answers:
      answers === 0 ? "" : `${answers} answer${answers === 1 ? "" : "s"}`,
  };
}
