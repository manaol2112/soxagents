/**
 * Workpaper review notes (docs/workpaper-review.md, sections 1 to 6), as the page reads
 * them: the server's answer parsed cautiously, the words for a criticality and a status,
 * the filters and their counts, the order of the notes in the document, the field keys of
 * section 3 and their labels, the anchor of highlighted words (made from a selection and
 * found again in a field's text), each write's request, and the sentences for a refusal.
 *
 * Nothing here decides who may do what: the server's `can` flags say what to offer, and
 * the server refuses anything else. A value this page does not know is never read as
 * Urgent, as Cleared or as allowed.
 */

import {
  type Consideration,
  consideredLine,
  type PointPlace,
  placeSection,
  pointField,
  shownAt,
} from "./design-points-model.ts";
import { DW_SECTION, DW_TICKMARKS_ORDER } from "./design-workpaper-sections.ts";
import { parseRich } from "./rich-text-model.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The server's bounds (workpaper_review_notes.py), in characters. */
export const NOTE_BOUNDS = {
  textMin: 10,
  textMax: 2000,
  replyMin: 1,
  replyMax: 2000,
  reasonMin: 10,
  reasonMax: 500,
  quoteMax: 500,
  around: 60,
  field: 120,
  occurrence: 100_000,
} as const;

/** A field's key (section 3): letters, digits, dots and hyphens, up to 120. */
export const FIELD_KEY = /^[A-Za-z0-9][A-Za-z0-9.-]{0,119}$/;

export const CRITICALITIES = ["URGENT", "NORMAL", "FOLLOW_UP"] as const;
export type Criticality = (typeof CRITICALITIES)[number];
export const STATUSES = ["OPEN", "RESPONDED", "CLEARED", "DISMISSED"] as const;
export type NoteStatus = (typeof STATUSES)[number];
export type AnchorKind = "FIELD" | "TEXT" | "WORKPAPER";
export const EVENT_KINDS = [
  "RAISED",
  "REPLIED",
  "RESPONDED",
  "CLEARED",
  "REOPENED",
  "DISMISSED",
  "CRITICALITY",
  "OWNER",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type Person = { id: string; name: string };

export type NoteEvent = {
  id: string;
  /** OTHER: a kind this page does not know, shown as "Changed the note". */
  kind: EventKind | "OTHER";
  by: Person;
  at: string;
  text: string;
  /** What changed, where the event says: a status, a criticality or an owner. */
  from: string;
  to: string;
  fromName: string;
  toName: string;
};

/** What the person may do to the note now (the server's `can`; anything missing is no). */
export type NoteCan = {
  reply: boolean;
  respond: boolean;
  clear: boolean;
  reopen: boolean;
  dismiss: boolean;
  criticality: boolean;
  owner: boolean;
};

export type ReviewNote = {
  id: string;
  number: number;
  anchorKind: AnchorKind;
  field: string;
  quote: string;
  prefix: string;
  suffix: string;
  occurrence: number;
  workpaperVersion: number;
  text: string;
  /** OTHER: a criticality this page does not know; never read as Urgent. */
  criticality: Criticality | "OTHER";
  /** OTHER: a status this page does not know; never read as open or closed. */
  status: NoteStatus | "OTHER";
  owner: Person;
  raisedBy: Person;
  raisedAt: string;
  clearedBy: Person | null;
  clearedAt: string;
  dismissedBy: Person | null;
  dismissedAt: string;
  dismissReason: string;
  version: number;
  events: NoteEvent[];
  can: NoteCan;
};

export type Member = { id: string; name: string; role: string };

export type NoteCounts = {
  open: number;
  responded: number;
  cleared: number;
  dismissed: number;
  /** Urgent notes that are open or responded to: what holds the D&I sign-off. */
  urgentOpen: number;
};

export type ReviewNotes = {
  notes: ReviewNote[];
  members: Member[];
  canRaise: boolean;
  canReview: boolean;
  /** Counted from the notes read, so the page and its filters agree. */
  counts: NoteCounts;
  defaultOwnerId: string | null;
  /** The person reading (the route asks the API who the session is); null where unknown:
   * "Mine" is then not offered. */
  viewerId: string | null;
};

/* Parsing ------------------------------------------------------------------------------ */

type Raw = Record<string, unknown>;

const isRaw = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A string the server sent, bounded; "" for anything else. */
const str = (value: unknown, most: number): string =>
  typeof value === "string" ? value.slice(0, most) : "";

const whole = (value: unknown, least: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= least
    ? value
    : null;

const oneOf = <T extends string>(
  known: readonly T[],
  value: unknown,
): T | null =>
  typeof value === "string" && (known as readonly string[]).includes(value)
    ? (value as T)
    : null;

function personOf(value: unknown): Person | null {
  if (!isRaw(value) || typeof value.id !== "string" || !UUID.test(value.id)) {
    return null;
  }
  const name = str(value.name, 200).replace(/\s+/g, " ").trim();
  return { id: value.id, name: name === "" ? "Someone" : name };
}

function eventOf(value: unknown): NoteEvent | null {
  if (!isRaw(value) || typeof value.id !== "string" || !UUID.test(value.id)) {
    return null;
  }
  const by = personOf(value.by);
  if (by === null) {
    return null;
  }
  const data = isRaw(value.data) ? value.data : {};
  return {
    id: value.id,
    kind: oneOf(EVENT_KINDS, value.kind) ?? "OTHER",
    by,
    at: str(value.at, 64),
    text: str(value.text, 4 * NOTE_BOUNDS.replyMax),
    from: str(data.from, 64),
    to: str(data.to, 64),
    fromName: str(data.from_name, 200),
    toName: str(data.to_name, 200),
  };
}

function canOf(value: unknown): NoteCan {
  const can = isRaw(value) ? value : {};
  const yes = (key: string) => can[key] === true;
  return {
    reply: yes("reply"),
    respond: yes("respond"),
    clear: yes("clear"),
    reopen: yes("reopen"),
    dismiss: yes("dismiss"),
    criticality: yes("criticality"),
    owner: yes("owner"),
  };
}

/** One note as the server sent it, or null where it is not one the page can place: no
 * id, number or version, an anchor it does not know, a field that is not a key, or
 * highlighted words without the words. */
export function parseNote(value: unknown): ReviewNote | null {
  if (!isRaw(value) || typeof value.id !== "string" || !UUID.test(value.id)) {
    return null;
  }
  const number = whole(value.number, 1);
  const version = whole(value.version, 1);
  const anchorKind = oneOf(
    ["FIELD", "TEXT", "WORKPAPER"] as const,
    value.anchor_kind,
  );
  const owner = personOf(value.owner);
  const raisedBy = personOf(value.raised_by);
  if (
    number === null ||
    version === null ||
    anchorKind === null ||
    owner === null ||
    raisedBy === null
  ) {
    return null;
  }
  const field = str(value.field, NOTE_BOUNDS.field + 1);
  if (anchorKind !== "WORKPAPER" && !FIELD_KEY.test(field)) {
    return null;
  }
  const quote =
    anchorKind === "TEXT" ? str(value.quote, NOTE_BOUNDS.quoteMax) : "";
  if (anchorKind === "TEXT" && quote === "") {
    return null;
  }
  return {
    id: value.id,
    number,
    anchorKind,
    field: anchorKind === "WORKPAPER" ? "" : field,
    quote,
    prefix: anchorKind === "TEXT" ? str(value.prefix, NOTE_BOUNDS.around) : "",
    suffix: anchorKind === "TEXT" ? str(value.suffix, NOTE_BOUNDS.around) : "",
    occurrence:
      anchorKind === "TEXT"
        ? Math.min(whole(value.occurrence, 0) ?? 0, NOTE_BOUNDS.occurrence)
        : 0,
    workpaperVersion: whole(value.workpaper_version, 1) ?? 1,
    text: str(value.text, NOTE_BOUNDS.textMax * 2),
    criticality: oneOf(CRITICALITIES, value.criticality) ?? "OTHER",
    status: oneOf(STATUSES, value.status) ?? "OTHER",
    owner,
    raisedBy,
    raisedAt: str(value.raised_at, 64),
    clearedBy: personOf(value.cleared_by),
    clearedAt: str(value.cleared_at, 64),
    dismissedBy: personOf(value.dismissed_by),
    dismissedAt: str(value.dismissed_at, 64),
    dismissReason: str(value.dismiss_reason, NOTE_BOUNDS.reasonMax * 2),
    version,
    events: (Array.isArray(value.events) ? value.events : [])
      .slice(0, 1000)
      .map(eventOf)
      .filter((event): event is NoteEvent => event !== null),
    can: canOf(value.can),
  };
}

export function countsOf(notes: readonly ReviewNote[]): NoteCounts {
  const count = (status: NoteStatus) =>
    notes.filter((note) => note.status === status).length;
  return {
    open: count("OPEN"),
    responded: count("RESPONDED"),
    cleared: count("CLEARED"),
    dismissed: count("DISMISSED"),
    urgentOpen: notes.filter(
      (note) => note.criticality === "URGENT" && isOpen(note),
    ).length,
  };
}

/** The server's answer to a read, or null where it is not one. Malformed notes are left
 * out (one the page cannot place is not drawn somewhere wrong); a number repeated keeps
 * its first note. */
export function parseReviewNotes(
  value: unknown,
  viewerId: unknown = null,
): ReviewNotes | null {
  if (!isRaw(value) || !Array.isArray(value.notes)) {
    return null;
  }
  const seen = new Set<string>();
  const notes: ReviewNote[] = [];
  for (const item of value.notes.slice(0, 5000)) {
    const note = parseNote(item);
    if (note !== null && !seen.has(note.id)) {
      seen.add(note.id);
      notes.push(note);
    }
  }
  const members: Member[] = [];
  for (const item of Array.isArray(value.members) ? value.members : []) {
    const person = personOf(item);
    if (person !== null && !members.some((member) => member.id === person.id)) {
      members.push({
        ...person,
        role: isRaw(item) ? str(item.role, 60).trim() : "",
      });
    }
  }
  const owner =
    typeof value.default_owner_id === "string" &&
    members.some((member) => member.id === value.default_owner_id)
      ? value.default_owner_id
      : null;
  return {
    notes,
    members,
    canRaise: value.can_raise === true,
    canReview: value.can_review === true,
    counts: countsOf(notes),
    defaultOwnerId: owner,
    viewerId:
      typeof viewerId === "string" && UUID.test(viewerId) ? viewerId : null,
  };
}

/** The read with one note as the server now has it (a write answers the note). */
export function withNote(set: ReviewNotes, note: ReviewNote): ReviewNotes {
  const at = set.notes.findIndex((item) => item.id === note.id);
  const notes =
    at < 0
      ? [...set.notes, note]
      : set.notes.map((item, index) => (index === at ? note : item));
  return { ...set, notes, counts: countsOf(notes) };
}

/* Words ---------------------------------------------------------------------------------- */

export const CRITICALITY_WORDS: Record<Criticality | "OTHER", string> = {
  URGENT: "Urgent",
  NORMAL: "Normal",
  FOLLOW_UP: "Follow-up",
  OTHER: "Criticality not known",
};

/** The class suffix a criticality is drawn with: its colour token (review-notes.css). */
export const CRITICALITY_TONE: Record<Criticality | "OTHER", string> = {
  URGENT: "urgent",
  NORMAL: "normal",
  FOLLOW_UP: "follow-up",
  OTHER: "follow-up",
};

export const STATUS_WORDS: Record<NoteStatus | "OTHER", string> = {
  OPEN: "Open",
  RESPONDED: "Responded",
  CLEARED: "Cleared",
  DISMISSED: "Dismissed",
  OTHER: "Status not known",
};

/** Still waiting on someone: open, or responded to and not yet cleared. */
export function isOpen(note: Pick<ReviewNote, "status">): boolean {
  return note.status === "OPEN" || note.status === "RESPONDED";
}

/** A note that is cleared or dismissed. A status this page does not know is neither. */
export function isClosed(note: Pick<ReviewNote, "status">): boolean {
  return note.status === "CLEARED" || note.status === "DISMISSED";
}

const GRAVITY: Record<Criticality | "OTHER", number> = {
  URGENT: 3,
  NORMAL: 2,
  FOLLOW_UP: 1,
  OTHER: 0,
};

export const GONE_WORDS =
  "The highlighted words have changed since this note was raised";

export const WHOLE_WORKPAPER = "The workpaper as a whole";

const TIME = (timeZone: string | undefined) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  });

/** "Nov 15, 2:04 PM"; the value as sent where it is not a time. */
export function whenWords(value: string, timeZone?: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : TIME(timeZone).format(time);
}

/** One line of the thread: what happened, by whom. The person's own words are the
 * event's `text`, shown under it. */
export function eventWords(event: NoteEvent): string {
  const who = event.by.name;
  const crit = (value: string) =>
    CRITICALITY_WORDS[oneOf(CRITICALITIES, value) ?? "OTHER"];
  switch (event.kind) {
    case "RAISED":
      return `${who} raised the note`;
    case "REPLIED":
      return `${who} replied`;
    case "RESPONDED":
      return `${who} responded`;
    case "CLEARED":
      return `${who} cleared the note`;
    case "REOPENED":
      return `${who} reopened the note`;
    case "DISMISSED":
      return `${who} dismissed the note`;
    case "CRITICALITY":
      return event.from !== "" && event.to !== ""
        ? `${who} changed the criticality from ${crit(event.from)} to ${crit(event.to)}`
        : `${who} changed the criticality`;
    case "OWNER":
      return event.toName !== ""
        ? `${who} handed the note to ${event.toName}`
        : `${who} changed the resolution owner`;
    default:
      return `${who} changed the note`;
  }
}

/* The note's card ------------------------------------------------------------------------ */

/** The events that are a person's own words, shown under the note as its replies: a
 * reply, a response, a reopening's text and a dismissal's reason. RAISED is the note
 * itself (its text is the note's); a change of criticality or of owner, and a clearing,
 * are kept on the server and not shown in the thread (product owner, 16 November 2026). */
export const WORD_EVENTS: readonly EventKind[] = [
  "REPLIED",
  "RESPONDED",
  "REOPENED",
  "DISMISSED",
];

/** The note's replies, in order: its events that are words a person wrote. */
export function threadEvents(note: Pick<ReviewNote, "events">): NoteEvent[] {
  return note.events.filter(
    (event) =>
      event.kind !== "OTHER" &&
      WORD_EVENTS.includes(event.kind) &&
      event.text.trim() !== "",
  );
}

/** What a reply says it was, after its time: "responded", "reopened", "dismissed"; ""
 * for a plain reply. */
export function threadTag(event: Pick<NoteEvent, "kind">): string {
  switch (event.kind) {
    case "RESPONDED":
      return "responded";
    case "REOPENED":
      return "reopened";
    case "DISMISSED":
      return "dismissed";
    default:
      return "";
  }
}

/** An open note's quiet line, under its first line: where it is and who raised it, "4
 * Attributes · C, result · Riley Park" (product owner, 16 November 2026: notes rail,
 * inbox (option 3)). Never the highlighted words: they are in the document. */
export function whereLine(
  note: Pick<ReviewNote, "anchorKind" | "field" | "raisedBy">,
  context: FieldContext = NO_CONTEXT,
): string {
  return `${whereWords(note, context)} · ${note.raisedBy.name}`;
}

/** The first words of a text, for a resolved note's one line: cut at a word, with an
 * ellipsis where cut. */
export function firstWords(text: string, most = 56): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if ([...flat].length <= most) {
    return flat;
  }
  const cut = [...flat].slice(0, most).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > most / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}

/** A resolved note's word at the right of its line: "resolved" (cleared), "dismissed";
 * "" for a note that is not closed. */
export function closedWord(note: Pick<ReviewNote, "status">): string {
  return note.status === "CLEARED"
    ? "resolved"
    : note.status === "DISMISSED"
      ? "dismissed"
      : "";
}

/** Who closed the note and when, for a closed note's card: "Cleared by Dana Lee · Nov 16,
 * 2:04 PM", "Dismissed by …"; "" for a note that is not closed. The evidence of review a
 * reviewer reads on screen (docs/workpaper-review.md, section 2; independent review, 16
 * November 2026: before, a closed card said only "resolved"). */
export function closedLine(
  note: Pick<
    ReviewNote,
    "status" | "clearedBy" | "clearedAt" | "dismissedBy" | "dismissedAt"
  >,
  timeZone?: string,
): string {
  const line = (verb: string, by: Person | null, at: string) =>
    [
      by === null || by.name.trim() === ""
        ? verb
        : `${verb} by ${by.name.trim()}`,
      at === "" ? "" : whenWords(at, timeZone),
    ]
      .filter((part) => part !== "")
      .join(" · ");
  return note.status === "CLEARED"
    ? line("Cleared", note.clearedBy, note.clearedAt)
    : note.status === "DISMISSED"
      ? line("Dismissed", note.dismissedBy, note.dismissedAt)
      : "";
}

/** The note's whole history, on request (section 2, "the thread on screen is these
 * rows"): every event as `eventWords` says it, the criticality's and the owner's changes
 * and the clearing included, in order, with the person's own words where it has some. */
export function historyOf(
  note: Pick<ReviewNote, "events">,
): Array<{ id: string; at: string; words: string; text: string }> {
  return note.events.map((event) => ({
    id: event.id,
    at: event.at,
    words: eventWords(event),
    text: event.text.trim(),
  }));
}

/** How the card's reply box sends: as the response (it marks the note responded to)
 * where the person may respond and the note is open, else as a plain reply where they may
 * reply; null where they may do neither (no reply box). */
export function replyMode(
  note: Pick<ReviewNote, "can" | "status">,
): "respond" | "reply" | null {
  if (note.can.respond && note.status === "OPEN") {
    return "respond";
  }
  return note.can.reply ? "reply" : null;
}

/** The keys that set a selected note's criticality: 1 Urgent, 2 Normal, 3 Follow-up. */
export function criticalityForKey(key: string): Criticality | null {
  return key === "1"
    ? "URGENT"
    : key === "2"
      ? "NORMAL"
      : key === "3"
        ? "FOLLOW_UP"
        : null;
}

/** A member as the owner picker lists them: "Dana Lee · Preparer". */
export function memberWords(member: Member): string {
  return member.role === "" ? member.name : `${member.name} · ${member.role}`;
}

/* Field keys (section 3) ---------------------------------------------------------------- */

export const UNDERSTANDING = "understanding";
export const CONCLUSION = "conclusion";
export const CONCLUSION_CHOICE = "conclusion.choice";

export type AttributePart = "basis" | "result" | "note";
export type ControlFact = "risk" | "activity";

export const walkthroughKey = (row: number, column: number): string =>
  `walkthrough.${row}.${column}`;
export const attributeKey = (id: string, part: AttributePart): string =>
  `attributes.${id}.${part}`;
export const reportKey = (row: number, column: number): string =>
  `reports.${row}.${column}`;
export const procedureKey = (n: number): string => `procedures.${n}`;
/* `matters.<n>` named a row of the removed "Matters for the reviewer"
 * (docs/design-workpaper.md, section 3.9): its notes are kept, and listed as "On an item
 * no longer listed"; nothing on the page is noted with it any more (placeOf still reads
 * it). */
/** A considered point (section 3.9): `points.<its 32-hex key>`. */
export const pointKey = (key: string): string => pointField(key);
export const controlKey = (fact: ControlFact): string => `control.${fact}`;

export type FieldPlace =
  | { kind: "understanding" }
  | { kind: "conclusion" }
  | { kind: "choice" }
  | { kind: "control"; fact: ControlFact }
  | { kind: "procedure"; n: number }
  | { kind: "walkthrough"; row: number; column: number }
  | { kind: "attribute"; id: string; part: AttributePart }
  | { kind: "report"; row: number; column: number }
  | { kind: "matter"; n: number }
  | { kind: "point"; key: string };

const N = "([1-9][0-9]{0,4})";
const PLACES: ReadonlyArray<[RegExp, (m: RegExpExecArray) => FieldPlace]> = [
  [/^understanding$/, () => ({ kind: "understanding" })],
  [/^conclusion$/, () => ({ kind: "conclusion" })],
  [/^conclusion\.choice$/, () => ({ kind: "choice" })],
  [
    /^control\.(risk|activity)$/,
    (m) => ({ kind: "control", fact: m[1] as ControlFact }),
  ],
  [
    new RegExp(`^procedures\\.${N}$`),
    (m) => ({ kind: "procedure", n: Number(m[1]) }),
  ],
  [
    new RegExp(`^matters\\.${N}$`),
    (m) => ({ kind: "matter", n: Number(m[1]) }),
  ],
  [/^points\.([0-9a-f]{32})$/, (m) => ({ kind: "point", key: m[1] ?? "" })],
  [
    new RegExp(`^walkthrough\\.${N}\\.${N}$`),
    (m) => ({ kind: "walkthrough", row: Number(m[1]), column: Number(m[2]) }),
  ],
  [
    new RegExp(`^reports\\.${N}\\.${N}$`),
    (m) => ({ kind: "report", row: Number(m[1]), column: Number(m[2]) }),
  ],
  [
    /^attributes\.([A-Za-z0-9-]{1,80})\.(basis|result|note)$/,
    (m) => ({ kind: "attribute", id: m[1] ?? "", part: m[2] as AttributePart }),
  ],
];

/** Which place of the workpaper a key names; null for a key this page does not know
 * (it stays a valid key: the note is listed, under "Elsewhere"). */
export function placeOf(key: string): FieldPlace | null {
  for (const [pattern, make] of PLACES) {
    const found = pattern.exec(key);
    if (found !== null) {
      return make(found);
    }
  }
  return null;
}

const S = DW_SECTION;
/** After everything on the page: a key this page does not know, a retired matter. */
const NOT_ON_PAGE = DW_TICKMARKS_ORDER + 1;

/** The workpaper's sections as the document numbers them (0: the workpaper as a whole),
 * in the document's order; the numbers are DW_SECTION's. */
export const SECTIONS: ReadonlyArray<{ n: number; name: string }> = [
  { n: 0, name: WHOLE_WORKPAPER },
  { n: S.objective, name: `${S.objective} Objective, risk and control` },
  { n: S.procedures, name: `${S.procedures} Procedures performed` },
  // Rewritten (docs/design-workpaper.md, section 3.9). Old: 6 Matters for the reviewer,
  // 7 Conclusion. New: there is no matters section; the Conclusion is 6, and the
  // unnumbered "Tickmarks and evidence" after it holds the points placed on a file's line.
  // Rewritten again (section 3.10; product owner, 16 November 2026: procedures first, the
  // understanding as their result). Old: the understanding inside 1, then 3 Walkthrough,
  // 4 Attributes tested, 5 Information produced by the entity, 6 Conclusion, Tickmarks
  // and evidence as 7. New: 3 Understanding of the control, a section of its own, then 4
  // Walkthrough, 5 Attributes tested, 6 Information produced by the entity, 7 Conclusion,
  // Tickmarks and evidence as 8.
  {
    n: S.understanding,
    name: `${S.understanding} Understanding of the control`,
  },
  { n: S.walkthrough, name: `${S.walkthrough} Walkthrough` },
  { n: S.attributes, name: `${S.attributes} Attributes tested` },
  { n: S.ipe, name: `${S.ipe} Information produced by the entity` },
  { n: S.conclusion, name: `${S.conclusion} Conclusion` },
  { n: DW_TICKMARKS_ORDER, name: "Tickmarks and evidence" },
];

/** The section a note's field is in (0 for the workpaper as a whole); null for a key this
 * page does not know, a note on the removed matters, and a point this read does not
 * have. A point is in the section of its place (`context`). */
export function sectionOf(
  note: Pick<ReviewNote, "anchorKind" | "field">,
  context: FieldContext = NO_CONTEXT,
): number | null {
  if (note.anchorKind === "WORKPAPER") {
    return 0;
  }
  const place = placeOf(note.field);
  if (place === null) {
    return null;
  }
  switch (place.kind) {
    case "control":
      return S.objective;
    case "procedure":
      return S.procedures;
    case "understanding":
      return S.understanding;
    case "walkthrough":
      return S.walkthrough;
    case "attribute":
      return S.attributes;
    case "report":
      return S.ipe;
    case "matter":
      return null;
    case "point":
      return (
        (context.points ?? []).find((item) => item.key === place.key)
          ?.section ?? null
      );
    default:
      return S.conclusion;
  }
}

/** What the labels and the order read of the workpaper: the attributes' codes in their
 * order, the walkthrough's stored column names, the reports' references. */
export type FieldContext = {
  attributes: ReadonlyArray<{ id: string; code: string }>;
  walkthroughColumns: readonly string[];
  reportRefs: readonly string[];
  /** The points of this read (section 3.9): their words, the section of their place, and
   * their place in the document's order. */
  points?: ReadonlyArray<PointContext>;
};

export type PointContext = {
  key: string;
  text: string;
  section: number;
  rank: number[];
};

export const NO_CONTEXT: FieldContext = {
  attributes: [],
  walkthroughColumns: [],
  reportRefs: [],
  points: [],
};

/** Said of a note on the removed "Matters for the reviewer" (section 3.9). */
export const RETIRED_FIELD = "On an item no longer listed";
export const CONSIDERED_POINT = "Considered point";

const SECTION_LEADS: Readonly<Record<number, string>> = {
  [S.attributes]: `${S.attributes} Attributes`,
  [S.ipe]: `${S.ipe} Reports`,
  [DW_TICKMARKS_ORDER]: "Tickmarks and evidence",
};

const REPORT_COLUMNS = [
  "report",
  "source",
  "completeness and accuracy procedure",
];
const WALK_NAMES = ["step", "who", "evidence inspected", "result"];
const PART_WORDS: Record<AttributePart, string> = {
  basis: "what the evidence shows",
  result: "result",
  note: "preparer's note",
};

/** "Result" reads "result" inside a label; "IPE" stays as written. */
const inLabel = (name: string): string =>
  /^[A-Z][a-z]/.test(name)
    ? `${name.charAt(0).toLowerCase()}${name.slice(1)}`
    : name;

/** Where a note is, in words: "5 Attributes · C, result", "3 Understanding of the
 * control", "The workpaper as a whole" (the numbers are DW_SECTION's). */
export function whereWords(
  note: Pick<ReviewNote, "anchorKind" | "field">,
  context: FieldContext = NO_CONTEXT,
): string {
  if (note.anchorKind === "WORKPAPER") {
    return WHOLE_WORKPAPER;
  }
  const place = placeOf(note.field);
  if (place === null) {
    return note.field;
  }
  switch (place.kind) {
    case "understanding":
      return `${S.understanding} Understanding of the control`;
    case "control":
      return `${S.objective} ${place.fact === "risk" ? "Risk addressed" : "Control activity"}`;
    case "procedure":
      return `${S.procedures} Procedures · ${place.n}`;
    case "walkthrough": {
      const name =
        context.walkthroughColumns[place.column - 1]?.trim() ||
        WALK_NAMES[place.column - 1] ||
        `column ${place.column}`;
      return `${S.walkthrough} Walkthrough · step ${place.row}, ${inLabel(name)}`;
    }
    case "attribute": {
      const code =
        context.attributes.find((item) => item.id === place.id)?.code ?? "";
      return `${S.attributes} Attributes · ${code === "" ? "an attribute" : code}, ${PART_WORDS[place.part]}`;
    }
    case "report": {
      const ref = context.reportRefs[place.row - 1]?.trim() ?? "";
      const name = REPORT_COLUMNS[place.column - 1] ?? `column ${place.column}`;
      return `${S.ipe} Reports · ${ref === "" ? `row ${place.row}` : ref}, ${name}`;
    }
    case "matter":
      return RETIRED_FIELD;
    case "point": {
      const point = (context.points ?? []).find(
        (item) => item.key === place.key,
      );
      if (point === undefined) {
        return CONSIDERED_POINT;
      }
      const lead = SECTION_LEADS[point.section];
      return `${lead === undefined ? "" : `${lead} · `}${CONSIDERED_POINT}: ${firstWords(point.text, 48)}`;
    }
    case "choice":
      return `${S.conclusion} Conclusion · the choice`;
    default:
      return `${S.conclusion} Conclusion`;
  }
}

/** What the note is on, in a few words: "highlighted words", "the field". */
export function anchorWords(note: Pick<ReviewNote, "anchorKind">): string {
  return note.anchorKind === "TEXT"
    ? "highlighted words"
    : note.anchorKind === "FIELD"
      ? "the field"
      : "";
}

/** A field's place in the document, compared item by item. */
function rankOf(key: string, context: FieldContext): number[] {
  const place = placeOf(key);
  if (place === null) {
    return [NOT_ON_PAGE];
  }
  switch (place.kind) {
    case "control":
      return [S.objective, place.fact === "risk" ? 0 : 1];
    case "procedure":
      return [S.procedures, place.n];
    case "understanding":
      return [S.understanding, 0];
    case "walkthrough":
      return [S.walkthrough, place.row, place.column];
    case "attribute": {
      const at = context.attributes.findIndex((item) => item.id === place.id);
      const part = place.part === "basis" ? 0 : place.part === "note" ? 1 : 2;
      return [S.attributes, at < 0 ? 100_000 : at, part];
    }
    case "report":
      return [S.ipe, place.row, place.column];
    case "matter":
      // No longer on the page: after everything that is.
      return [NOT_ON_PAGE, place.n];
    case "point":
      return (
        (context.points ?? []).find((item) => item.key === place.key)?.rank ?? [
          NOT_ON_PAGE,
        ]
      );
    case "choice":
      return [S.conclusion, 0];
    default:
      return [S.conclusion, 1];
  }
}

const compareRanks = (a: readonly number[], b: readonly number[]): number => {
  for (let at = 0; at < Math.max(a.length, b.length); at++) {
    const diff = (a[at] ?? -1) - (b[at] ?? -1);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
};

/**
 * The notes in the order of the document: the workpaper as a whole first, then field by
 * field as the sheet draws them; in a field, a note on the field before those on its
 * words, those by where the words are (`positions`: the note's start in the field's text
 * now, null where the words are gone, which go last); then by number.
 */
export function documentOrder(
  notes: readonly ReviewNote[],
  context: FieldContext = NO_CONTEXT,
  positions: ReadonlyMap<string, number | null> = new Map(),
): ReviewNote[] {
  const rank = (note: ReviewNote): number[] => {
    if (note.anchorKind === "WORKPAPER") {
      return [0];
    }
    const at = positions.get(note.id);
    const where =
      note.anchorKind === "FIELD"
        ? -1
        : at === null || at === undefined
          ? Number.MAX_SAFE_INTEGER
          : at;
    return [...rankOf(note.field, context), 1e9, where];
  };
  return notes
    .map((note) => ({ note, rank: rank(note) }))
    .sort(
      (a, b) => compareRanks(a.rank, b.rank) || a.note.number - b.note.number,
    )
    .map((item) => item.note);
}

/* A field's text ----------------------------------------------------------------------- */

/** A section's stored text (marks included) as the sheet's text reads: its runs in order,
 * with nothing between paragraphs, lines or items. This is what a selection's offsets and
 * a highlight's ranges are counted in, and what RichText draws. */
export function richPlain(text: string): string {
  let out = "";
  for (const block of parseRich(text)) {
    const lines = block.type === "p" ? block.lines : block.items;
    for (const line of lines) {
      for (const run of line) {
        out += run.t;
      }
    }
  }
  return out;
}

/** The workpaper as the field texts read it (DesignWorkpaper is one). */
export type PaperFields = {
  risk: string;
  activity: string;
  understanding: string;
  procedures: readonly string[];
  walkthrough: {
    columns: readonly string[];
    steps: ReadonlyArray<{
      number: number;
      when: string;
      step: string;
      who: string;
      evidence: string;
      result: string;
    }>;
  };
  attributes: ReadonlyArray<{
    id: string;
    code: string;
    basis: string;
    notes: string;
  }>;
  reports: ReadonlyArray<{
    ref: string;
    report: string;
    source: string;
    procedure: string;
  }>;
  /** The points (section 3.9), placed by the rows above and the evidence index. */
  points: ReadonlyArray<{
    key: string;
    text: string;
    place: PointPlace;
    considered: Consideration | null;
  }>;
  evidence: ReadonlyArray<{ ref: string; fileId: string }>;
  conclusion: { text: string };
};

const WHEN_COLUMN = /^(when|date|date and time)$/i;

/** The stored walkthrough's column numbers (from 1) of the cells the sheet draws: the
 * columns it was drafted with where they are four and a When or Date column, else the
 * standard template's order (step, who, evidence, result). `when` is null where the
 * stored section has no such column (the sheet's When then comes from the records). */
export function walkthroughColumnsOf(columns: readonly string[]): {
  when: number | null;
  step: number;
  who: number;
  evidence: number;
  result: number;
} {
  const whenAt = columns.findIndex((column) => WHEN_COLUMN.test(column.trim()));
  const own = columns
    .map((_, index) => index)
    .filter((index) => index !== whenAt);
  if (own.length === 4) {
    const [step = 0, who = 1, evidence = 2, result = 3] = own;
    return {
      when: whenAt < 0 ? null : whenAt + 1,
      step: step + 1,
      who: who + 1,
      evidence: evidence + 1,
      result: result + 1,
    };
  }
  return { when: null, step: 1, who: 2, evidence: 3, result: 4 };
}

export function contextOf(paper: PaperFields): FieldContext {
  return {
    attributes: paper.attributes.map((item) => ({
      id: item.id,
      code: item.code,
    })),
    walkthroughColumns: paper.walkthrough.columns,
    reportRefs: paper.reports.map((item) => item.ref),
    points: paper.points.map((point, at) => {
      const shown = shownAt(point, paper);
      // In the document's order: under its attribute's row (after the row's own fields),
      // under its report's row, on its file's line, or at the head of section 5.
      const rank =
        shown.where === "attribute"
          ? [
              S.attributes,
              paper.attributes.findIndex(
                (item) => item.id === shown.attributeId,
              ),
              3,
              at,
            ]
          : shown.where === "report"
            ? [S.ipe, shown.index + 1, 4, at]
            : shown.where === "evidence"
              ? [
                  DW_TICKMARKS_ORDER,
                  paper.evidence.findIndex((item) => item.ref === shown.ref),
                  at,
                ]
              : [S.attributes, -1, at];
      return {
        key: point.key,
        text: point.text,
        section: placeSection(shown),
        rank,
      };
    }),
  };
}

/** Every field's text now, by its key, as the sheet draws it. */
export function fieldTextsOf(paper: PaperFields): Map<string, string> {
  const texts = new Map<string, string>();
  texts.set(controlKey("risk"), paper.risk);
  texts.set(controlKey("activity"), paper.activity);
  texts.set(UNDERSTANDING, richPlain(paper.understanding));
  paper.procedures.forEach((item, at) => {
    texts.set(procedureKey(at + 1), item);
  });
  const cols = walkthroughColumnsOf(paper.walkthrough.columns);
  for (const step of paper.walkthrough.steps) {
    if (cols.when !== null) {
      texts.set(walkthroughKey(step.number, cols.when), step.when);
    }
    texts.set(walkthroughKey(step.number, cols.step), step.step);
    texts.set(walkthroughKey(step.number, cols.who), step.who);
    texts.set(walkthroughKey(step.number, cols.evidence), step.evidence);
    texts.set(walkthroughKey(step.number, cols.result), step.result);
  }
  for (const attribute of paper.attributes) {
    texts.set(attributeKey(attribute.id, "basis"), attribute.basis);
    texts.set(attributeKey(attribute.id, "note"), attribute.notes);
    texts.set(attributeKey(attribute.id, "result"), "");
  }
  paper.reports.forEach((item, at) => {
    texts.set(reportKey(at + 1, 1), item.report);
    texts.set(reportKey(at + 1, 2), item.source);
    texts.set(reportKey(at + 1, 3), item.procedure);
  });
  // A considered point's field is its one line, as the sheet draws it.
  for (const point of paper.points) {
    if (point.considered !== null) {
      texts.set(pointKey(point.key), consideredLine(point.considered));
    }
  }
  texts.set(CONCLUSION, richPlain(paper.conclusion.text));
  return texts;
}

/* Highlighted words: the anchor -------------------------------------------------------- */

export type TextAnchor = {
  quote: string;
  prefix: string;
  suffix: string;
  occurrence: number;
};

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** Every place the words are in the text, overlapping ones included. */
function matchesOf(text: string, quote: string): number[] {
  const found: number[] = [];
  if (quote === "") {
    return found;
  }
  for (
    let at = text.indexOf(quote);
    at >= 0 && found.length <= NOTE_BOUNDS.occurrence;
    at = text.indexOf(quote, at + 1)
  ) {
    found.push(at);
  }
  return found;
}

/** The characters the server leaves out of a note's words and the text around them
 * (workpaper_review_notes.clean_quote): zero-width, joiner and direction-override
 * characters, and the C0 and C1 controls other than tab, line feed and carriage return.
 * The page leaves the same ones out where it anchors and where it finds the words again,
 * or a note on text pasted with them (from a PDF or Word) would read as changed the
 * moment it was raised (independent review, 16 November 2026). */
const STRIPPED =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the controls the server strips are matched on purpose
  /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const STRIPPED_ALL = new RegExp(STRIPPED.source, "g");

/** The text as the server keeps words of it: less the characters it leaves out. */
export function cleanQuote(text: string): string {
  return text.replace(STRIPPED_ALL, "");
}

/** The text less the characters the server leaves out, and where each character kept
 * is in the text (`at`, one more entry for the end). */
function cleaned(text: string): { text: string; at: number[] } {
  const at: number[] = [];
  let kept = "";
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (!STRIPPED.test(char)) {
      kept += char;
      at.push(index);
    }
  }
  at.push(text.length);
  return { text: kept, at };
}

const blank = (char: string) => /\s/.test(char) || STRIPPED.test(char);

/** The selection's words, with the space (and the characters the server leaves out) at
 * their ends left out, never half a character: its range in the text. */
function wordsRange(
  text: string,
  start: number,
  end: number,
): { from: number; to: number } {
  let from = Math.max(0, Math.min(start, end, text.length));
  let to = Math.min(text.length, Math.max(start, end, 0));
  while (from < to && blank(text.charAt(from))) {
    from++;
  }
  while (to > from && blank(text.charAt(to - 1))) {
    to--;
  }
  // Never half of a pair: a selection that splits a character takes all of it.
  if (
    from > 0 &&
    isLow(text.charCodeAt(from)) &&
    isHigh(text.charCodeAt(from - 1))
  ) {
    from--;
  }
  if (
    to < text.length &&
    isLow(text.charCodeAt(to)) &&
    isHigh(text.charCodeAt(to - 1))
  ) {
    to++;
  }
  return { from, to };
}

/** Whether the selection is more words than a note can hold (the 500 characters of
 * `quoteMax`): the margin then says so, and never falls back to the whole field. */
export function selectionTooLong(
  text: string,
  start: number,
  end: number,
): boolean {
  const { from, to } = wordsRange(text, start, end);
  return [...cleanQuote(text.slice(from, to))].length > NOTE_BOUNDS.quoteMax;
}

/** What the margin says where the selected words are too many for a note. */
export const TOO_LONG_WORDS = `Select at most ${NOTE_BOUNDS.quoteMax} characters to note them`;

/**
 * The anchor of a selection in a field's text (`start`, `end`: offsets in the text, in
 * either order): the words with the space at their ends left out, up to 60 characters
 * before and after them (never half a character), and which match of the words in the
 * text they are, from 0. The words and the text around them are as the server keeps
 * them (`cleanQuote`); `start` and `end` are in the text as given. Null where nothing but
 * space is selected, or more than the 500 characters a note's words can be.
 */
export function anchorOf(
  text: string,
  start: number,
  end: number,
): (TextAnchor & { start: number; end: number }) | null {
  const { from, to } = wordsRange(text, start, end);
  const quote = cleanQuote(text.slice(from, to));
  if (quote === "" || [...quote].length > NOTE_BOUNDS.quoteMax) {
    return null;
  }
  let before = Math.max(0, from - NOTE_BOUNDS.around);
  if (before > 0 && isLow(text.charCodeAt(before))) {
    before++;
  }
  let after = Math.min(text.length, to + NOTE_BOUNDS.around);
  if (after < text.length && isLow(text.charCodeAt(after))) {
    after--;
  }
  const clean = cleaned(text);
  const cleanFrom = clean.at.findIndex((index) => index >= from);
  return {
    quote,
    prefix: cleanQuote(text.slice(before, from)),
    suffix: cleanQuote(text.slice(to, after)),
    occurrence: matchesOf(clean.text, quote).indexOf(cleanFrom),
    start: from,
    end: to,
  };
}

/** How many characters `a` ends with that `b` ends with. */
function sameEnd(a: string, b: string): number {
  let n = 0;
  while (
    n < a.length &&
    n < b.length &&
    a[a.length - 1 - n] === b[b.length - 1 - n]
  ) {
    n++;
  }
  return n;
}

/** How many characters `a` starts with that `b` starts with. */
function sameStart(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) {
    n++;
  }
  return n;
}

/**
 * The note's words found again in the field's text as it is now: of the places the words
 * are, those whose surroundings fit the prefix and suffix best, and of those the one
 * nearest the match it was (`occurrence`). Null where the words are not in the text any
 * more: the note then says GONE_WORDS.
 */
export function findAnchor(
  given: string,
  anchor: TextAnchor,
): { start: number; end: number } | null {
  // Found in the text as the server keeps words of it, and given back in the text's
  // own offsets.
  const clean = cleaned(given);
  const text = clean.text;
  const found = matchesOf(text, anchor.quote);
  if (found.length === 0) {
    return null;
  }
  let best = -1;
  let bestScore = -1;
  let bestDistance = Number.MAX_SAFE_INTEGER;
  found.forEach((at, ordinal) => {
    const before = text.slice(Math.max(0, at - anchor.prefix.length), at);
    const end = at + anchor.quote.length;
    const after = text.slice(end, end + anchor.suffix.length);
    const score =
      sameEnd(before, anchor.prefix) + sameStart(after, anchor.suffix);
    const distance = Math.abs(ordinal - anchor.occurrence);
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      best = at;
      bestScore = score;
      bestDistance = distance;
    }
  });
  const last = best + anchor.quote.length - 1;
  return {
    start: clean.at[best] ?? best,
    end: (clean.at[last] ?? last) + 1,
  };
}

/** The note's place in its field's text now: its range, or null where its words are
 * gone; a note on the field (or the workpaper) has none. */
export function placeIn(
  note: ReviewNote,
  texts: ReadonlyMap<string, string>,
): { start: number; end: number } | null {
  if (note.anchorKind !== "TEXT") {
    return null;
  }
  const text = texts.get(note.field);
  return text === undefined ? null : findAnchor(text, note);
}

/** Where each note's words are now (start offset), null where they are gone; for the
 * document's order. Notes on a field are not in it. */
export function positionsOf(
  notes: readonly ReviewNote[],
  texts: ReadonlyMap<string, string>,
): Map<string, number | null> {
  const positions = new Map<string, number | null>();
  for (const note of notes) {
    if (note.anchorKind === "TEXT") {
      positions.set(note.id, placeIn(note, texts)?.start ?? null);
    }
  }
  return positions;
}

/** Whether a key names the removed "Matters for the reviewer" (section 3.9 of
 * docs/design-workpaper.md): its notes are listed with their kept words, never marked. */
export function isRetiredField(key: string): boolean {
  return placeOf(key)?.kind === "matter";
}

/** Whether a TEXT note's words are no longer in its field. A note on a removed item is
 * not said to have lost its words: it says it is on an item no longer listed. */
export function wordsGone(
  note: ReviewNote,
  texts: ReadonlyMap<string, string>,
): boolean {
  return (
    note.anchorKind === "TEXT" &&
    !isRetiredField(note.field) &&
    placeIn(note, texts) === null
  );
}

/** A passage of the field around the note's words now, for the note's side panel: up to
 * `around` characters each side, with an ellipsis where it is cut. Null where gone. */
export function passageOf(
  note: ReviewNote,
  texts: ReadonlyMap<string, string>,
  around = 90,
): { before: string; words: string; after: string } | null {
  const text = texts.get(note.field);
  const place = placeIn(note, texts);
  if (text === undefined || place === null) {
    return null;
  }
  const from = Math.max(0, place.start - around);
  const to = Math.min(text.length, place.end + around);
  return {
    before: `${from > 0 ? "…" : ""}${text.slice(from, place.start)}`,
    words: text.slice(place.start, place.end),
    after: `${text.slice(place.end, to)}${to < text.length ? "…" : ""}`,
  };
}

/* Highlighted words: drawing them ------------------------------------------------------ */

export type PaintRange = {
  start: number;
  end: number;
  noteId: string;
  number: number;
  criticality: Criticality | "OTHER";
};

/** A run of the field's text that one or more notes highlight, in the gravest of their
 * criticalities. Disjoint, in order. */
export type Painted = {
  start: number;
  end: number;
  criticality: Criticality | "OTHER";
  noteIds: string[];
  numbers: number[];
};

export function paintedOf(ranges: readonly PaintRange[]): Painted[] {
  const cuts = new Set<number>();
  for (const range of ranges) {
    if (range.end > range.start) {
      cuts.add(range.start);
      cuts.add(range.end);
    }
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: Painted[] = [];
  for (let at = 0; at + 1 < points.length; at++) {
    const start = points[at] ?? 0;
    const end = points[at + 1] ?? 0;
    const over = ranges
      .filter(
        (range) =>
          range.start <= start && range.end >= end && range.end > range.start,
      )
      .sort((a, b) => a.number - b.number);
    const [first] = over;
    if (first === undefined) {
      continue;
    }
    const gravest = over.reduce(
      (most, range) =>
        GRAVITY[range.criticality] > GRAVITY[most] ? range.criticality : most,
      first.criticality,
    );
    const last = out[out.length - 1];
    const ids = over.map((range) => range.noteId);
    if (
      last !== undefined &&
      last.end === start &&
      last.criticality === gravest &&
      last.noteIds.join() === ids.join()
    ) {
      last.end = end;
    } else {
      out.push({
        start,
        end,
        criticality: gravest,
        noteIds: ids,
        numbers: over.map((range) => range.number),
      });
    }
  }
  return out;
}

/** A run of text that starts at `offset` in the field, cut where highlights begin and
 * end: each piece its words, where it starts in the field, and the highlight over it. */
export function piecesOf(
  words: string,
  offset: number,
  painted: readonly Painted[],
): Array<{ text: string; at: number; painted: Painted | null }> {
  const pieces: Array<{ text: string; at: number; painted: Painted | null }> =
    [];
  const end = offset + words.length;
  let at = offset;
  for (const run of painted) {
    if (run.end <= at || run.start >= end) {
      continue;
    }
    if (run.start > at) {
      pieces.push({
        text: words.slice(at - offset, run.start - offset),
        at,
        painted: null,
      });
      at = run.start;
    }
    const to = Math.min(run.end, end);
    pieces.push({
      text: words.slice(at - offset, to - offset),
      at,
      painted: run,
    });
    at = to;
  }
  if (at < end) {
    pieces.push({ text: words.slice(at - offset), at, painted: null });
  }
  return pieces;
}

/* Filters ------------------------------------------------------------------------------ */

export type NoteFilters = {
  statuses: NoteStatus[];
  criticalities: Criticality[];
  /** A member's id; null for anyone. */
  owner: string | null;
  /** A section's number (0: the workpaper as a whole); null for every section. */
  section: number | null;
  raisedBy: string | null;
  search: string;
};

export const NO_FILTERS: NoteFilters = {
  statuses: [],
  criticalities: [],
  owner: null,
  section: null,
  raisedBy: null,
  search: "",
};

/** All notes opens on what is still waiting: open and responded to. */
export const STARTING_FILTERS: NoteFilters = {
  ...NO_FILTERS,
  statuses: ["OPEN", "RESPONDED"],
};

const folded = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** Whether the note's text, a reply on it or its highlighted words hold the search. */
export function searchHit(note: ReviewNote, search: string): boolean {
  const wanted = folded(search);
  if (wanted === "") {
    return true;
  }
  return [
    note.text,
    note.quote,
    note.dismissReason,
    ...note.events.map((e) => e.text),
  ].some((text) => folded(text).includes(wanted));
}

export type FilterKey =
  | "statuses"
  | "criticalities"
  | "owner"
  | "section"
  | "raisedBy";

function passes(
  note: ReviewNote,
  filters: NoteFilters,
  leave: FilterKey | null = null,
  context: FieldContext = NO_CONTEXT,
): boolean {
  return (
    (leave === "statuses" ||
      filters.statuses.length === 0 ||
      (filters.statuses as readonly string[]).includes(note.status)) &&
    (leave === "criticalities" ||
      filters.criticalities.length === 0 ||
      (filters.criticalities as readonly string[]).includes(
        note.criticality,
      )) &&
    (leave === "owner" ||
      filters.owner === null ||
      note.owner.id === filters.owner) &&
    (leave === "raisedBy" ||
      filters.raisedBy === null ||
      note.raisedBy.id === filters.raisedBy) &&
    (leave === "section" ||
      filters.section === null ||
      sectionOf(note, context) === filters.section) &&
    searchHit(note, filters.search)
  );
}

export function filterNotes(
  notes: readonly ReviewNote[],
  filters: NoteFilters,
  context: FieldContext = NO_CONTEXT,
): ReviewNote[] {
  return notes.filter((note) => passes(note, filters, null, context));
}

/** For each choice of one filter, how many notes it would show with the others as they
 * are: the counts beside the choices. */
export function choiceCounts(
  notes: readonly ReviewNote[],
  filters: NoteFilters,
  key: FilterKey,
  context: FieldContext = NO_CONTEXT,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    if (!passes(note, filters, key, context)) {
      continue;
    }
    const value =
      key === "statuses"
        ? note.status
        : key === "criticalities"
          ? note.criticality
          : key === "owner"
            ? note.owner.id
            : key === "raisedBy"
              ? note.raisedBy.id
              : String(sectionOf(note, context));
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/** Whether any filter narrows the list. */
export function isFiltered(filters: NoteFilters): boolean {
  return (
    filters.statuses.length > 0 ||
    filters.criticalities.length > 0 ||
    filters.owner !== null ||
    filters.section !== null ||
    filters.raisedBy !== null ||
    folded(filters.search) !== ""
  );
}

/** Filters kept for the session, read back cautiously: anything unknown is left out. */
export function parseFilters(value: unknown): NoteFilters | null {
  if (!isRaw(value)) {
    return null;
  }
  const list = <T extends string>(known: readonly T[], raw: unknown): T[] =>
    Array.isArray(raw)
      ? known.filter((item) => (raw as unknown[]).includes(item))
      : [];
  const id = (raw: unknown) =>
    typeof raw === "string" && UUID.test(raw) ? raw : null;
  const section =
    typeof value.section === "number" &&
    SECTIONS.some((item) => item.n === value.section)
      ? value.section
      : null;
  return {
    statuses: list(STATUSES, value.statuses),
    criticalities: list(CRITICALITIES, value.criticalities),
    owner: id(value.owner),
    section,
    raisedBy: id(value.raisedBy),
    search: str(value.search, 200),
  };
}

/** The tab's remembered filters. "v2" since the sections were renumbered
 * (docs/design-workpaper.md, section 3.10): a section remembered by its old number is not
 * read as the section that now has it. */
export const filtersKey = (workpaperId: string): string =>
  `aw.review-notes.filters.v2.${workpaperId}`;

/* The rail (product owner, 16 November 2026: notes rail, inbox (option 3)) ------------- */

/** The rail's switch: Open (open or responded to), Mine (open, and the person owns or
 * raised it), Resolved (cleared or dismissed). */
export type RailTab = "open" | "mine" | "resolved";

export const RAIL_TABS: ReadonlyArray<{ key: RailTab; label: string }> = [
  { key: "open", label: "Open" },
  { key: "mine", label: "Mine" },
  { key: "resolved", label: "Resolved" },
];

/** What the rail lists: its switch, the filter menu's choices (Urgent only, Mine, This
 * section, an owner) and the search in its header. */
export type RailView = {
  tab: RailTab;
  urgent: boolean;
  mine: boolean;
  section: boolean;
  /** A member's id; null for anyone. */
  owner: string | null;
  search: string;
};

export const RAIL_START: RailView = {
  tab: "open",
  urgent: false,
  mine: false,
  section: false,
  owner: null,
  search: "",
};

/** Whether the note is the person's: they own it or raised it. Nobody's where the
 * session is not known. */
export function isMine(
  note: Pick<ReviewNote, "owner" | "raisedBy">,
  viewerId: string | null,
): boolean {
  return (
    viewerId !== null &&
    (note.owner.id === viewerId || note.raisedBy.id === viewerId)
  );
}

/** The notes the rail lists, in the order given (the document's): the switch's, then
 * each filter that is on, then the search. "This section" with no section known lists
 * nothing. */
export function railNotes(
  notes: readonly ReviewNote[],
  view: RailView,
  viewerId: string | null,
  section: number | null,
  context: FieldContext = NO_CONTEXT,
): ReviewNote[] {
  return notes.filter(
    (note) =>
      (view.tab === "resolved"
        ? isClosed(note)
        : isOpen(note) && (view.tab === "open" || isMine(note, viewerId))) &&
      (!view.urgent || note.criticality === "URGENT") &&
      (!view.mine || isMine(note, viewerId)) &&
      (!view.section ||
        (section !== null && sectionOf(note, context) === section)) &&
      (view.owner === null || note.owner.id === view.owner) &&
      searchHit(note, view.search),
  );
}

/** A switch's count: the notes it would list, with the filters and the search as they
 * are. */
export function tabCount(
  notes: readonly ReviewNote[],
  view: RailView,
  tab: RailTab,
  viewerId: string | null,
  section: number | null,
  context: FieldContext = NO_CONTEXT,
): number {
  return railNotes(notes, { ...view, tab }, viewerId, section, context).length;
}

/** Whether a choice of the filter menu narrows the list (the search apart). */
export function railFiltered(view: RailView): boolean {
  return view.urgent || view.mine || view.section || view.owner !== null;
}

export type NoteGroup = {
  key: Criticality | "OTHER";
  label: string;
  notes: ReviewNote[];
};

const GROUP_ORDER: ReadonlyArray<Criticality | "OTHER"> = [
  "URGENT",
  "NORMAL",
  "FOLLOW_UP",
  "OTHER",
];

/** The rail's groups: Urgent, Normal, Follow-up (and a criticality this page does not
 * know, last), each with its notes in the order given; only the groups that have some. */
export function groupsOf(notes: readonly ReviewNote[]): NoteGroup[] {
  return GROUP_ORDER.map((key) => ({
    key,
    label: key === "OTHER" ? "Other" : CRITICALITY_WORDS[key],
    notes: notes.filter((note) => note.criticality === key),
  })).filter((group) => group.notes.length > 0);
}

/** An open note's bold first line: its first sentence where that is short, else its
 * first words. */
export function headLine(text: string, most = 72): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const sentence = /^(.+?[.?!])(?:\s|$)/.exec(flat)?.[1] ?? flat;
  return [...sentence].length <= most ? sentence : firstWords(flat, most);
}

const DAY = (timeZone: string | undefined) =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  });

/** A note's time on its line: the time where it is today ("7:14 AM"), the date otherwise
 * ("Nov 15"; "Nov 15, 2025" in another year); the value as sent where it is not a
 * time. */
export function timeLabel(
  value: string,
  now: number = Date.now(),
  timeZone?: string,
): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return value;
  }
  const day = DAY(timeZone);
  const [at, today] = [day.format(time), day.format(now)];
  const zone = timeZone === undefined ? {} : { timeZone };
  if (at === today) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      ...zone,
    }).format(time);
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(at.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
    ...zone,
  }).format(time);
}

/** How many replies a note has: the words people wrote under it (threadEvents). */
export function replyCount(note: Pick<ReviewNote, "events">): number {
  return threadEvents(note).length;
}

/* The writes --------------------------------------------------------------------------- */

export type WorkpaperNotesScope = {
  organizationId: string;
  projectId: string;
  workpaperId: string;
};

export type RaiseInput = {
  anchorKind: AnchorKind;
  field: string;
  anchor: TextAnchor | null;
  workpaperVersion: number;
  text: string;
  criticality: Criticality;
  ownerId: string;
};

export type NoteAction =
  | ({ intent: "raise" } & RaiseInput)
  | {
      intent: "reply";
      noteId: string;
      version: number;
      text: string;
      responds: boolean;
    }
  | { intent: "clear"; noteId: string; version: number }
  | { intent: "reopen"; noteId: string; version: number; text: string }
  | { intent: "dismiss"; noteId: string; version: number; reason: string }
  | {
      intent: "criticality";
      noteId: string;
      version: number;
      criticality: Criticality;
    }
  | { intent: "owner"; noteId: string; version: number; ownerId: string };

export type NoteIntent = NoteAction["intent"];

/** What the page posts to its route for an action. */
export function noteFields(
  scope: WorkpaperNotesScope,
  action: NoteAction,
): Record<string, unknown> {
  const base = {
    organization_id: scope.organizationId,
    project_id: scope.projectId,
    workpaper_id: scope.workpaperId,
    intent: action.intent,
  };
  switch (action.intent) {
    case "raise":
      return {
        ...base,
        anchor_kind: action.anchorKind,
        field: action.anchorKind === "WORKPAPER" ? "" : action.field,
        ...(action.anchorKind === "TEXT" && action.anchor !== null
          ? {
              quote: action.anchor.quote,
              prefix: action.anchor.prefix,
              suffix: action.anchor.suffix,
              occurrence: action.anchor.occurrence,
            }
          : {}),
        workpaper_version: action.workpaperVersion,
        text: action.text,
        criticality: action.criticality,
        owner_id: action.ownerId,
      };
    case "reply":
      return {
        ...base,
        note_id: action.noteId,
        version: action.version,
        text: action.text,
        responds: action.responds,
      };
    case "reopen":
      return {
        ...base,
        note_id: action.noteId,
        version: action.version,
        text: action.text,
      };
    case "dismiss":
      return {
        ...base,
        note_id: action.noteId,
        version: action.version,
        reason: action.reason,
      };
    case "criticality":
      return {
        ...base,
        note_id: action.noteId,
        version: action.version,
        criticality: action.criticality,
      };
    case "owner":
      return {
        ...base,
        note_id: action.noteId,
        version: action.version,
        owner_id: action.ownerId,
      };
    default:
      return { ...base, note_id: action.noteId, version: action.version };
  }
}

/** The API path of a workpaper's notes. */
export function notesPath(scope: WorkpaperNotesScope): string {
  return `/organizations/${scope.organizationId}/projects/${scope.projectId}/workpapers/${scope.workpaperId}/review-notes`;
}

/** The route's query for a read. */
export function notesQuery(scope: WorkpaperNotesScope): string {
  return new URLSearchParams({
    organization: scope.organizationId,
    project: scope.projectId,
    workpaper: scope.workpaperId,
  }).toString();
}

/** The API path a read asks for, or null where the query does not name a workpaper. */
export function notesReadPath(params: URLSearchParams): string | null {
  const id = (key: string) => {
    const value = params.get(key) ?? "";
    return UUID.test(value) ? value : null;
  };
  const organizationId = id("organization");
  const projectId = id("project");
  const workpaperId = id("workpaper");
  if (organizationId === null || projectId === null || workpaperId === null) {
    return null;
  }
  return notesPath({ organizationId, projectId, workpaperId });
}

const count = (text: string) => [...text].length;

/** Why a note's text would not be taken, in the server's words; null where it would. */
export function noteTextProblem(text: string): string | null {
  const n = count(text.trim());
  if (n < NOTE_BOUNDS.textMin) {
    return `Write the note in at least ${NOTE_BOUNDS.textMin} characters.`;
  }
  return n > NOTE_BOUNDS.textMax
    ? `The note can be at most ${NOTE_BOUNDS.textMax} characters.`
    : null;
}

export function replyProblem(text: string): string | null {
  const n = count(text.trim());
  if (n < NOTE_BOUNDS.replyMin) {
    return "Write the reply.";
  }
  return n > NOTE_BOUNDS.replyMax
    ? `The reply can be at most ${NOTE_BOUNDS.replyMax} characters.`
    : null;
}

export function reasonProblem(text: string): string | null {
  const n = count(text.trim());
  if (n < NOTE_BOUNDS.reasonMin) {
    return `Give the reason in at least ${NOTE_BOUNDS.reasonMin} characters.`;
  }
  return n > NOTE_BOUNDS.reasonMax
    ? `The reason can be at most ${NOTE_BOUNDS.reasonMax} characters.`
    : null;
}

export type NoteWrite =
  | { intent: NoteIntent; path: string; body: Record<string, unknown> }
  | { error: string };

const INVALID: NoteWrite = { error: "invalid" };

/**
 * The route's check of what the page posted, and the API call it makes: the path and the
 * body, or an error. The ids are UUIDs, the version a whole number from 1, the texts
 * within the server's bounds; highlighted words are sent exactly as selected (never
 * trimmed or collapsed), so the page finds the same characters again.
 */
export function reviewNoteWrite(fields: Record<string, unknown>): NoteWrite {
  const id = (key: string): string | null => {
    const value = fields[key];
    return typeof value === "string" && UUID.test(value) ? value : null;
  };
  const organizationId = id("organization_id");
  const projectId = id("project_id");
  const workpaperId = id("workpaper_id");
  if (organizationId === null || projectId === null || workpaperId === null) {
    return INVALID;
  }
  const base = notesPath({ organizationId, projectId, workpaperId });
  const text = (key: string): string | null =>
    typeof fields[key] === "string" ? (fields[key] as string).trim() : null;
  const { intent } = fields;
  if (intent === "raise") {
    const anchorKind = oneOf(
      ["FIELD", "TEXT", "WORKPAPER"] as const,
      fields.anchor_kind,
    );
    const criticality = oneOf(CRITICALITIES, fields.criticality);
    const ownerId = id("owner_id");
    const version = whole(fields.workpaper_version, 1);
    const note = text("text");
    const field = typeof fields.field === "string" ? fields.field : "";
    if (
      anchorKind === null ||
      criticality === null ||
      ownerId === null ||
      version === null ||
      note === null ||
      noteTextProblem(note) !== null
    ) {
      return INVALID;
    }
    if (anchorKind === "WORKPAPER" ? field !== "" : !FIELD_KEY.test(field)) {
      return INVALID;
    }
    const quoted = ["quote", "prefix", "suffix", "occurrence"].some(
      (key) => fields[key] !== undefined && fields[key] !== null,
    );
    const body: Record<string, unknown> = {
      anchor_kind: anchorKind,
      field,
      workpaper_version: version,
      text: note,
      criticality,
      owner_id: ownerId,
    };
    if (anchorKind === "TEXT") {
      const { quote, prefix, suffix } = fields;
      const occurrence = whole(fields.occurrence, 0);
      if (
        typeof quote !== "string" ||
        quote === "" ||
        count(quote) > NOTE_BOUNDS.quoteMax ||
        typeof prefix !== "string" ||
        typeof suffix !== "string" ||
        count(prefix) > NOTE_BOUNDS.around ||
        count(suffix) > NOTE_BOUNDS.around ||
        occurrence === null ||
        occurrence > NOTE_BOUNDS.occurrence
      ) {
        return INVALID;
      }
      Object.assign(body, { quote, prefix, suffix, occurrence });
    } else if (quoted) {
      return INVALID;
    }
    return { intent: "raise", path: base, body };
  }
  const noteId = id("note_id");
  const version = whole(fields.version, 1);
  if (noteId === null || version === null) {
    return INVALID;
  }
  const path = (act: string) => `${base}/${noteId}/${act}`;
  switch (intent) {
    case "reply": {
      const reply = text("text");
      if (reply === null || replyProblem(reply) !== null) {
        return INVALID;
      }
      return {
        intent,
        path: path("reply"),
        body: { text: reply, responds: fields.responds === true, version },
      };
    }
    case "clear":
      return { intent, path: path("clear"), body: { version } };
    case "reopen": {
      const why = text("text");
      if (why === null || replyProblem(why) !== null) {
        return INVALID;
      }
      return { intent, path: path("reopen"), body: { text: why, version } };
    }
    case "dismiss": {
      const reason = text("reason");
      if (reason === null || reasonProblem(reason) !== null) {
        return INVALID;
      }
      return { intent, path: path("dismiss"), body: { reason, version } };
    }
    case "criticality": {
      const criticality = oneOf(CRITICALITIES, fields.criticality);
      return criticality === null
        ? INVALID
        : { intent, path: path("criticality"), body: { criticality, version } };
    }
    case "owner": {
      const ownerId = id("owner_id");
      return ownerId === null
        ? INVALID
        : { intent, path: path("owner"), body: { owner_id: ownerId, version } };
    }
    default:
      return INVALID;
  }
}

/* What the person is told -------------------------------------------------------------- */

/** The server's sentence for a stale copy (workpaper_review_notes.STALE). */
export const STALE = "the note changed; read it again";

const asSentence = (said: string): string => {
  const trimmed = said.trim().replace(/[.\s]+$/, "");
  return trimmed === ""
    ? ""
    : `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
};

/** Why a read or a write was not taken, in one sentence; null where it was. A refusal
 * the server explains (403, 409, 422 with a sentence) is said in its words. */
export function notesProblem(status: number, detail = ""): string | null {
  if (status === 200) {
    return null;
  }
  const said = detail.replace(/\s+/g, " ").trim().slice(0, 300);
  switch (status) {
    case 0:
      return "The review notes could not be reached. Nothing was changed: try again.";
    case 401:
      return "Your session has ended. Sign in again, then try once more.";
    case 403:
      return said !== ""
        ? asSentence(said)
        : "Your role on this engagement cannot do this to the note.";
    case 404:
      return "This note or its workpaper is no longer here. The notes are read again.";
    case 409:
      return said === STALE || said === ""
        ? "The note changed since you read it. It is shown as it now stands: check it, then try again."
        : asSentence(said);
    case 422:
      return said !== ""
        ? asSentence(said)
        : "That could not be saved. Check what you wrote, then try again.";
    default:
      return "The change did not reach the server. Nothing was saved: try again.";
  }
}

/** Said where a write's answer leaves it unknown whether the server took it: no answer
 * (the route's timeout, status 0), a server error, or a 200 the page cannot read. The
 * write may be on record, so "Nothing was changed: try again" would invite a second note
 * (independent review, 16 November 2026): the notes are read again instead. */
export const WRITE_IN_DOUBT =
  "The answer did not come back, so this may or may not have been saved. The notes are read again to show what is on record: check them before trying again.";

/** Whether a write's answer leaves it in doubt (`WRITE_IN_DOUBT`): status 0, a 5xx, or a
 * 200 whose note the page could not read (`readable` false). */
export function writeInDoubt(status: number, readable: boolean): boolean {
  return status === 0 || status >= 500 || (status === 200 && !readable);
}

/** What is said once the server confirmed an action. */
export function doneWords(intent: NoteIntent, number: number): string {
  const which = `Note ${number}`;
  switch (intent) {
    case "raise":
      return `${which} added.`;
    case "reply":
      return `Reply added to note ${number}.`;
    case "clear":
      return `${which} cleared.`;
    case "reopen":
      return `${which} reopened.`;
    case "dismiss":
      return `${which} dismissed.`;
    case "criticality":
      return `${which}: criticality changed.`;
    default:
      return `${which}: resolution owner changed.`;
  }
}

/** The step's line (D&I Conclusion and Review): "3 review notes open · 1 urgent". */
export function openLine(counts: NoteCounts): string {
  const open = counts.open + counts.responded;
  if (open === 0) {
    return "No review note is open";
  }
  const notes = `${open} review ${open === 1 ? "note" : "notes"} open`;
  return counts.urgentOpen > 0
    ? `${notes} · ${counts.urgentOpen} urgent`
    : notes;
}

/** Where a link from another step opens All notes: the workpaper's page at this hash. */
export const NOTES_ANCHOR = "review-notes";

export function notesHref(workpaperHref: string): string {
  return `${workpaperHref.split("#")[0] ?? workpaperHref}#${NOTES_ANCHOR}`;
}
