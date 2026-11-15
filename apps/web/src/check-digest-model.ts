/**
 * A finished check as the first screen of its row shows it (docs/evidence-assurance.md,
 * section 10.12, which replaces the layout of 10.11): the verdict in one sentence, only
 * what needs this person's attention, what is fine with every caveat, and the attributes
 * one at a time. It arranges what the check's view model (evidence-assurance-model.ts)
 * already words, and decides nothing.
 */
import {
  type AttributeLine,
  type AttributeState,
  type CheckAction,
  CODE_CHECK_WORDS,
  type FollowUpLine,
  type RequestCheck,
  STATE_WORDS,
  type Tone,
} from "./evidence-assurance-model.ts";
import type { IconName } from "./icon-name.ts";

/** A pill: words with a mark; the colour repeats them and never replaces them. */
export type DigestPill = { label: string; icon: IconName; tone: Tone };

/** A recommended follow-up as one line, with those folded under it. */
export type DigestAsk = {
  /** The key of the group's lead, which is `line`. */
  key: string;
  /** The group's lead: its follow-up of the highest priority. */
  line: FollowUpLine;
  /** The lead's own priority in one word: "High", "Medium", "Low". */
  priority: string;
  /** Follow-ups of the same kind for the same attributes, folded under the lead. */
  similar: FollowUpLine[];
};

export type DigestAttribute = {
  key: string;
  letter: string;
  /** The attribute's wording, in full (the screen shows one line of it). */
  text: string;
  status: DigestPill;
  /** The one short line. `lead` is "Missing" for a plain gap, "" otherwise. `more`
   * counts what the line leaves out: after "Missing", the further things not shown;
   * after an exception's or a judgment's own sentence, everything not shown. */
  gist: { lead: string; text: string; more: number };
  /** Everything an opened attribute shows, as the check's own view model words it. */
  line: AttributeLine;
  /** The follow-ups that serve it (one serving two attributes is under both, same key). */
  asks: DigestAsk[];
  /** It waits on this person: it is one of the items under "Needs attention". */
  attention: boolean;
};

/** An item's one control. */
export type AttentionControl =
  /** A tick: include these follow-ups (keys of FollowUpLine). */
  | { type: "ASK"; askKeys: string[] }
  /** A button that opens the attribute ("Decide"). */
  | { type: "OPEN"; label: string }
  /** The check's own action (confirm a type, replace a file). */
  | { type: "ACT"; action: CheckAction; label: string }
  /** A button that reveals something of the screen's own, by the item's key. */
  | { type: "VIEW"; label: string }
  | { type: "NONE" };

/** One thing that waits on this person, in at most two lines with one control. */
export type AttentionItem = {
  key: string;
  kind: "ATTRIBUTE" | "FILE" | "GENERAL" | "OTHER";
  /** In the square: the attribute's letter, the file's reference ("E6"), "" for a general
   * request. */
  mark: string;
  /** The bold line, e.g. "Missing: Who disabled the account." */
  headline: string;
  /** Under a "Missing" headline, the further things not shown that it leaves out
   * ("+2 more"); under any other headline, everything not shown ("+2 missing"). */
  more: number;
  /** The quiet line: the attribute's wording in full (the screen clamps it), or the
   * file's sentence. */
  context: string;
  /** "Finding to decide" where a finding on it waits on the person; "" otherwise. */
  flag: string;
  /** The attribute's state in short words with its mark and tone; null for a file, a
   * general request or another item. */
  status: DigestPill | null;
  control: AttentionControl;
  /** The attribute to open; null for a file or a general request. */
  attributeKey: string | null;
};

/** What is fine, and what must not be lost, in a few words: every attribute that has no
 * item under "Needs attention", then every caveat. */
export type QuietItem = {
  key: string;
  /** SHOWN: shown by the records or by a document. OTHER_STATE: any other attribute
   * without an item, in its own state's words. */
  kind: "SHOWN" | "OTHER_STATE" | "CAVEAT";
  /** "C shown", "C shown in design", "E waiting on a file", "D shown (not asked for)",
   * "Reliability to resolve", "Read in part", "1 file left out". */
  text: string;
  icon: IconName;
  tone: Tone;
  /** An attribute opens; a caveat does not. */
  attributeKey: string | null;
};

export type DigestDetails = {
  /** What is inside, as the closed line names it: "5 considerations · about 2 files". */
  summary: string;
  /** False where there is nothing to open. */
  any: boolean;
};

export type CheckDigest = {
  /** The proposed outcome; null for a check that has no review (engine 1). */
  outcome: DigestPill | null;
  /** The completeness caveat; null where the evidence is complete. */
  caveat: DigestPill | null;
  /** "1 of 4 attributes is shown. 3 need your attention." */
  verdict: string;
  /** What waits on this person, one item each. */
  attention: AttentionItem[];
  /** Every attribute without an item, then every caveat. */
  quiet: QuietItem[];
  /** What the first screen says where nothing needs attention; "" where something
   * does. */
  calm: string;
  /** Attribute keys, one at a time: those needing attention first, then the rest. */
  steps: string[];
  attributes: DigestAttribute[];
  asks: DigestAsk[];
  /** Every listed follow-up, folded ones included. */
  askTotal: number;
  /** "2 more follow-ups are not listed here."; "" where every one is listed. */
  asksMore: string;
  details: DigestDetails;
};

/** A finding as the digest needs it: whether a person has still to decide it. */
export type DigestFinding = { id: string; status: string };

/** A file of the row: its id and its name, in the row's order. */
export type DigestFile = { id: string; name: string };

/** Something of the screen's own that the digest places: an item under "Needs attention"
 * with a button that reveals it, or (`caveat`) a caveat on the quiet line. */
export type DigestExtra = {
  key: string;
  mark: string;
  headline: string;
  context: string;
  /** The button's words. */
  label: string;
  caveat: boolean;
};

// The words, said here once: the view and the tests read them from here.

/** An attribute's state in short words, each with the line's own mark. */
export const STATUS_SHOWN = "Shown";
/** Shown by what a document requires only, not by the records of an instance. */
export const STATUS_SHOWN_DESIGN = "Shown in design";
/** Supported, where the check does not say whether by records or by a document: never
 * the green "Shown". */
export const STATUS_SUPPORTED = "Supported";
/** Only of an attribute this request shows in part and leaves the rest to others: never
 * of an open issue (section 10.12). */
export const STATUS_IN_PART = "Shown in part";
export const STATUS_NOT_SHOWN = "Not shown";
export const STATUS_JUDGMENT = "Your judgment";
export const STATUS_NOT_ADDRESSED = "Not addressed";

/** Before the first thing not shown: "Missing: The provisioning record." */
export const MISSING = "Missing";
export const GIST_MISSING = MISSING;
/** Under an attribute the request asks for that its files do not bear on. */
export const GIST_NOT_IN_FILES = "Not in these files.";
/** The short line's length, at most. */
export const GIST_LIMIT = 90;
/** A first sentence shorter than this, with more text after it, runs on to the next. */
export const SENTENCE_MIN = 12;
const ELLIPSIS = "…";

/** The caveat's mark, as the review's own line marks it. */
export const CAVEAT_ICON: IconName = "info";

/** The tick beside an item the check recommends a follow-up for. */
export const ASK_OWNER = "Ask owner";
/** The button that opens an attribute left to the person's judgment. */
export const DECIDE = "Decide";
/** The first screen where nothing waits on the person, the outcome is a success (or the
 * check has no review) and there is no caveat of any kind. */
export const DIGEST_NOTHING = "Nothing needs your attention.";
/** On an item whose finding a person has still to decide. */
export const FINDING_TO_DECIDE = "Finding to decide";
/** A finding waits on the person while it is proposed, or answered by the owner. */
export const FINDING_WAITS: readonly string[] = ["PROPOSED", "ANSWERED"];

/** A file's item, in bold: what to do. */
export const NEED_CONFIRM_TITLE = "Confirm this file's type.";
export const NEED_FILE_TITLE = "A file was left out.";
/** A follow-up the review sent without a word of what to ask for. */
export const ASK_UNSAID = "A follow-up without its wording.";

/** The quiet line: "C shown", "C shown in design". */
export const QUIET_SHOWN = "shown";
export const QUIET_SHOWN_DESIGN = "shown in design";
export const QUIET_READ_IN_PART = "Read in part";
/** After an attribute the request does not ask for, on the quiet line. */
export const QUIET_NOT_ASKED = " (not asked for)";

/** A file's line as an item says it, once: without the file's name as a lead where the
 * sentence names the file itself, and without the closing instruction the item's own
 * button already gives. The rest is the check's sentence, unchanged. */
export function needDetail(line: string): string {
  const said = line.trim();
  const cut = said.indexOf(": ");
  const lead = cut > 0 ? said.slice(0, cut) : "";
  const rest = cut > 0 ? said.slice(cut + 2).trim() : said;
  const body = lead !== "" && rest.includes(lead) ? rest : said;
  const closed = body.replace(/\s*Confirm its kind\.$/u, "").trim();
  return closed === "" ? said : closed;
}

/** What the closed details line names, in its order. */
export const DETAILS_EXPLANATION = "the check's explanation";
export const DETAILS_READ_IN_PART = "read in part";
export const DETAILS_AGAINST = "what it was checked against";
export const DETAILS_SEPARATOR = " · ";

/** The follow-up form's limit, which the text it starts with stays within. */
export const ASK_LIMIT = 1000;

const counted = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** "1 file left out", "2 files left out": files left out that have no action. */
export const filesLeftOut = (count: number) =>
  `${counted(count, "file")} left out`;

/** "1 of 4 attributes is shown.": of the attributes the request asks for, those shown by
 * the records of an instance. One shown only in design, and one the check supports
 * without saying how, are never counted here. */
export const verdictShown = (shown: number, asked: number) =>
  `${shown} of ${counted(asked, "attribute")} ${shown === 1 || asked === 1 ? "is" : "are"} shown.`;
/** "1 shown in design.", said apart. */
export const verdictDesign = (count: number) => `${count} shown in design.`;
/** "1 supported, the check does not say how.", said apart: it is not counted as shown. */
export const verdictUnsaid = (count: number) =>
  `${count} supported, the check does not say how.`;
/** "3 need your attention.": the number of items under "Needs attention". */
export const verdictAttention = (count: number) =>
  `${count} need${count === 1 ? "s" : ""} your attention.`;
/** The verdict of a check with no result for an attribute the request asks for. */
export const VERDICT_NO_RESULT =
  "The check has no result for an attribute this request asks for.";

// Text, cut for one line

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

/** Words that end in a full stop without ending a sentence. */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  "mr.",
  "mrs.",
  "ms.",
  "dr.",
  "e.g.",
  "i.e.",
  "etc.",
  "no.",
  "vs.",
  "u.s.",
  "inc.",
  "ltd.",
]);

/** Whether the full stop after `before` ends a sentence: not after an initial ("J."), a
 * known abbreviation ("e.g.", "No."), or a number or letter that marks a list item
 * ("1.", "a.", "ii." at the start, or after a colon or other punctuation). */
function stops(before: string): boolean {
  const word = /\S*$/.exec(before)?.[0] ?? "";
  const bare = word.replace(/^[("'“‘[]+/, "");
  if (/^[A-Z]$/.test(bare) || ABBREVIATIONS.has(`${bare.toLowerCase()}.`)) {
    return false;
  }
  const led = before.slice(0, before.length - word.length).trim();
  const marker = /^(\d{1,3}|[a-z]|[ivx]{1,4})$/i.test(bare);
  return !(marker && (led === "" || /[:;,.!?…(-]$/.test(led)));
}

/** A text's first sentence, on one line. A full stop inside a file's name or a number,
 * or after an abbreviation, an initial or a list number, does not end it; and a sentence
 * shorter than SENTENCE_MIN runs on to the next where more text follows. */
export function firstSentence(text: string): string {
  const said = flat(text);
  const ends = /[.!?…]+["'”’)\]]*(?=\s+[^\sa-z0-9]|$)/g;
  for (const end of said.matchAll(ends)) {
    const head = said.slice(0, end.index + end[0].length);
    if (head.length === said.length) {
      break;
    }
    const full = /^\.[^.!?…]*$/.test(end[0]);
    if (
      head.length >= SENTENCE_MIN &&
      (!full || stops(said.slice(0, end.index)))
    ) {
      return head;
    }
  }
  return said;
}

/** A text within `limit` characters: whole where it fits, otherwise cut at the end of a
 * word and closed with an ellipsis (which counts towards the limit). */
export function cutAtWord(text: string, limit: number): string {
  const said = flat(text);
  if (said.length <= limit) {
    return said;
  }
  if (limit < 1) {
    return "";
  }
  const head = said.slice(0, limit - 1);
  // The cut falls between two words, or the last whole word ends before it.
  const whole = /\s/.test(said.charAt(limit - 1)) ? head : null;
  const at = head.search(/\s\S*$/);
  const kept = (whole ?? (at > 0 ? head.slice(0, at) : head))
    // Never half of a character written as a pair, and no loose punctuation before the
    // ellipsis.
    .replace(/[\uD800-\uDBFF]$/, "")
    .replace(/[\s,;:.([{'"-]+$/, "");
  return `${kept}${ELLIPSIS}`;
}

/** A sentence, closed with a full stop where it has no end of its own. */
const closed = (text: string) =>
  text === "" || /[.!?…]["'”’)\]]*$/.test(text) ? text : `${text}.`;

/** The one short line: a text's first sentence, within the line's length. */
function short(text: string | null | undefined): string {
  return cutAtWord(closed(firstSentence(text ?? "")), GIST_LIMIT);
}

/** The first of the texts that says something, as one short line; "" where none does. */
const firstShort = (...texts: Array<string | null | undefined>) =>
  texts.map(short).find((text) => text !== "") ?? "";

// One attribute

/** A letter as it sorts: its letters first (a shorter run before a longer one, so Z
 * comes before AA), then whatever follows them. */
function letterRank(letter: string): [number, string, string] {
  const said = letter.trim().toUpperCase();
  const run = /^[A-Z]*/.exec(said)?.[0] ?? "";
  return [run.length, run, said.slice(run.length)];
}

/** The attributes' own order: A to Z, then AA, AB and on. Lines whose letters are the
 * same keep the order they came in, and a line without a letter comes last. */
function byLetter(a: AttributeLine, b: AttributeLine): number {
  const [one, two] = [a.letter.trim(), b.letter.trim()];
  if (one === "" || two === "") {
    return one === two ? 0 : one === "" ? 1 : -1;
  }
  const [x, y] = [letterRank(one), letterRank(two)];
  return (
    x[0] - y[0] ||
    (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0) ||
    x[2].localeCompare(y[2], "en", { numeric: true })
  );
}

const capital = (text: string) =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
const small = (text: string) =>
  `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

/** An open issue in short words, from its own label: "Issue: not met" is "Not met", and
 * "Issue: met in part" is "Met in part". Never "Shown" or "Shown in part", whatever the
 * label says: those are a supported attribute's and a part's words. */
function issueWords(label: string): string {
  const said = flat(label.replace(/^\s*issue\b\s*:?\s*/i, ""));
  const plain = said.toLowerCase();
  if (/\bnot shown\b/.test(plain)) {
    return STATUS_NOT_SHOWN;
  }
  const benign =
    /^(shown|supported|met)\b/.test(plain) && !/^met in part\b/.test(plain);
  return said === "" || benign ? STATE_WORDS.ISSUE.label : capital(said);
}

function statusWords(line: AttributeLine): string {
  const own = flat(line.label);
  const words: Record<AttributeState, string> = {
    SUPPORTED: line.shows === "DESIGN" ? STATUS_SHOWN_DESIGN : STATUS_SHOWN,
    PARTLY: STATUS_IN_PART,
    ISSUE: issueWords(line.label),
    JUDGMENT: STATUS_JUDGMENT,
    // A decided issue, and a result that waits on a file, keep the line's own words.
    DECIDED: own || STATE_WORDS.DECIDED.label,
    WAITING: own || STATE_WORDS.WAITING.label,
    NOT_ADDRESSED: STATUS_NOT_ADDRESSED,
  };
  return words[line.state];
}

/** The state in short words with the line's own mark and tone. Only a supported
 * attribute is ever toned as a success, and only where the check says what shows it. */
export function attributeStatus(line: AttributeLine): DigestPill {
  if (line.state === "SUPPORTED" && line.shows === null) {
    return { label: STATUS_SUPPORTED, icon: line.icon, tone: "neutral" };
  }
  const label = statusWords(line);
  return line.state !== "SUPPORTED" && line.tone === "success"
    ? {
        label,
        icon: STATE_WORDS[line.state].icon,
        tone: STATE_WORDS[line.state].tone,
      }
    : { label, icon: line.icon, tone: line.tone };
}

/** Everything the line names as not shown, its own and its elements', each once. */
export function absentOf(line: AttributeLine): string[] {
  const seen = new Set<string>();
  return [...line.absent, ...line.elements.flatMap((element) => element.absent)]
    .map(flat)
    .filter((item) => {
      const key = item.toLowerCase().replace(/[.\s]+$/, "");
      if (key === "" || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

const PASSED = CODE_CHECK_WORDS.PASSED.label;

/** A comparison that did not pass, in the check's own words. */
const NOT_PASSED: readonly string[] = [
  CODE_CHECK_WORDS.FAILED.label,
  CODE_CHECK_WORDS.FAILED_ONE.label,
];

/** An issue the records themselves show, open or decided: a comparison on it did not
 * pass, or its own label says the evidence contradicts it. Read from what the line
 * carries, never guessed from what is absent. */
function exception(line: AttributeLine): boolean {
  return (
    (line.state === "ISSUE" || line.state === "DECIDED") &&
    (line.checks.some((check) => NOT_PASSED.includes(check.result)) ||
      /\bcontradict/i.test(line.label))
  );
}

function gistOf(
  line: AttributeLine,
  status: DigestPill,
): DigestAttribute["gist"] {
  const absent = absentOf(line);
  const said = (text: string, more = 0) => ({ lead: "", text, more });
  // A disagreement or an exception is never worded as a gap: its own sentence leads,
  // and what is not shown is counted after it. For a judgment that is the sentence over
  // the two readings where this page has one to say (none came, or the result could not
  // be read as sent), else the server's own.
  if (line.state === "JUDGMENT") {
    return said(
      firstShort(line.judgment, line.summary, status.label),
      absent.length,
    );
  }
  if (exception(line)) {
    return said(firstShort(line.summary, status.label), absent.length);
  }
  const [gap, ...further] = absent;
  if (gap !== undefined) {
    return { lead: MISSING, text: short(gap), more: further.length };
  }
  if (line.state === "NOT_ADDRESSED") {
    return said(GIST_NOT_IN_FILES);
  }
  if (line.state === "SUPPORTED") {
    // A comparison that passed is quoted only where every comparison on the attribute
    // passed: never beside one that failed or was not made.
    const [compared] = line.checks;
    const passed = line.checks.every((check) => check.result === PASSED);
    return said(
      firstShort(
        passed ? compared?.sentence : null,
        line.summary,
        line.label,
        status.label,
      ),
    );
  }
  // A comparison that passed is never the short line of anything else.
  return said(firstShort(line.summary, status.label));
}

/** The short line as one sentence: "Missing: The provisioning record." */
export function gistLine(gist: DigestAttribute["gist"]): string {
  return gist.lead === "" ? gist.text : `${gist.lead}: ${gist.text}`;
}

/** The states that wait on the person where the request asks for the attribute. */
const OPEN_STATES: ReadonlySet<AttributeState> = new Set<AttributeState>([
  "ISSUE",
  "PARTLY",
  "JUDGMENT",
  "NOT_ADDRESSED",
  "WAITING",
]);

// What to ask the owner

/** A priority as it ranks: high first; one this page does not know, last. */
function priorityRank(line: FollowUpLine): number {
  const at = ["high", "medium", "low"].findIndex((word) =>
    flat(line.priority).toLowerCase().startsWith(word),
  );
  return at < 0 ? 3 : at;
}

/** The follow-ups as groups, in the review's order: those of the same kind for the same
 * attributes are one group, led by its follow-up of the highest priority (the earlier
 * of two alike), the others folded under it in their order. One that names no attribute
 * is never folded. */
function asksOf(followUps: readonly FollowUpLine[]): DigestAsk[] {
  const groups: FollowUpLine[][] = [];
  const named = new Map<string, FollowUpLine[]>();
  for (const line of followUps) {
    const letters = [...new Set(line.letters)].sort();
    const name =
      letters.length === 0 ? null : JSON.stringify([line.kind, letters]);
    const group = name === null ? undefined : named.get(name);
    if (group !== undefined) {
      group.push(line);
      continue;
    }
    const made = [line];
    groups.push(made);
    if (name !== null) {
      named.set(name, made);
    }
  }
  return groups.flatMap((lines) => {
    const [first] = lines;
    if (first === undefined) {
      return [];
    }
    const lead = lines.reduce(
      (best, line) => (priorityRank(line) < priorityRank(best) ? line : best),
      first,
    );
    return [
      {
        key: lead.key,
        line: lead,
        priority: flat(lead.priority).split(" ")[0] ?? "",
        similar: lines.filter((line) => line !== lead),
      },
    ];
  });
}

/** The letters a follow-up names, each once, without blanks. */
const lettersOf = (line: FollowUpLine) => [
  ...new Set(line.letters.map(flat).filter((letter) => letter !== "")),
];

// What waits on the person

/** What an extra says: its headline; where it has none, its context, then its button's
 * words, so that it is never an empty line. "" where it says nothing at all. */
const extraWords = (extra: DigestExtra) =>
  [extra.headline, extra.context, extra.label]
    .map(flat)
    .find((text) => text !== "") ?? "";

function attentionOf(
  check: RequestCheck,
  rows: readonly DigestAttribute[],
  asks: readonly DigestAsk[],
  waiting: ReadonlySet<string>,
  rowFiles: readonly DigestFile[],
  extras: readonly DigestExtra[],
): AttentionItem[] {
  const attributes: AttentionItem[] = rows
    .filter((row) => row.attention)
    .map((row) => ({
      key: `ATTRIBUTE:${row.key}`,
      kind: "ATTRIBUTE",
      mark: row.letter,
      headline: gistLine(row.gist),
      more: row.gist.more,
      context: row.text,
      flag:
        row.line.findingId !== null && waiting.has(row.line.findingId)
          ? FINDING_TO_DECIDE
          : "",
      status: row.status,
      control:
        row.line.state === "JUDGMENT"
          ? { type: "OPEN", label: DECIDE }
          : row.asks.length > 0
            ? { type: "ASK", askKeys: row.asks.map((ask) => ask.key) }
            : { type: "NONE" },
      attributeKey: row.key,
    }));
  const files = (
    kind: "CONFIRM_TYPE" | "FILE",
    headline: string,
    lines: RequestCheck["leftOut"],
  ): AttentionItem[] =>
    lines.flatMap((item, at) =>
      item.action === null
        ? []
        : [
            {
              key: `${kind}:${item.fileId || at}`,
              kind: "FILE",
              mark: fileRef(rowFiles, item.fileId),
              headline,
              more: 0,
              context: needDetail(item.line),
              flag: "",
              status: null,
              control: {
                type: "ACT",
                action: item.action,
                label: item.action.label,
              },
              attributeKey: null,
            },
          ],
    );
  // A follow-up that names no attribute, and one that names only attributes with no
  // item above: its tick is on the first screen too, so nothing is asked unseen.
  const listed = new Set(
    rows.filter((row) => row.attention).map((row) => row.letter),
  );
  const general: AttentionItem[] = asks
    .filter((ask) => !lettersOf(ask.line).some((letter) => listed.has(letter)))
    .map((ask) => {
      const request = flat(ask.line.request);
      const headline =
        firstShort(request, ask.line.missing, ask.line.why) || ASK_UNSAID;
      return {
        key: `GENERAL:${ask.key}`,
        kind: "GENERAL",
        mark: "",
        headline,
        more: 0,
        // The request in full where the bold line leaves some of it out; otherwise
        // which attributes it is for, and why it matters.
        context: [
          closed(flat(ask.line.serves)),
          headline === closed(request) ? flat(ask.line.why) : request,
        ]
          .filter((part) => part !== "")
          .join(" "),
        flag: "",
        status: null,
        control: { type: "ASK", askKeys: [ask.key] },
        attributeKey: null,
      };
    });
  // What the screen itself has for the person: the item's button reveals it.
  const other: AttentionItem[] = extras
    .filter((extra) => !extra.caveat && extraWords(extra) !== "")
    .map((extra) => ({
      key: extra.key,
      kind: "OTHER",
      mark: flat(extra.mark),
      headline: extraWords(extra),
      more: 0,
      context: flat(extra.headline) === "" ? "" : flat(extra.context),
      flag: "",
      status: null,
      control: { type: "VIEW", label: flat(extra.label) },
      attributeKey: null,
    }));
  return [
    ...attributes,
    ...files("CONFIRM_TYPE", NEED_CONFIRM_TITLE, check.confirm),
    ...files("FILE", NEED_FILE_TITLE, check.leftOut),
    ...other,
    ...general,
  ];
}

// What is fine, and what must not be lost

/** The files left out that have no action of their own, and the notes on a file's type
 * that have none. */
const actionless = (lines: RequestCheck["leftOut"]) =>
  lines.filter((item) => item.action === null).length;

function quietOf(
  check: RequestCheck,
  rows: readonly DigestAttribute[],
  caveat: DigestPill | null,
  extras: readonly DigestExtra[],
): QuietItem[] {
  // Every attribute that has no item above, in its own state's words and tone: none is
  // reachable only by stepping through the attributes.
  const attributes: QuietItem[] = rows
    .filter((row) => !row.attention)
    .map((row) => {
      // Shown by the records of an instance, or by what a document requires.
      const shown = row.line.state === "SUPPORTED" && row.line.shows !== null;
      const words = !shown
        ? small(row.status.label)
        : row.line.shows === "DESIGN"
          ? QUIET_SHOWN_DESIGN
          : QUIET_SHOWN;
      const text =
        row.letter === "" ? capital(words) : `${row.letter} ${words}`;
      return {
        key: `${shown ? "SHOWN" : "STATE"}:${row.key}`,
        kind: shown ? "SHOWN" : "OTHER_STATE",
        text: `${text}${row.line.expected ? "" : QUIET_NOT_ASKED}`,
        icon: row.status.icon,
        tone: row.status.tone,
        attributeKey: row.key,
      };
    });
  const said = (key: string, text: string): QuietItem => ({
    key,
    kind: "CAVEAT",
    text,
    icon: CAVEAT_ICON,
    tone: "warning",
    attributeKey: null,
  });
  const leftOut = actionless(check.leftOut);
  const partSaid =
    caveat?.label.toLowerCase().includes(QUIET_READ_IN_PART.toLowerCase()) ??
    false;
  return [
    ...attributes,
    // Every caveat, of either engine: none is clipped or left out.
    ...(caveat === null ? [] : [said("CAVEAT:COMPLETENESS", caveat.label)]),
    ...(check.readInPart !== null && !partSaid
      ? [said("CAVEAT:READ_IN_PART", QUIET_READ_IN_PART)]
      : []),
    ...(leftOut > 0 ? [said("CAVEAT:LEFT_OUT", filesLeftOut(leftOut))] : []),
    // The screen's own caveats, in its words.
    ...extras
      .filter((extra) => extra.caveat && extraWords(extra) !== "")
      .map((extra) => said(extra.key, extraWords(extra))),
  ];
}

/** A text's first two sentences, at most. */
function twoSentences(text: string): string {
  const said = flat(text);
  const one = firstSentence(said);
  const two = firstSentence(said.slice(one.length));
  return [one, two].filter((part) => part !== "").join(" ");
}

/** What the first screen says where nothing needs attention. "Nothing needs your
 * attention." only where nothing says otherwise: the outcome is a success (or the check
 * has no review, and has a result for what the request asks for) and there is no
 * caveat of any kind. Otherwise the review's own explanation; without one, the
 * caveats' own words. */
function calmOf(
  check: RequestCheck,
  quiet: readonly QuietItem[],
  asked: number,
): string {
  const review = check.review;
  const caveats = quiet.filter((item) => item.kind === "CAVEAT");
  const fine = review === null ? asked > 0 : review.state === "SUFFICIENT";
  if (fine && caveats.length === 0) {
    return DIGEST_NOTHING;
  }
  return (
    twoSentences(review?.explanation ?? "") ||
    caveats.map((item) => closed(flat(item.text))).join(" ")
  );
}

// The rest, behind one line

function detailsOf(check: RequestCheck): DigestDetails {
  const review = check.review;
  const some = (count: number, words: string) => (count > 0 ? words : "");
  const [leftOut, typed] = [
    actionless(check.leftOut),
    actionless(check.confirm),
  ];
  const parts = [
    review !== null && review.explanation !== "" ? DETAILS_EXPLANATION : "",
    ...(review === null
      ? []
      : [
          some(
            review.considerations.length,
            counted(review.considerations.length, "consideration"),
          ),
          some(
            review.concerns.length,
            counted(review.concerns.length, "fact to note", "facts to note"),
          ),
          some(
            review.files.length,
            `about ${counted(review.files.length, "file")}`,
          ),
          some(review.resolved.length, `${review.resolved.length} resolved`),
          // Follow-ups that are not listed, where no listed one is there to say so
          // beside: the sentence is always reachable.
          review.followUps.length === 0
            ? small(flat(review.more).replace(/\.$/, ""))
            : "",
        ]),
    some(check.notAsked.length, `${check.notAsked.length} not asked for`),
    review !== null && review.completeness !== null
      ? `why: ${review.completeness.label.toLowerCase()}`
      : "",
    // What has no action of its own stays here: it is said, never passed over.
    some(leftOut, filesLeftOut(leftOut)),
    some(
      typed,
      counted(typed, "note on a file's type", "notes on files' types"),
    ),
    check.readInPart !== null ? DETAILS_READ_IN_PART : "",
    check.line !== "" ? DETAILS_AGAINST : "",
  ].filter((part) => part !== "");
  return { summary: parts.join(DETAILS_SEPARATOR), any: parts.length > 0 };
}

/** The digest of a finished check; null for a check that is not finished (it keeps its
 * one line and action). `files` are the row's files in their order: "E1" is the first. */
export function checkDigest(
  check: RequestCheck,
  findings: readonly DigestFinding[],
  files: readonly DigestFile[],
  extras: readonly DigestExtra[] = [],
): CheckDigest | null {
  if (check.standing !== "REVIEWED") {
    return null;
  }
  const review = check.review;
  const asks = asksOf(review?.followUps ?? []);
  const waiting = new Set(
    findings
      .filter(
        (finding) =>
          FINDING_WAITS.includes(finding.status) && finding.id !== "",
      )
      .map((finding) => finding.id),
  );
  const attributes = [...check.attributes, ...check.notAddressed]
    .sort(byLetter)
    .map((line): DigestAttribute => {
      const status = attributeStatus(line);
      return {
        key: line.key,
        letter: line.letter,
        text: line.text,
        status,
        gist: gistOf(line, status),
        line,
        asks:
          line.letter === ""
            ? []
            : asks.filter((ask) => lettersOf(ask.line).includes(line.letter)),
        // An attribute the request asks for that is not shown; an issue or a judgment
        // on any attribute (the records may show an exception on one the request does
        // not ask for); or one whose finding a person has still to decide.
        attention:
          (OPEN_STATES.has(line.state) && line.expected) ||
          line.state === "ISSUE" ||
          line.state === "JUDGMENT" ||
          (line.findingId !== null && waiting.has(line.findingId)),
      };
    });
  const caveat: DigestPill | null =
    review === null || review.completeness === null
      ? null
      : {
          label: review.completeness.label,
          icon: CAVEAT_ICON,
          tone: "warning",
        };
  const attention = attentionOf(
    check,
    attributes,
    asks,
    waiting,
    files,
    extras,
  );
  const quiet = quietOf(check, attributes, caveat, extras);
  // Of the attributes the request asks for: those the records of an instance show;
  // apart, those shown only by what a document requires, and those supported without
  // the check saying how.
  const asked = attributes.filter((row) => row.line.expected);
  const supported = asked.filter((row) => row.line.state === "SUPPORTED");
  const shows = (how: AttributeLine["shows"]) =>
    supported.filter((row) => row.line.shows === how).length;
  return {
    // The review's own words: a proposal, never said as more than it says.
    outcome:
      review === null
        ? null
        : { label: review.label, icon: review.icon, tone: review.tone },
    caveat,
    verdict: [
      asked.length > 0
        ? verdictShown(shows("IMPLEMENTATION"), asked.length)
        : VERDICT_NO_RESULT,
      shows("DESIGN") > 0 ? verdictDesign(shows("DESIGN")) : "",
      shows(null) > 0 ? verdictUnsaid(shows(null)) : "",
      attention.length > 0 ? verdictAttention(attention.length) : "",
    ]
      .filter((part) => part !== "")
      .join(" "),
    attention,
    quiet,
    calm: attention.length > 0 ? "" : calmOf(check, quiet, asked.length),
    steps: [
      ...attributes.filter((row) => row.attention),
      ...attributes.filter((row) => !row.attention),
    ].map((row) => row.key),
    attributes,
    asks,
    askTotal: asks.reduce((sum, ask) => sum + 1 + ask.similar.length, 0),
    asksMore: review?.more ?? "",
    details: detailsOf(check),
  };
}

/** A file's reference among the row's files, in their order: "E1" is the first; "" where
 * the file is not one of the row's. */
export function fileRef(
  files: readonly DigestFile[],
  fileId: string | null,
): string {
  const at =
    fileId === null || fileId === ""
      ? -1
      : files.findIndex((file) => file.id === fileId);
  return at < 0 ? "" : `E${at + 1}`;
}

/** A ticked request on its own line, under its letters where it has any: "A, C: …". */
function askLine(line: FollowUpLine): string {
  const request = flat(line.request);
  const letters = line.letters.map(flat).filter((letter) => letter !== "");
  return request === "" || letters.length === 0
    ? request
    : `${letters.join(", ")}: ${request}`;
}

/** The ticked requests as lines, in the list's order: each group's lead, then those
 * folded under it. */
export function askLines(
  digest: CheckDigest,
  ticked: ReadonlySet<string>,
): string[] {
  return digest.asks
    .flatMap((ask) => [ask.line, ...ask.similar])
    .filter((line) => ticked.has(line.key))
    .map(askLine)
    .filter((line) => line !== "");
}

/** The text "Ask owner for N items" starts the follow-up form with: the ticked requests,
 * one per line, bounded to the form's limit. */
export function askText(
  digest: CheckDigest,
  ticked: ReadonlySet<string>,
  limit = ASK_LIMIT,
): string {
  const lines = askLines(digest, ticked);
  const [first] = lines;
  if (first === undefined || Number.isNaN(limit) || limit < 1) {
    return "";
  }
  // Whole lines only: the first that does not fit ends the text, so a later, shorter
  // line is never taken in its place. A first line that is too long by itself is cut at
  // a word.
  if (first.length > limit) {
    return cutAtWord(first, limit);
  }
  let text = first;
  for (const line of lines.slice(1)) {
    if (text.length + 1 + line.length > limit) {
      break;
    }
    text = `${text}\n${line}`;
  }
  return text;
}

/** The keys ticked to start: the lead of each group, and each follow-up that names no
 * attribute. Never a folded one, and never one whose attributes are all left to the
 * person's judgment: what to ask for those follows from what the person decides. */
export function tickedToStart(digest: CheckDigest): Set<string> {
  const states = new Map<string, AttributeState[]>();
  for (const row of digest.attributes) {
    states.set(row.letter, [...(states.get(row.letter) ?? []), row.line.state]);
  }
  const judged = (ask: DigestAsk) => {
    const letters = lettersOf(ask.line);
    return (
      letters.length > 0 &&
      letters.every((letter) => {
        const found = states.get(letter) ?? [];
        return found.length > 0 && found.every((state) => state === "JUDGMENT");
      })
    );
  };
  return new Set(
    digest.asks
      .filter((ask) => !judged(ask) && flat(ask.line.request) !== "")
      .map((ask) => ask.key),
  );
}
