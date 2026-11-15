/**
 * A finished check as the first screen of its row shows it (docs/evidence-assurance.md,
 * section 10.12, which replaces the layout of 10.11): the verdict in one sentence, only
 * what needs this person's attention, what is fine with every caveat, and the attributes
 * one at a time. It arranges what the check's view model (evidence-assurance-model.ts)
 * already words, and decides nothing.
 */
import {
  type AnnotationKind,
  type AnnotationSet,
  kindLine,
} from "./evidence-annotations-model.ts";
import {
  type AttributeLine,
  type AttributeState,
  acceptNoteParts,
  askedLines,
  type CheckAction,
  CLOSING_KINDS,
  CODE_CHECK_WORDS,
  COMPLETENESS_WORDS,
  DISPOSITION_BOUNDS,
  DISPOSITION_KINDS,
  type Disposition,
  type DispositionKind,
  type Ending,
  type FollowUpLine,
  type ReliabilityLine,
  type RequestCheck,
  requestSettled,
  STATE_WORDS,
  settlesLast,
  type Tone,
} from "./evidence-assurance-model.ts";
import {
  RELIABILITY_DECIDE,
  RELIABILITY_WORDS,
  reliabilityHeadline,
  reliabilityQuiet,
} from "./file-reliability-model.ts";
import { formatDate } from "./format.ts";
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
  /** A button that opens a file's reliability decision ("Decide", section 10.14). */
  | { type: "RELIABILITY"; fileId: string; label: string }
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
  /** "Finding to decide" where a finding on it waits on the person; "" otherwise (and
   * where the headline already says it). */
  flag: string;
  /** "Exception recorded" where a person's exception stands on the attribute (section
   * 10.13): it keeps the item, and says so. On an attribute a person's closing tickmark
   * closes whose finding still waits, that tickmark in its own words (the headline is
   * then "Finding to decide"). Absent otherwise. */
  tickmark?: DigestPill;
  /** "Recorded on an earlier check. Confirm it still holds.", where the tickmark the item
   * says was recorded on an earlier check (section 10.15, item 9). Absent otherwise. */
  note?: string;
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
  /** SHOWN: shown by the records or by a document. TICKMARK: closed by a person's
   * disposition (section 10.13), in its own words, never as shown. OTHER_STATE: any other
   * attribute without an item, in its own state's words. RELIABILITY: a file whose
   * reliability a person decided (section 10.14), in the decision's own words. */
  kind: "SHOWN" | "TICKMARK" | "OTHER_STATE" | "RELIABILITY" | "CAVEAT";
  /** "C shown", "C shown in design", "E waiting on a file", "D shown (not asked for)",
   * "Reliability to resolve", "Read in part", "1 file left out". */
  text: string;
  icon: IconName;
  tone: Tone;
  /** An attribute opens; a caveat does not. */
  attributeKey: string | null;
  /** A file whose reliability a person decided opens its decision. */
  fileId?: string;
  /** "Recorded on an earlier check. Confirm it still holds.", on a tickmark that stands
   * through a later check (section 10.15, item 9). Absent otherwise. */
  note?: string;
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
  /** What is left after the person's work, first (section 10.14, A): "Your tickmarks
   * settle B and D. Still open: reliability of E6.csv.", or "Nothing waits on you." only
   * where nothing is left. Never says the evidence is sufficient. */
  status: string;
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
  /** The check's files whose reliability is open or decided (section 10.14), as the row
   * reads them: what a file's decision opens on. */
  reliability: ReliabilityLine[];
  /** Every attribute the request asks for is evidenced by the check or carries a
   * standing tickmark (requestSettled, section 10.15). */
  settled: boolean;
  /** What the status line is made of, kept for the status of a settled request
   * (closingStatus). */
  facts: StatusFacts;
  /** Some attribute the request asks for is settled by a person's tickmark, not by the
   * check alone: the settled status says "or carries your tickmark" only then. */
  tickmarked: boolean;
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
  /** The row's file it is about, where it is about one: a file the check already has an
   * item for is said once, on that item. */
  fileId?: string;
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
/** Shown in part, by what a document requires only: never as by the records of an
 * instance. */
export const STATUS_IN_PART_DESIGN = "Shown in part, in design";
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
/** "1 file's type not confirmed": files read as the type they seem to be, with no action
 * this person is offered to confirm it. */
export const typesUnconfirmed = (count: number) =>
  count === 1
    ? "1 file's type not confirmed"
    : `${count} files' types not confirmed`;

/** "1 of 4 attributes is shown.": of the attributes the request asks for, those shown by
 * the records of an instance. One shown only in design, and one the check supports
 * without saying how, are never counted here. */
export const verdictShown = (shown: number, asked: number) =>
  `${shown} of ${counted(asked, "attribute")} ${shown === 1 || asked === 1 ? "is" : "are"} shown.`;
/** "1 shown in design.", said apart. */
export const verdictDesign = (count: number) => `${count} shown in design.`;
/** "1 shown in part.", said apart: supported by an instance's records, but not every one
 * of its elements is shown under a passage of its own, so accepting does not mark it. */
export const verdictInPart = (count: number) => `${count} shown in part.`;
/** "1 supported, the check does not say how.", said apart: it is not counted as shown. */
export const verdictUnsaid = (count: number) =>
  `${count} supported, the check does not say how.`;
/** "3 need your attention.": the number of items under "Needs attention". */
export const verdictAttention = (count: number) =>
  `${count} need${count === 1 ? "s" : ""} your attention.`;
// Tickmarks: a person's disposition of an attribute (docs/evidence-assurance.md, 10.13)

/** Each kind in words: `label` as the person records it, `shown` as it is said once
 * recorded (by whoever recorded it), a one-line hint, the quiet line's words after the
 * attribute's letter, and its mark. Never the plain "Shown", and never a success tone:
 * only the check's own evidenced shown is green. */
export const TICKMARK_WORDS: Record<
  DispositionKind,
  {
    label: string;
    shown: string;
    hint: string;
    quiet: string;
    icon: IconName;
    tone: Tone;
  }
> = {
  SHOWN_ON_REVIEW: {
    label: "Shown, on my review",
    shown: "Shown, auditor's judgment",
    hint: "The evidence shows it and the check did not find it. Rests on your annotation.",
    quiet: "shown, your judgment",
    icon: "user",
    tone: "neutral",
  },
  NOT_APPLICABLE: {
    label: "Not applicable to this instance",
    shown: "Not applicable to this instance",
    hint: "The attribute does not apply to what was inspected.",
    quiet: "not applicable",
    icon: "minusCircle",
    tone: "neutral",
  },
  NOT_AVAILABLE: {
    label: "Evidence not available, accepted",
    shown: "Evidence not available, accepted",
    hint: "The evidence cannot be produced, and you accept that as a limitation.",
    quiet: "accepted without evidence",
    icon: "minus",
    tone: "neutral",
  },
  EXCEPTION: {
    label: "Exception",
    shown: "Exception recorded",
    hint: "The evidence shows the control did not work. It stays open, to evaluate as a finding.",
    quiet: "exception recorded",
    icon: "risk",
    tone: "danger",
  },
};

/** On an item a person's exception keeps under "Needs attention". */
export const EXCEPTION_RECORDED = TICKMARK_WORDS.EXCEPTION.shown;
/** The verdict's counts of tickmarks, each said apart and never inside "shown". */
export const verdictOnReview = (count: number) =>
  `${count} shown on your review.`;
export const verdictAccepted = (count: number) =>
  `${count} accepted without evidence.`;
export const verdictNotApplicable = (count: number) =>
  `${count} not applicable.`;
export const verdictExceptions = (count: number) =>
  `${count} exception${count === 1 ? "" : "s"} recorded.`;
/** The first screen where nothing waits and what the check did not show carries a
 * person's tickmark: never "Nothing needs your attention." */
export const DIGEST_TICKMARKED =
  "Nothing else waits on you here: each attribute not shown carries a tickmark.";

/** How a disposition that no longer stands ended, as a neutral label: why it ended is
 * the server's own `ended_reason`, said after it for every ending (a later check names
 * what it found; an annotation that changed says how). Never more than the ending is. */
export const ENDING_WORDS: Record<Ending, string> = {
  REPLACED: "Replaced",
  REOPENED: "Reopened",
  SUPERSEDED_BY_CHECK: "Ended by a later check",
  OVERTAKEN_BY_CHECK: "Ended by a later check",
  ANNOTATION_GONE:
    "Ended: its annotation changed or its file is no longer in force",
  OTHER: "No longer stands",
};

/** How an ended disposition ended, in one line: the label, who or what ended it and
 * when, and the server's reason where it gave one. */
export function endingLine(item: {
  endedAs: Ending;
  endedBy: string | null;
  endedAt: string;
  endedReason: string;
}): string {
  const reason = item.endedReason.replace(/\s+/g, " ").trim();
  return `${ENDING_WORDS[item.endedAs]} (${recordedLine(item.endedBy, item.endedAt)})${reason === "" ? "." : `: ${reason}`}`;
}

/** Beside a tickmark that stands through a later check (section 10.15, item 9): it was
 * recorded on an earlier one. Said with Change and Reopen, and on its item. */
export const EARLIER_CHECK =
  "Recorded on an earlier check. Confirm it still holds.";

/** Whether a standing tickmark was recorded on an earlier check than the current one. */
export const fromEarlierCheck = (disposition: Disposition | null): boolean =>
  disposition !== null && disposition.onCurrentCheck === false;

/** Said where the records contradict the attribute, beside the one kind offered. */
export const ONLY_EXCEPTION =
  "The records contradict this attribute, so only Exception can be recorded.";

/** Whether a person's disposition closes the attribute: it stands and is not an
 * exception. */
export const closes = (disposition: Disposition | null): boolean =>
  disposition !== null && CLOSING_KINDS.includes(disposition.kind);

/** What the person is offered to record on an attribute; null where nothing is: for a
 * person who may not decide evidence, where the check is not finished and current, or
 * where the attribute has no id to record against. Where the records contradict it,
 * only the exception, and why (the server refuses the rest). */
export type TickmarkOffer = { kinds: DispositionKind[]; note: string };
export function tickmarkOffer(
  check: Pick<RequestCheck, "standing">,
  line: Pick<AttributeLine, "attributeId" | "contradicted">,
  canAct: boolean,
): TickmarkOffer | null {
  if (!canAct || check.standing !== "REVIEWED" || line.attributeId === "") {
    return null;
  }
  return line.contradicted
    ? { kinds: ["EXCEPTION"], note: ONLY_EXCEPTION }
    : { kinds: [...DISPOSITION_KINDS], note: "" };
}

/** Who recorded it and when: "Dana Lee · Nov 14, 2026". */
export function recordedLine(
  by: string | null,
  at: string,
  nobody = "The check",
): string {
  return [by ?? nobody, at === "" ? "" : formatDate(at)]
    .filter((part) => part !== "")
    .join(" · ");
}

/** A reviewed annotation the person may rest "Shown, on my review" on, or the one a
 * standing "Shown, auditor's judgment" rests on. */
export type AnnotationChoice = {
  id: string;
  fileId: string;
  /** The file's reference among the row's files, "E2"; "" where it is not one of them. */
  ref: string;
  number: number;
  kind: AnnotationKind;
  /** Its kind in words, with the attributes it bears on: "Shows attribute B". */
  kindWords: string;
  label: string;
  statement: string;
  decidedBy: string;
};

/** An annotation of the request's files, with what decides whether it may be chosen. */
type Listed = {
  choice: AnnotationChoice;
  reviewed: boolean;
  attributeIds: readonly string[];
};

/** Every annotation of the sets, in the row's file order, then each file's own; each
 * once. */
function annotationsIn(
  sets: readonly AnnotationSet[],
  files: readonly DigestFile[],
): Listed[] {
  const order = (fileId: string) => {
    const at = files.findIndex((file) => file.id === fileId);
    return at < 0 ? files.length : at;
  };
  return [...sets]
    .sort((a, b) => order(a.fileId) - order(b.fileId))
    .flatMap((set) =>
      set.annotations.map(
        (annotation): Listed => ({
          reviewed:
            annotation.status === "CONFIRMED" || annotation.status === "EDITED",
          attributeIds: annotation.attributeIds,
          choice: {
            id: annotation.id,
            fileId: set.fileId,
            ref: fileRef(files, set.fileId),
            number: annotation.number,
            kind: annotation.kind,
            kindWords: kindLine(annotation),
            label: annotation.label,
            statement: annotation.statement,
            decidedBy: annotation.decidedByName ?? "",
          },
        }),
      ),
    )
    .filter(
      (item, at, all) =>
        all.findIndex((each) => each.choice.id === item.choice.id) === at,
    );
}

/** The annotations on the request's files that a person confirmed, edited or made
 * (CONFIRMED or EDITED), that show the attribute (kind SHOWS: never one that marks an
 * exception, identifies a person or names a source) and that name it: what "Shown, on my
 * review" may rest on (the server checks it again). In the row's file order, then each
 * file's own. */
export function annotationChoices(
  sets: readonly AnnotationSet[],
  attributeId: string,
  files: readonly DigestFile[],
): AnnotationChoice[] {
  return annotationsIn(sets, files)
    .filter(
      (item) =>
        item.reviewed &&
        item.choice.kind === "SHOWS" &&
        item.attributeIds.includes(attributeId),
    )
    .map((item) => item.choice);
}

/** The annotation a standing "Shown, auditor's judgment" rests on, by its id, whatever
 * its kind (one recorded before the SHOWS rule stands as it was); null where the
 * request's files do not list it. */
export function annotationOf(
  sets: readonly AnnotationSet[],
  annotationId: string | null,
  files: readonly DigestFile[],
): AnnotationChoice | null {
  return annotationId === null
    ? null
    : (annotationsIn(sets, files).find(
        (item) => item.choice.id === annotationId,
      )?.choice ?? null);
}

/** A tickmark as the person drafts it. */
export type TickmarkDraft = {
  kind: DispositionKind | null;
  reason: string;
  reliedOn: string;
  annotationId: string;
};

/** What is wrong with a draft, by field, in the server's own sentences; empty where it
 * can be sent. Only what the form itself can know: the server decides the rest. */
export function tickmarkProblems(draft: TickmarkDraft): {
  kind?: string;
  reason?: string;
  reliedOn?: string;
  annotation?: string;
} {
  const reason = draft.reason.replace(/\s+/g, " ").trim();
  const reliedOn = draft.reliedOn.replace(/\s+/g, " ").trim();
  return {
    ...(draft.kind === null ? { kind: "Choose what to record." } : {}),
    ...(reason.length < DISPOSITION_BOUNDS.reasonMin
      ? {
          reason: `Give the reason in a sentence of at least ${DISPOSITION_BOUNDS.reasonMin} characters.`,
        }
      : reason.length > DISPOSITION_BOUNDS.reasonMax
        ? {
            reason: `The reason can be at most ${DISPOSITION_BOUNDS.reasonMax} characters.`,
          }
        : {}),
    ...(draft.kind === "NOT_AVAILABLE" &&
    reliedOn.length > DISPOSITION_BOUNDS.reliedOnMax
      ? {
          reliedOn: `What was relied on instead can be at most ${DISPOSITION_BOUNDS.reliedOnMax} characters.`,
        }
      : {}),
    ...(draft.kind === "SHOWN_ON_REVIEW" && draft.annotationId === ""
      ? {
          annotation:
            "Choose an annotation on the evidence that names this attribute, or add one.",
        }
      : {}),
  };
}

/** The fields a draft is sent with: only what its kind takes. */
export function tickmarkFields(
  draft: TickmarkDraft & { kind: DispositionKind },
): Record<string, string> {
  const reliedOn = draft.reliedOn.replace(/\s+/g, " ").trim();
  return {
    kind: draft.kind,
    reason: draft.reason.replace(/\s+/g, " ").trim(),
    ...(draft.kind === "NOT_AVAILABLE" && reliedOn !== ""
      ? { relied_on: reliedOn }
      : {}),
    ...(draft.kind === "SHOWN_ON_REVIEW"
      ? { annotation_id: draft.annotationId }
      : {}),
  };
}

/** A draft from what stands ("Change": the form pre-filled), or empty. */
export function draftFrom(disposition: Disposition | null): TickmarkDraft {
  return disposition === null
    ? { kind: null, reason: "", reliedOn: "", annotationId: "" }
    : {
        kind: disposition.kind,
        reason: disposition.reason,
        reliedOn: disposition.reliedOn,
        annotationId: disposition.annotationId ?? "",
      };
}

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
    // Shown only where accepting marks it evidenced (the accept note's rule); support by
    // an instance's records that is not whole is shown in part.
    SUPPORTED:
      line.shows === "DESIGN"
        ? STATUS_SHOWN_DESIGN
        : line.evidenced
          ? STATUS_SHOWN
          : STATUS_IN_PART,
    PARTLY: line.shows === "DESIGN" ? STATUS_IN_PART_DESIGN : STATUS_IN_PART,
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
  // Support by an instance's records that accepting does not mark (not every element
  // shown under its own passage): a part's words and mark, never a success.
  if (
    line.state === "SUPPORTED" &&
    line.shows === "IMPLEMENTATION" &&
    !line.evidenced
  ) {
    return {
      label: STATUS_IN_PART,
      icon: STATE_WORDS.PARTLY.icon,
      tone: STATE_WORDS.PARTLY.tone,
    };
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
 * pass, an element of it is an exception both readings rest on the same record (a
 * deviation), or its own label says the evidence contradicts it. Read from what the line
 * carries, never guessed from what is absent. */
function exception(line: AttributeLine): boolean {
  return (
    (line.state === "ISSUE" || line.state === "DECIDED") &&
    (line.checks.some((check) => NOT_PASSED.includes(check.result)) ||
      line.elements.some((element) => element.deviation) ||
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

/** The letters of the attributes a person's disposition closes (section 10.13): a
 * letter that is also on an attribute still open is not one of them. */
function closedLetters(
  rows: ReadonlyArray<Pick<DigestAttribute, "letter" | "line">>,
): Set<string> {
  const open = new Set(
    rows
      .filter((row) => !closes(row.line.disposition))
      .map((row) => row.letter),
  );
  return new Set(
    rows
      .filter((row) => closes(row.line.disposition) && !open.has(row.letter))
      .map((row) => row.letter),
  );
}

/** A follow-up that names attributes, every one of them in `letters`. */
const onlyFor = (ask: DigestAsk, letters: ReadonlySet<string>) => {
  const named = lettersOf(ask.line);
  return named.length > 0 && named.every((letter) => letters.has(letter));
};

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
    .map((row): AttentionItem => {
      const waits =
        row.line.findingId !== null && waiting.has(row.line.findingId);
      const kind = row.line.disposition?.kind;
      // A person's tickmark closes the attribute, but a finding on it still waits: the
      // item stays, said as the finding to decide, with the tickmark beside it, and
      // opens the attribute where the finding is decided. Nothing is asked for it.
      if (waits && kind !== undefined && closes(row.line.disposition)) {
        const words = TICKMARK_WORDS[kind];
        return {
          key: `ATTRIBUTE:${row.key}`,
          kind: "ATTRIBUTE",
          mark: row.letter,
          headline: FINDING_TO_DECIDE,
          more: 0,
          context: row.text,
          flag: "",
          tickmark: { label: words.shown, icon: words.icon, tone: words.tone },
          ...(fromEarlierCheck(row.line.disposition)
            ? { note: EARLIER_CHECK }
            : {}),
          status: row.status,
          control: { type: "OPEN", label: DECIDE },
          attributeKey: row.key,
        };
      }
      return {
        key: `ATTRIBUTE:${row.key}`,
        kind: "ATTRIBUTE",
        mark: row.letter,
        headline: gistLine(row.gist),
        more: row.gist.more,
        context: row.text,
        flag: waits ? FINDING_TO_DECIDE : "",
        // A person's exception keeps the item, and says so.
        ...(kind === "EXCEPTION"
          ? {
              tickmark: {
                label: EXCEPTION_RECORDED,
                icon: TICKMARK_WORDS.EXCEPTION.icon,
                tone: TICKMARK_WORDS.EXCEPTION.tone,
              },
            }
          : {}),
        ...(fromEarlierCheck(row.line.disposition)
          ? { note: EARLIER_CHECK }
          : {}),
        status: row.status,
        control:
          row.line.state === "JUDGMENT"
            ? { type: "OPEN", label: DECIDE }
            : row.asks.length > 0
              ? { type: "ASK", askKeys: row.asks.map((ask) => ask.key) }
              : { type: "NONE" },
        attributeKey: row.key,
      };
    });
  // The row's own items about a file, by the file: where the check has an item for the
  // same file, the two are one item (the check's action first, the row's words with it).
  const rowFile = new Map(
    extras
      .filter((extra) => !extra.caveat && extra.fileId !== undefined)
      .map((extra) => [extra.fileId, extra]),
  );
  const merged = new Set<string>();
  const files = (
    kind: "CONFIRM_TYPE" | "FILE",
    headline: string,
    lines: RequestCheck["leftOut"],
  ): AttentionItem[] =>
    lines.flatMap((item, at) => {
      if (item.action === null) {
        return [];
      }
      const also = rowFile.get(item.fileId);
      if (also !== undefined) {
        merged.add(also.key);
      }
      return [
        {
          key: `${kind}:${item.fileId || at}`,
          kind: "FILE",
          mark: fileRef(rowFiles, item.fileId),
          headline,
          more: 0,
          context: [
            also === undefined ? "" : extraWords(also),
            needDetail(item.line),
          ]
            .filter((part) => part !== "")
            .join(" "),
          flag: "",
          status: null,
          control: {
            type: "ACT",
            action: item.action,
            label: item.action.label,
          },
          attributeKey: null,
        },
      ];
    });
  // A follow-up that names no attribute, and one that names only attributes with no
  // item above: its tick is on the first screen too, so nothing is asked unseen.
  const listed = new Set(
    rows.filter((row) => row.attention).map((row) => row.letter),
  );
  // A follow-up only for attributes a person has closed with a tickmark waits on no one:
  // it stays in each attribute's own view, unticked.
  const tickmarked = closedLetters(rows);
  const general: AttentionItem[] = asks
    .filter((ask) => !lettersOf(ask.line).some((letter) => listed.has(letter)))
    .filter((ask) => !onlyFor(ask, tickmarked))
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
  const fileItems = [
    ...files("CONFIRM_TYPE", NEED_CONFIRM_TITLE, check.confirm),
    ...files("FILE", NEED_FILE_TITLE, check.leftOut),
  ];
  // A file whose reliability the check does not establish and no person has decided
  // (section 10.14): the reliability caveat, per file, with the check's own sentence and
  // "Decide". A file no longer on the request is still said, with nothing to press.
  const reliability: AttentionItem[] = check.reliability
    .filter((line) => line.decision === null)
    .map((line) => ({
      key: `${RELIABILITY_KEY}${line.fileId}`,
      kind: "FILE",
      mark: fileRef(rowFiles, line.fileId),
      headline: reliabilityHeadline(line.name),
      more: 0,
      // The check's own sentence; where it sent none (no supported attribute rests on
      // the file), the item is worded from the file's name alone.
      context: flat(line.question),
      flag: "",
      status: null,
      control: line.inForce
        ? {
            type: "RELIABILITY",
            fileId: line.fileId,
            label: RELIABILITY_DECIDE,
          }
        : { type: "NONE" },
      attributeKey: null,
    }));
  const other: AttentionItem[] = extras
    .filter(
      (extra) =>
        !extra.caveat && extraWords(extra) !== "" && !merged.has(extra.key),
    )
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
  // Each item once, by its key: a key that came twice (from what the screen passed) is
  // told apart, never drawn twice under one.
  const seen = new Set<string>();
  return [
    ...attributes,
    ...fileItems,
    ...reliability,
    ...other,
    ...general,
  ].map((item) => {
    let key = item.key;
    for (let at = 2; seen.has(key); at += 1) {
      key = `${item.key}#${at}`;
    }
    seen.add(key);
    return key === item.key ? item : { ...item, key };
  });
}

// What is fine, and what must not be lost

/** The files left out that have no action of their own, and the notes on a file's type
 * that have none. */
const actionless = (lines: RequestCheck["leftOut"]) =>
  lines.filter((item) => item.action === null).length;

/** Where a file's reliability is the caveat, and the server names each file it is about
 * (section 10.14): each file is said on its own, so the label is not said beside them. */
function replacedByFiles(check: RequestCheck, caveat: DigestPill): boolean {
  return (
    caveat.label === COMPLETENESS_WORDS.RELIABILITY_UNRESOLVED &&
    check.reliability.length > 0
  );
}

/** The key of a file's reliability, on its item and on the quiet line. */
export const RELIABILITY_KEY = "RELIABILITY:";

function quietOf(
  check: RequestCheck,
  rows: readonly DigestAttribute[],
  caveat: DigestPill | null,
  extras: readonly DigestExtra[],
  files: readonly DigestFile[],
): QuietItem[] {
  // Every attribute that has no item above, in its own state's words and tone: none is
  // reachable only by stepping through the attributes.
  const attributes: QuietItem[] = rows
    .filter((row) => !row.attention)
    .map((row) => {
      // Shown by the records of an instance (whole, as accepting marks it), or by what a
      // document requires.
      const shown =
        row.line.state === "SUPPORTED" &&
        (row.line.evidenced || row.line.shows === "DESIGN");
      const kind = row.line.disposition?.kind;
      // Closed by a person's tickmark, in its own words and a neutral tone: never as
      // shown. The check's own evidenced shown stands before it. (One whose finding
      // still waits is not here: it keeps its item under "Needs attention".)
      if (
        !row.line.evidenced &&
        kind !== undefined &&
        closes(row.line.disposition)
      ) {
        const words = TICKMARK_WORDS[kind];
        const text =
          row.letter === ""
            ? capital(words.quiet)
            : `${row.letter} ${words.quiet}`;
        return {
          key: `TICKMARK:${row.key}`,
          kind: "TICKMARK" as const,
          text: `${text}${row.line.expected ? "" : QUIET_NOT_ASKED}`,
          icon: words.icon,
          tone: words.tone,
          attributeKey: row.key,
          ...(fromEarlierCheck(row.line.disposition)
            ? { note: EARLIER_CHECK }
            : {}),
        };
      }
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
  const typed = actionless(check.confirm);
  // What the check already says of a file stands for it: the row's own caveat about the
  // same file is not said a second time.
  const named = new Set(
    [...check.leftOut, ...check.confirm].map((item) => item.fileId),
  );
  const partSaid =
    caveat?.label.toLowerCase().includes(QUIET_READ_IN_PART.toLowerCase()) ??
    false;
  // A file whose reliability a person decided (section 10.14), in the decision's own
  // words and a neutral tone, opening the decision.
  const decided: QuietItem[] = check.reliability.flatMap((line) =>
    line.decision === null
      ? []
      : [
          {
            key: `${RELIABILITY_KEY}${line.fileId}`,
            kind: "RELIABILITY" as const,
            text: reliabilityQuiet(
              fileRef(files, line.fileId),
              line.name,
              line.decision.kind,
            ),
            icon: RELIABILITY_WORDS[line.decision.kind].icon,
            tone: RELIABILITY_WORDS[line.decision.kind].tone,
            attributeKey: null,
            fileId: line.fileId,
          },
        ],
  );
  return [
    ...attributes,
    ...decided,
    // Every caveat, of either engine: none is clipped or left out. The reliability caveat
    // is said per file where the server names the files (an item while open, the
    // decision's words once decided), and as the check's own label where it does not.
    ...(caveat === null || replacedByFiles(check, caveat)
      ? []
      : [said("CAVEAT:COMPLETENESS", caveat.label)]),
    ...(check.readInPart !== null && !partSaid
      ? [said("CAVEAT:READ_IN_PART", QUIET_READ_IN_PART)]
      : []),
    ...(leftOut > 0 ? [said("CAVEAT:LEFT_OUT", filesLeftOut(leftOut))] : []),
    ...(typed > 0 ? [said("CAVEAT:TYPE", typesUnconfirmed(typed))] : []),
    // The screen's own caveats, in its words.
    ...extras
      .filter(
        (extra) =>
          extra.caveat &&
          extraWords(extra) !== "" &&
          !(extra.fileId !== undefined && named.has(extra.fileId)),
      )
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
 * has no review), every attribute the request asks for is one accepting marks as
 * evidenced (AttributeLine.evidenced, the accept note's own rule), and there is no caveat
 * of any kind. Otherwise the review's own explanation; without one, the caveats' own
 * words; without those, what the accept note cautions. */
function calmOf(
  check: RequestCheck,
  quiet: readonly QuietItem[],
  asked: readonly DigestAttribute[],
  note: string,
  /** Whether a finding on an attribute still waits on the person. */
  findingWaits: boolean,
): string {
  const review = check.review;
  const caveats = quiet.filter((item) => item.kind === "CAVEAT");
  // A person's exception closes nothing: while one stands, nothing is calm. (It keeps its
  // item under "Needs attention", so this is said only should that ever change.)
  if (asked.some((row) => row.line.disposition?.kind === "EXCEPTION")) {
    return closed(EXCEPTION_RECORDED);
  }
  const fine =
    (review === null || review.state === "SUFFICIENT") &&
    asked.length > 0 &&
    asked.every((row) => row.line.evidenced);
  if (fine && caveats.length === 0) {
    return DIGEST_NOTHING;
  }
  // What the check did not show carries a person's tickmark: said so, with every caveat
  // after it, and never as "nothing needs your attention".
  // Never while a finding waits on the person: something else does wait (it keeps its
  // item, so this is said only should that ever change).
  if (
    !findingWaits &&
    asked.length > 0 &&
    asked.some((row) => !row.line.evidenced) &&
    asked.every((row) => row.line.evidenced || closes(row.line.disposition))
  ) {
    return [
      DIGEST_TICKMARKED,
      ...caveats.map((item) => closed(flat(item.text))),
    ].join(" ");
  }
  return (
    twoSentences(review?.explanation ?? "") ||
    caveats.map((item) => closed(flat(item.text))).join(" ") ||
    acceptNoteParts(note).caution
  );
}

// What is left after the person's work (section 10.14, A)

/** The first line where nothing is left: no attribute waits on the person, no file's
 * reliability is unresolved, and no caveat is left. Never "sufficient": it says only
 * that nothing waits. */
export const STATUS_NOTHING = "Nothing waits on you.";
/** Before what is left. */
export const STATUS_OPEN = "Still open:";
/** Quietly, under the status: the check's own outcome, in its words. */
export const CHECK_PROPOSED = "The check proposed:";

/** What the status line is made of, each in the order it is said. Letters are the
 * attributes'; files are named by their name (open) or their reference (decided). */
export type StatusFacts = {
  /** Attributes a person's closing tickmark settles (section 10.13): no longer waiting,
   * and not shown by the check itself. */
  settled: string[];
  /** Files whose reliability a person decided. */
  decided: string[];
  /** Attributes on which a person recorded an exception. */
  exceptions: string[];
  /** Attributes with a finding the person has still to decide (and no exception). */
  findings: string[];
  /** The other attributes that need attention. */
  attributes: string[];
  /** Files whose reliability is unresolved, by name. */
  files: string[];
  /** Anything else under "Needs attention", each in a few words. */
  others: string[];
  /** Every caveat of the quiet line, in its words. */
  caveats: string[];
};

/** "A", "A and B", "A, B and C". */
export function andList(items: readonly string[]): string {
  const said = items.filter((item) => item !== "");
  if (said.length <= 1) {
    return said[0] ?? "";
  }
  return `${said.slice(0, -1).join(", ")} and ${said[said.length - 1]}`;
}

/** Letters as said, an attribute without a letter as such, each once. */
const named = (letters: readonly string[]) => [
  ...new Set(letters.map((letter) => flat(letter) || "an attribute")),
];

const many = (count: number, one: string, more = `${one}s`) =>
  count === 1 ? one : more;

/** Words of a caveat or an item as part of the line: no closing stop, a small first
 * letter (a file's name or a letter is kept as written). */
const part = (text: string) => {
  const said = flat(text).replace(/[.!?…]+$/u, "");
  return /^[A-Z][a-z]/.test(said) ? small(said) : said;
};

/**
 * The first line of a finished check (section 10.14, A): what a person's work settled, in
 * one short clause, then what is left, each in a few words, in the contract's order
 * (exceptions recorded, findings to decide, attributes that need attention, files whose
 * reliability is unresolved, anything else waiting, other caveats); "Nothing waits on
 * you." only where nothing is left. It never says the evidence is sufficient, and never
 * claims more than the check and the person's records show.
 */
export function statusLine(facts: StatusFacts): string {
  const settled = named(facts.settled);
  const decided = [...new Set(facts.decided.filter((item) => item !== ""))];
  const tickmarks =
    settled.length === 0
      ? ""
      : `${many(settled.length, "tickmark")} ${many(settled.length, "settles", "settle")} ${andList(settled)}`;
  const decisions =
    decided.length === 0
      ? ""
      : `${many(decided.length, "decision")} ${many(decided.length, "settles", "settle")} the reliability of ${andList(decided)}`;
  const lead =
    tickmarks !== "" && decisions !== ""
      ? `Your ${tickmarks}, and your ${decisions}.`
      : tickmarks !== "" || decisions !== ""
        ? `Your ${tickmarks || decisions}.`
        : "";
  const left = leftOf(facts);
  return [
    lead,
    left.length === 0 ? STATUS_NOTHING : `${STATUS_OPEN} ${left.join(", ")}.`,
  ]
    .filter((item) => item !== "")
    .join(" ");
}

/** What is left, each in a few words, in the contract's order (section 10.14, A). */
function leftOf(
  facts: Omit<StatusFacts, "settled" | "decided">,
  /** Exceptions are said elsewhere (carried to the workpaper), so not as still open. */
  carried = false,
): string[] {
  const exceptions = named(facts.exceptions);
  const findings = named(facts.findings).filter(
    (letter) => !exceptions.includes(letter),
  );
  const attributes = named(facts.attributes).filter(
    (letter) => !exceptions.includes(letter) && !findings.includes(letter),
  );
  const files = [...new Set(facts.files.filter((name) => name !== ""))];
  return [
    exceptions.length === 0 || carried
      ? ""
      : `${many(exceptions.length, "exception")} recorded on ${andList(exceptions)}`,
    findings.length === 0
      ? ""
      : `${many(findings.length, "finding")} to decide on ${andList(findings)}`,
    attributes.length === 0
      ? ""
      : `${many(attributes.length, "attribute")} ${andList(attributes)}`,
    files.length === 0 ? "" : `reliability of ${andList(files)}`,
    ...facts.others.map(part),
    ...facts.caveats.map(part),
  ].filter((item, at, all) => item !== "" && all.indexOf(item) === at);
}

// Closing a request with tickmarks (docs/evidence-assurance.md, section 10.15)

/** The first line where every attribute the request asks for is shown by the check or
 * carries a tickmark, and where the check alone shows every one. Never "sufficient". */
export const SETTLED_TICKMARKED =
  "Every attribute is shown or carries your tickmark.";
export const SETTLED_SHOWN = "Every attribute is shown.";
/** After it, where the request can be accepted and is not: nothing is accepted without
 * that press. */
export const ACCEPT_TO_CLOSE = "Accept the evidence to close this request.";
/** Before it, once a person accepted the request's evidence. */
export const STATUS_ACCEPTED = "Evidence accepted.";
/** "1 exception is carried to the workpaper.": a person's exception settles the
 * attribute here and is dealt with in the workpaper. */
export const exceptionsCarried = (count: number) =>
  `${count} ${many(count, "exception is", "exceptions are")} carried to the workpaper.`;

/** Where the request stands for closing, as its row knows it. */
export type Closing = {
  /** A person accepted the request's evidence. */
  accepted: boolean;
  /** The row offers Accept to this person now (`canAct && row.canAccept`). */
  canAccept: boolean;
};

/**
 * The first line of a finished check whose attributes are settled (section 10.15, item
 * 1): "Every attribute is shown or carries your tickmark. Accept the evidence to close
 * this request." The exceptions a person recorded are said as carried to the workpaper;
 * anything else that is left (a finding to decide, a file's reliability, a caveat) is
 * still said, and the call to accept only where the row offers Accept. Where the
 * attributes are not settled, or the row does not say where the request stands, the
 * status of section 10.14 as it is.
 */
export function closingStatus(
  digest: Pick<CheckDigest, "status" | "settled" | "facts" | "tickmarked">,
  closing: Closing | null,
): string {
  if (closing === null || !digest.settled) {
    return digest.status;
  }
  const exceptions = named(digest.facts.exceptions).length;
  const left = leftOf(digest.facts, true);
  return [
    closing.accepted ? STATUS_ACCEPTED : "",
    digest.tickmarked || exceptions > 0 ? SETTLED_TICKMARKED : SETTLED_SHOWN,
    exceptions > 0 ? exceptionsCarried(exceptions) : "",
    left.length > 0 ? `${STATUS_OPEN} ${left.join(", ")}.` : "",
    !closing.accepted && closing.canAccept ? ACCEPT_TO_CLOSE : "",
  ]
    .filter((item) => item !== "")
    .join(" ");
}

/** The digest as the row shows it: its first line says where a settled request stands
 * for closing. Everything else is the check's. */
export function withClosing(
  digest: CheckDigest,
  closing: Closing | null,
): CheckDigest {
  const status = closingStatus(digest, closing);
  return status === digest.status ? digest : { ...digest, status };
}

/** What recording a tickmark on an attribute may also do, in the same act (section
 * 10.15, items 1 and 2). Each is offered as a ticked box and done only through the
 * row's own handler, after the server has confirmed the tickmark. */
export type TickmarkAfter = {
  /** Recording it settles the last attribute of a request that can be accepted and is
   * not: "Accept this request's evidence now". For every kind, an exception included. */
  accept: boolean;
  /** The check's finding on the attribute is still proposed: "Dismiss the check's
   * proposed finding with this reason". Offered for a closing kind only (dismissOffered). */
  dismiss: boolean;
};

export function tickmarkAfter(
  check: Pick<
    RequestCheck,
    "standing" | "attributes" | "notAddressed" | "notAsked"
  >,
  line: Pick<AttributeLine, "key" | "findingId">,
  facts: {
    /** The row offers Accept to this person (`canAct && row.canAccept`). */
    canAccept: boolean;
    /** The status of the finding on the attribute; null where there is none. */
    findingStatus: string | null;
  },
): TickmarkAfter {
  return {
    accept: facts.canAccept && settlesLast(check, line),
    dismiss: line.findingId !== null && facts.findingStatus === "PROPOSED",
  };
}

/** The finding's dismissal is offered with a closing kind only: an exception leaves the
 * finding to the person. */
export const dismissOffered = (
  after: TickmarkAfter,
  kind: DispositionKind | null,
): boolean => after.dismiss && kind !== null && CLOSING_KINDS.includes(kind);

/** The form's two boxes, and the line under the first. */
export const ACCEPT_NOW = "Accept this request's evidence now";
export const ACCEPT_NOW_HINT =
  "Every attribute will then be shown or carry a tickmark.";
export const DISMISS_FINDING =
  "Dismiss the check's proposed finding with this reason";

/** "1 follow-up to consider". */
const followUpsLeft = (count: number) =>
  `${count} ${many(count, "follow-up")} to consider`;

/** What the status line is made of, from the digest's own lists: every item under
 * "Needs attention" and every caveat is in it, so "Nothing waits on you." is said only
 * where both are empty. */
function statusFactsOf(
  check: RequestCheck,
  rows: readonly DigestAttribute[],
  attention: readonly AttentionItem[],
  quiet: readonly QuietItem[],
  files: readonly DigestFile[],
  waiting: ReadonlySet<string>,
): StatusFacts {
  const rowOf = (key: string | null) =>
    rows.find((row) => row.key === key) ?? null;
  const attributeItems = attention.filter((item) => item.kind === "ATTRIBUTE");
  const lettersWhere = (pick: (row: DigestAttribute) => boolean) =>
    attributeItems.flatMap((item) => {
      const row = rowOf(item.attributeKey);
      return row !== null && pick(row) ? [row.letter] : [];
    });
  const excepted = (row: DigestAttribute) =>
    row.line.disposition?.kind === "EXCEPTION";
  const waits = (row: DigestAttribute) =>
    row.line.findingId !== null && waiting.has(row.line.findingId);
  const reliability = (item: AttentionItem) =>
    item.key.startsWith(RELIABILITY_KEY);
  const general = attention.filter((item) => item.kind === "GENERAL").length;
  return {
    settled: rows
      .filter(
        (row) =>
          !row.attention && !row.line.evidenced && closes(row.line.disposition),
      )
      .map((row) => row.letter),
    decided: check.reliability
      .filter((line) => line.decision !== null)
      .map((line) => fileRef(files, line.fileId) || line.name),
    exceptions: lettersWhere(excepted),
    findings: lettersWhere((row) => !excepted(row) && waits(row)),
    attributes: [
      ...lettersWhere((row) => !excepted(row) && !waits(row)),
      // An item whose attribute is not among the rows (never expected) is still said.
      ...attributeItems
        .filter((item) => rowOf(item.attributeKey) === null)
        .map((item) => item.mark),
    ],
    files: check.reliability
      .filter((line) => line.decision === null)
      .map((line) => line.name),
    others: [
      ...attention
        .filter(
          (item) =>
            item.kind !== "ATTRIBUTE" &&
            item.kind !== "GENERAL" &&
            !reliability(item),
        )
        .map((item) =>
          item.key.startsWith("CONFIRM_TYPE:")
            ? `type of ${item.mark || "a file"} to confirm`
            : item.key.startsWith("FILE:")
              ? `${item.mark || "a file"} left out`
              : item.headline,
        ),
      ...(general > 0 ? [followUpsLeft(general)] : []),
    ],
    caveats: quiet
      .filter((item) => item.kind === "CAVEAT")
      .map((item) => item.text),
  };
}

/** The calm line as it is said under the status line: not where the status already
 * says it ("Nothing needs your attention.", what the tickmarks settle, or the caveats
 * alone); the review's own explanation otherwise. */
export function calmUnderStatus(digest: CheckDigest): string {
  const caveats = digest.quiet
    .filter((item) => item.kind === "CAVEAT")
    .map((item) => closed(flat(item.text)))
    .join(" ");
  return digest.calm === DIGEST_NOTHING ||
    digest.calm.startsWith(DIGEST_TICKMARKED) ||
    digest.calm === caveats
    ? ""
    : digest.calm;
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
  /** The row's note beside Accept (assuranceRow.acceptNote): what the calm line says
   * where nothing else does. */
  acceptNote = "",
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
        // A person's disposition that closes it takes it off the list (section 10.13);
        // a person's exception keeps it there, whatever the check found; and a finding
        // that waits on the person keeps it there whatever the tickmark.
        attention:
          line.disposition?.kind === "EXCEPTION" ||
          (line.findingId !== null && waiting.has(line.findingId)) ||
          (!closes(line.disposition) &&
            ((OPEN_STATES.has(line.state) && line.expected) ||
              line.state === "ISSUE" ||
              line.state === "JUDGMENT")),
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
  const quiet = quietOf(check, attributes, caveat, extras, files);
  // Of the attributes the request asks for: those the records of an instance show;
  // apart, those shown only by what a document requires, and those supported without
  // the check saying how.
  const asked = attributes.filter((row) => row.line.expected);
  // Each attribute the request asks for is counted once: a person's exception first
  // (never inside "shown"), then the check's own evidenced shown, then a person's
  // tickmark that closes it, then what the check supports in some other way.
  const bucket = (row: DigestAttribute) => {
    const kind = row.line.disposition?.kind;
    if (kind === "EXCEPTION") {
      return "EXCEPTION";
    }
    if (row.line.evidenced) {
      return "SHOWN";
    }
    if (kind !== undefined && closes(row.line.disposition)) {
      return kind;
    }
    return row.line.state === "SUPPORTED"
      ? `SUPPORTED:${row.line.shows ?? ""}`
      : "";
  };
  const counts = new Map<string, number>();
  for (const row of asked) {
    counts.set(bucket(row), (counts.get(bucket(row)) ?? 0) + 1);
  }
  const tally = (key: string) => counts.get(key) ?? 0;
  const shows = (how: AttributeLine["shows"]) =>
    tally(`SUPPORTED:${how ?? ""}`);
  // Shown is what accepting marks as evidenced; support by an instance's records that
  // is not whole is said apart, as the accept note says it.
  const evidenced = tally("SHOWN");
  const inPart = shows("IMPLEMENTATION");
  const facts = statusFactsOf(
    check,
    attributes,
    attention,
    quiet,
    files,
    waiting,
  );
  return {
    // The review's own words: a proposal, never said as more than it says.
    outcome:
      review === null
        ? null
        : { label: review.label, icon: review.icon, tone: review.tone },
    caveat,
    status: statusLine(facts),
    verdict: [
      asked.length > 0
        ? verdictShown(evidenced, asked.length)
        : VERDICT_NO_RESULT,
      inPart > 0 ? verdictInPart(inPart) : "",
      shows("DESIGN") > 0 ? verdictDesign(shows("DESIGN")) : "",
      shows(null) > 0 ? verdictUnsaid(shows(null)) : "",
      tally("SHOWN_ON_REVIEW") > 0
        ? verdictOnReview(tally("SHOWN_ON_REVIEW"))
        : "",
      tally("NOT_AVAILABLE") > 0 ? verdictAccepted(tally("NOT_AVAILABLE")) : "",
      tally("NOT_APPLICABLE") > 0
        ? verdictNotApplicable(tally("NOT_APPLICABLE"))
        : "",
      tally("EXCEPTION") > 0 ? verdictExceptions(tally("EXCEPTION")) : "",
      attention.length > 0 ? verdictAttention(attention.length) : "",
    ]
      .filter((part) => part !== "")
      .join(" "),
    attention,
    quiet,
    calm:
      attention.length > 0
        ? ""
        : calmOf(
            check,
            quiet,
            asked,
            acceptNote,
            attributes.some(
              (row) =>
                row.line.findingId !== null && waiting.has(row.line.findingId),
            ),
          ),
    steps: [
      ...attributes.filter((row) => row.attention),
      ...attributes.filter((row) => !row.attention),
    ].map((row) => row.key),
    attributes,
    asks,
    askTotal: asks.reduce((sum, ask) => sum + 1 + ask.similar.length, 0),
    asksMore: review?.more ?? "",
    details: detailsOf(check),
    reliability: check.reliability,
    settled: requestSettled(check),
    facts,
    tickmarked: askedLines(check).some(
      (line) => line.disposition !== null && !line.evidenced,
    ),
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
  // Nor one only for attributes a person has closed with a tickmark: nothing waits there.
  const tickmarked = closedLetters(digest.attributes);
  return new Set(
    digest.asks
      .filter(
        (ask) =>
          !judged(ask) &&
          !onlyFor(ask, tickmarked) &&
          flat(ask.line.request) !== "",
      )
      .map((ask) => ask.key),
  );
}
