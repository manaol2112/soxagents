"use client";

import {
  createContext,
  type Dispatch,
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type AnchorKind,
  anchorOf,
  anchorWords,
  CRITICALITIES,
  CRITICALITY_TONE,
  CRITICALITY_WORDS,
  type Criticality,
  choiceCounts,
  closedLine,
  closedWord,
  contextOf,
  criticalityForKey,
  documentOrder,
  doneWords,
  type FieldContext,
  type FilterKey,
  fieldTextsOf,
  filterNotes,
  filtersKey,
  firstWords,
  GONE_WORDS,
  groupsOf,
  headLine,
  historyOf,
  isClosed,
  isFiltered,
  isRetiredField,
  memberWords,
  NO_CONTEXT,
  NOTES_ANCHOR,
  type NoteAction,
  type NoteFilters,
  type NoteIntent,
  noteFields,
  notesProblem,
  notesQuery,
  noteTextProblem,
  type Painted,
  type PaintRange,
  type PaperFields,
  paintedOf,
  parseFilters,
  parseNote,
  parseReviewNotes,
  passageOf,
  piecesOf,
  placeIn,
  positionsOf,
  RAIL_START,
  RAIL_TABS,
  type RailView,
  RETIRED_FIELD,
  type ReviewNote,
  type ReviewNotes,
  railFiltered,
  railNotes,
  reasonProblem,
  replyCount,
  replyMode,
  replyProblem,
  SECTIONS,
  STARTING_FILTERS,
  STATUS_WORDS,
  STATUSES,
  sectionOf,
  selectionTooLong,
  type TextAnchor,
  TOO_LONG_WORDS,
  tabCount,
  threadEvents,
  threadTag,
  timeLabel,
  type WorkpaperNotesScope,
  WRITE_IN_DOUBT,
  whenWords,
  whereLine,
  whereWords,
  withNote,
  wordsGone,
  writeInDoubt,
} from "./review-notes-model";
import { parseRich, type Run } from "./rich-text-model";
import { RowMenu, type RowMenuItem } from "./row-menu";
import { notesStripOf } from "./step-focus-model";
import { UiIcon } from "./ui-icon";

/**
 * Workpaper review notes on the screen (docs/workpaper-review.md, section 6): one read of
 * a workpaper's notes and the writes to them; the highlighted words in the Document view
 * and, in its right margin, the numbered markers and the comment icon that starts a note;
 * the rail beside it, where a new note is written and each note is a card; All notes;
 * and the line on the reviewer's step.
 *
 * Nothing is shown as done before the server confirms it: a write's answer is the note as
 * the server then has it, and the notes are read again after it. Who may do what is the
 * server's: each note's `can` says what to offer. Every text of a note, a reply or a
 * quote is a person's, shown as text and never taken as markup.
 *
 * The card (product owner, 16 November 2026: "note card B"): a thin rule in the note's
 * criticality colour, the author and time, three dots that change the criticality in one
 * press, a quiet line of where and who owns it, the note, the replies (only words people
 * wrote), and a reply box that is always there. No quote of the highlighted words: they
 * are in the document.
 *
 * The agent's help (section 7) is a later increment: a note's card leaves a place for it
 * (`AgentHelpSlot`) and offers nothing yet.
 */

const calm = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const scrollBehavior = (): ScrollBehavior => (calm() ? "auto" : "smooth");

/** Whether the rail sits under the document (narrow windows): the new note's form is
 * then a sheet at the bottom of the window. */
const railBelow = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia("(max-width: 1100px)").matches;

/** Whether the page was opened at All notes (`#review-notes`, from D&I Conclusion and
 * Review). */
export function openedAtNotes(): boolean {
  return (
    typeof window !== "undefined" && window.location.hash === `#${NOTES_ANCHOR}`
  );
}

/** Whether a key press goes to something the person types in (keys 1, 2, 3 are then
 * theirs). */
const typingIn = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT");

/** "⌘" on a Mac, "Ctrl" elsewhere: read once mounted (the server does not know). */
function useSendKey(): string {
  const [key, setKey] = useState("Ctrl");
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(window.navigator.userAgent)) {
      setKey("⌘");
    }
  }, []);
  return key;
}

/* Reading and writing ------------------------------------------------------------------ */

type Loaded = {
  key: string;
  status: "ready" | "failed";
  set: ReviewNotes | null;
  problem: string | null;
};

export type ActResult =
  | { ok: true; note: ReviewNote }
  | { ok: false; problem: string; status: number };

export type NotesState = {
  status: "off" | "loading" | "ready" | "failed";
  set: ReviewNotes | null;
  /** Why the notes could not be read; null where they were. */
  problem: string | null;
  busy: NoteIntent | null;
  act: (action: NoteAction) => Promise<ActResult>;
  reread: () => void;
};

type Answer = {
  status: number;
  detail: string;
  result: unknown;
  viewer: unknown;
};

async function call(init?: RequestInit, query = ""): Promise<Answer> {
  try {
    const response = await fetch(
      `/workspace/review-notes${query === "" ? "" : `?${query}`}`,
      { cache: "no-store", ...init },
    );
    const body = (await response.json()) as {
      status?: unknown;
      detail?: unknown;
      result?: unknown;
      viewer_id?: unknown;
    };
    return {
      status: typeof body.status === "number" ? body.status : 0,
      detail: typeof body.detail === "string" ? body.detail : "",
      result: body.result ?? null,
      viewer: body.viewer_id ?? null,
    };
  } catch {
    return { status: 0, detail: "", result: null, viewer: null };
  }
}

/**
 * A workpaper's review notes: read once, read again after each write the server
 * confirms (and after a refusal because a note changed). The latest call wins: an answer
 * a later call overtook is dropped.
 */
export function useReviewNotes(scope: WorkpaperNotesScope | null): NotesState {
  const key = scope === null ? "" : notesQuery(scope);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState<NoteIntent | null>(null);
  const latest = useRef(0);
  const viewer = useRef<unknown>(null);

  const read = useCallback(
    async (keep: boolean) => {
      if (key === "") {
        return;
      }
      const run = ++latest.current;
      const answer = await call(undefined, key);
      if (run !== latest.current) {
        return;
      }
      viewer.current = answer.viewer;
      const set =
        answer.status === 200
          ? parseReviewNotes(answer.result, answer.viewer)
          : null;
      if (set !== null) {
        setLoaded({ key, status: "ready", set, problem: null });
      } else if (!keep) {
        setLoaded({
          key,
          status: "failed",
          set: null,
          problem:
            notesProblem(
              answer.status === 200 ? 0 : answer.status,
              answer.detail,
            ) ?? "",
        });
      }
    },
    [key],
  );

  useEffect(() => {
    read(false).catch(() => undefined);
    return () => {
      latest.current++;
    };
  }, [read]);

  const act = useCallback(
    async (action: NoteAction): Promise<ActResult> => {
      if (scope === null) {
        return { ok: false, problem: notesProblem(0) ?? "", status: 0 };
      }
      setBusy(action.intent);
      const answer = await call({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(noteFields(scope, action)),
      });
      setBusy(null);
      const confirmed = answer.status === 200 ? parseNote(answer.result) : null;
      if (confirmed === null) {
        if (writeInDoubt(answer.status, false)) {
          // It may be on record: never "nothing was changed". The notes are read again,
          // so the list shows what the server holds before anyone tries again.
          read(true).catch(() => undefined);
          return { ok: false, problem: WRITE_IN_DOUBT, status: answer.status };
        }
        if (answer.status === 409 || answer.status === 404) {
          // It changed under the person: the notes are read again, as they now stand.
          read(true).catch(() => undefined);
        }
        return {
          ok: false,
          problem:
            notesProblem(
              answer.status === 200 ? 0 : answer.status,
              answer.detail,
            ) ?? "",
          status: answer.status,
        };
      }
      // The server confirmed it: the note as it now stands, then the whole list again
      // (its counts and the other notes' `can`).
      setLoaded((current) => {
        if (current === null || current.key !== key || current.set === null) {
          return current;
        }
        return { ...current, set: withNote(current.set, confirmed) };
      });
      read(true).catch(() => undefined);
      return { ok: true, note: confirmed };
    },
    [scope, key, read],
  );

  const reread = useCallback(() => {
    read(false).catch(() => undefined);
  }, [read]);

  if (key === "") {
    return { status: "off", set: null, problem: null, busy: null, act, reread };
  }
  if (loaded === null || loaded.key !== key) {
    return { status: "loading", set: null, problem: null, busy, act, reread };
  }
  return {
    status: loaded.status,
    set: loaded.set,
    problem: loaded.problem,
    busy,
    act,
    reread,
  };
}

/* The page's notes: what the document, the rail and All notes share --------------------- */

/** Where a new note goes: a field, highlighted words in a field, or the workpaper. */
export type RaiseTarget = {
  anchorKind: AnchorKind;
  field: string;
  anchor: (TextAnchor & { start: number; end: number }) | null;
  /** What the form shows: "4 Attributes · C, result". */
  where: string;
  /** What had the focus when the form opened: it gets it back. */
  opener: HTMLElement | null;
};

type SelectFrom = "document" | "rail" | "table" | "open";

type NotesUi = {
  notes: NotesState;
  set: ReviewNotes | null;
  /** The Document view is shown with its notes (not printed, read): its fields offer
   * "Add review note" in the margin. */
  active: boolean;
  /** The rail is on as well: the document draws the markers and the highlighted words. */
  on: boolean;
  texts: ReadonlyMap<string, string>;
  context: FieldContext;
  /** Every note, in the order of the document. */
  ordered: ReviewNote[];
  /** What the rail lists: its switch, filters and search over the ordered notes. */
  listed: ReviewNote[];
  /** What the document draws: the listed notes that are not closed, and the selected
   * one whatever it is. */
  drawn: ReviewNote[];
  selected: string | null;
  select: (id: string | null, from: SelectFrom) => void;
  raising: RaiseTarget | null;
  /** Opens the new note's form in the rail (turning the rail on where it is off). */
  startRaise: (target: RaiseTarget) => void;
  endRaise: () => void;
  /** What was typed in a new note's form and not sent, by its place (`raiseKey`): kept
   * when the form is replaced by another, closed by Escape or the view changes, so it is
   * there again when the same place is noted (independent review, 16 November 2026). */
  draftFor: (key: string) => string;
  keepDraft: (key: string, text: string) => void;
  /** The criticality chosen in the open form: the pending words take its colour. */
  pendingCriticality: Criticality;
  setPendingCriticality: (value: Criticality) => void;
  railView: RailView;
  setRailView: Dispatch<SetStateAction<RailView>>;
  section: number | null;
  setSection: (section: number | null) => void;
  workpaperVersion: number;
  announce: (words: string) => void;
  rootRef: RefObject<HTMLElement | null>;
};

const NotesContext = createContext<NotesUi | null>(null);

/** The page's notes, where a provider is above; null otherwise (the printed sheet). */
export function useNotesUi(): NotesUi | null {
  return useContext(NotesContext);
}

const PENDING = "__pending";

/** Gives the focus to a note's card (its pick button) once it is drawn, a frame or two
 * after the answer; to `fallback` where it is not there, and only where the focus has
 * nowhere else to be (the control that had it went). */
function focusCard(noteId: string, fallback: HTMLElement | null = null) {
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      const at = document.activeElement;
      if (at !== null && at !== document.body && at.isConnected) {
        return;
      }
      const pick = document.querySelector<HTMLElement>(
        `[data-rn-card="${noteId}"] .rn-card-pick`,
      );
      const target = pick ?? (fallback?.isConnected ? fallback : null);
      target?.focus({ preventScroll: true });
    }),
  );
}

/** Where a new note is written, as a key: its form, and what was typed in it. */
export const raiseKey = (target: RaiseTarget): string =>
  `${target.anchorKind}-${target.field}-${target.anchor?.start ?? ""}-${target.anchor?.end ?? ""}`;

const fieldSelector = (field: string) =>
  `[data-rn-field="${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(field) : field}"]`;

/**
 * The notes of the workpaper on screen, shared by its Document view (the highlighted
 * words, the margin), the rail and All notes. `on` says whether the Document view is
 * shown with its notes; `railOn` whether the rail is beside it (the highlights and the
 * markers are drawn only then); `onRailOn` turns the rail on, for a note started while it
 * is off. `rootRef` is the document sheet the selection and the scrolling look in.
 */
export function ReviewNotesProvider({
  notes,
  paper,
  on,
  railOn,
  onRailOn,
  workpaperVersion,
  rootRef,
  children,
}: {
  notes: NotesState;
  paper: PaperFields | null;
  on: boolean;
  railOn: boolean;
  onRailOn: () => void;
  workpaperVersion: number;
  rootRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [from, setFrom] = useState<{ from: SelectFrom; at: number }>({
    from: "rail",
    at: 0,
  });
  const [raising, setRaising] = useState<RaiseTarget | null>(null);
  const [pendingCriticality, setPendingCriticality] =
    useState<Criticality>("NORMAL");
  const [railView, setRailView] = useState<RailView>(RAIL_START);
  const [section, setSection] = useState<number | null>(null);
  const [said, setSaid] = useState("");
  const set = notes.set;
  const drawing = on && railOn;
  const texts = useMemo(
    () => (paper === null ? new Map<string, string>() : fieldTextsOf(paper)),
    [paper],
  );
  const context = useMemo(
    () => (paper === null ? NO_CONTEXT : contextOf(paper)),
    [paper],
  );
  const ordered = useMemo(
    () =>
      set === null
        ? []
        : documentOrder(set.notes, context, positionsOf(set.notes, texts)),
    [set, context, texts],
  );
  // What the rail lists: its switch's and filters' notes, and the selected one whatever
  // it is (as the document draws it), so a note just cleared or dismissed from its card
  // stays there, and the focus with it (independent review, 16 November 2026).
  const listed = useMemo(() => {
    const chosen = railNotes(
      ordered,
      railView,
      set?.viewerId ?? null,
      section,
      context,
    );
    return selected === null || chosen.some((note) => note.id === selected)
      ? chosen
      : ordered.filter(
          (note) =>
            note.id === selected || chosen.some((item) => item.id === note.id),
        );
  }, [ordered, railView, set, section, selected, context]);
  const drawn = useMemo(
    () =>
      ordered.filter(
        (note) =>
          note.id === selected ||
          (!isClosed(note) && listed.some((item) => item.id === note.id)),
      ),
    [ordered, listed, selected],
  );
  const select = useCallback((id: string | null, origin: SelectFrom) => {
    setSelected(id);
    setFrom({ from: origin, at: Date.now() });
  }, []);
  const announce = useCallback((words: string) => {
    setSaid("");
    window.requestAnimationFrame(() => setSaid(words));
  }, []);
  const startRaise = useCallback(
    (target: RaiseTarget) => {
      setPendingCriticality("NORMAL");
      setRaising(target);
      if (!railOn) {
        onRailOn();
      }
    },
    [railOn, onRailOn],
  );
  const endRaise = useCallback(() => setRaising(null), []);
  const drafts = useRef(new Map<string, string>());
  const draftFor = useCallback(
    (key: string) => drafts.current.get(key) ?? "",
    [],
  );
  const keepDraft = useCallback((key: string, text: string) => {
    if (text === "") {
      drafts.current.delete(key);
    } else {
      drafts.current.set(key, text);
    }
  }, []);
  // A form left open when the document is no longer shown is closed.
  useEffect(() => {
    if (!on) {
      setRaising(null);
    }
  }, [on]);
  // And when the rail it is in is turned off: no pending highlight is left in the
  // document without its form (independent review, 16 November 2026).
  const railWas = useRef(railOn);
  useEffect(() => {
    if (railWas.current && !railOn) {
      setRaising(null);
    }
    railWas.current = railOn;
  }, [railOn]);

  // Selecting a note in the rail or the table shows its place in the document; selecting
  // it in the document shows its card in the rail. The document may be drawn a moment
  // later (All notes' "Open the workpaper at this passage"): it is looked for again.
  useEffect(() => {
    if (selected === null || from.at === 0) {
      return;
    }
    let tries = 0;
    let frame = 0;
    const find = () => {
      const root = rootRef.current;
      const note = ordered.find((item) => item.id === selected);
      if (from.from === "document") {
        const card = document.querySelector<HTMLElement>(
          `[data-rn-card="${selected}"]`,
        );
        card?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
        return;
      }
      if (from.from === "table" || note === undefined) {
        return;
      }
      const place =
        root === null
          ? null
          : note.anchorKind === "TEXT"
            ? (root.querySelector<HTMLElement>(
                `mark[data-rn-notes~="${note.id}"]`,
              ) ?? root.querySelector<HTMLElement>(fieldSelector(note.field)))
            : note.anchorKind === "FIELD"
              ? root.querySelector<HTMLElement>(fieldSelector(note.field))
              : root;
      if (place === null) {
        if (tries++ < 10) {
          frame = window.requestAnimationFrame(find);
        }
        return;
      }
      place.scrollIntoView({
        block: note.anchorKind === "WORKPAPER" ? "start" : "center",
        behavior: scrollBehavior(),
      });
      if (from.from === "open") {
        document
          .querySelector<HTMLElement>(
            `[data-rn-card="${selected}"] .rn-card-pick`,
          )
          ?.focus({ preventScroll: true });
      }
    };
    frame = window.requestAnimationFrame(find);
    return () => window.cancelAnimationFrame(frame);
  }, [selected, from, ordered, rootRef]);

  const value: NotesUi = {
    notes,
    set,
    active: on,
    on: drawing,
    texts,
    context,
    ordered,
    listed,
    drawn,
    selected,
    select,
    raising,
    startRaise,
    endRaise,
    draftFor,
    keepDraft,
    pendingCriticality,
    setPendingCriticality,
    railView,
    setRailView,
    section,
    setSection,
    workpaperVersion,
    announce,
    rootRef,
  };
  return (
    <NotesContext.Provider value={value}>
      {children}
      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
    </NotesContext.Provider>
  );
}

/* A field in the document --------------------------------------------------------------- */

/** The highlights of a field: its drawn TEXT notes' ranges, found in its text now, and
 * the words of the form being written. */
function paintedFor(ui: NotesUi, field: string): Painted[] {
  const ranges: PaintRange[] = [];
  for (const note of ui.drawn) {
    if (note.anchorKind !== "TEXT" || note.field !== field) {
      continue;
    }
    const place = placeIn(note, ui.texts);
    if (place !== null) {
      ranges.push({
        ...place,
        noteId: note.id,
        number: note.number,
        criticality: note.criticality,
      });
    }
  }
  const pending = ui.raising;
  if (pending !== null && pending.field === field && pending.anchor !== null) {
    ranges.push({
      start: pending.anchor.start,
      end: pending.anchor.end,
      noteId: PENDING,
      number: 0,
      criticality: ui.pendingCriticality,
    });
  }
  return paintedOf(ranges);
}

function markClass(run: Painted, selected: string | null): string {
  return [
    "rn-hl",
    `rn-${CRITICALITY_TONE[run.criticality]}`,
    run.noteIds.includes(PENDING) ? "is-pending" : "",
    selected !== null && run.noteIds.includes(selected) ? "is-selected" : "",
  ]
    .filter((part) => part !== "")
    .join(" ");
}

/** A run of the field's words, with its highlights as marks: elements built from the
 * text, never markup. */
function PaintedWords({
  words,
  offset,
  painted,
  selected,
}: {
  words: string;
  offset: number;
  painted: readonly Painted[];
  selected: string | null;
}) {
  if (painted.length === 0) {
    return words;
  }
  return piecesOf(words, offset, painted).map((piece) =>
    piece.painted === null ? (
      <Fragment key={piece.at}>{piece.text}</Fragment>
    ) : (
      <mark
        key={piece.at}
        className={markClass(piece.painted, selected)}
        data-rn-notes={piece.painted.noteIds.join(" ")}
      >
        {piece.text}
      </mark>
    ),
  );
}

/** A section's text with its formatting, as RichText draws it, and its highlights. */
function PaintedRich({
  text,
  painted,
  selected,
}: {
  text: string;
  painted: readonly Painted[];
  selected: string | null;
}) {
  let at = 0;
  const runs = (line: readonly Run[]) =>
    line.map((run) => {
      const start = at;
      at += run.t.length;
      let made: ReactNode = (
        <PaintedWords
          words={run.t}
          offset={start}
          painted={painted}
          selected={selected}
        />
      );
      if (run.u === true) {
        made = <u>{made}</u>;
      }
      if (run.i === true) {
        made = <em>{made}</em>;
      }
      if (run.b === true) {
        made = <strong>{made}</strong>;
      }
      return <Fragment key={start}>{made}</Fragment>;
    });
  return parseRich(text).map((block) => {
    const first = at;
    if (block.type === "p") {
      return (
        <p key={first}>
          {block.lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the lines of one text keep their order.
            <Fragment key={`${first}-${index}`}>
              {index > 0 ? <br /> : null}
              {runs(line)}
            </Fragment>
          ))}
        </p>
      );
    }
    const List = block.type;
    return (
      <List key={first}>
        {block.items.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the items of one list keep their order.
          <li key={`${first}-${index}`}>{runs(item)}</li>
        ))}
      </List>
    );
  });
}

/**
 * One field of the workpaper (section 3's key): its text, and the highlighted words of
 * its notes in their criticality's colour. Its numbered markers and "Add review note"
 * are in the document's right margin (`NotesMargin`), level with it, never over the
 * text; from the keyboard, a button of its own that the margin shows while it has the
 * focus. Where no provider is above or the notes are off (the printed sheet), it is the
 * text alone, as before.
 */
export function NoteField({
  field,
  text,
  rich = false,
  inline = false,
  children,
}: {
  field: string;
  /** The field's text as stored (marks included where `rich`); none for a field whose
   * words cannot be highlighted (an attribute's result): `children` is then drawn. */
  text?: string;
  /** A section's formatted text: drawn as RichText draws it. */
  rich?: boolean;
  /** Inside a line of text (a paragraph). */
  inline?: boolean;
  /** What is drawn while the notes are off (and, with no `text`, while they are on);
   * the text where none is given. */
  children?: ReactNode;
}) {
  const ui = useNotesUi();
  if (ui === null || !ui.active) {
    return children ?? text ?? null;
  }
  return (
    <OnField ui={ui} field={field} text={text} rich={rich} inline={inline}>
      {children}
    </OnField>
  );
}

function OnField({
  ui,
  field,
  text,
  rich,
  inline,
  children,
}: {
  ui: NotesUi;
  field: string;
  text: string | undefined;
  rich: boolean;
  inline: boolean;
  children: ReactNode;
}) {
  const painted = ui.on || ui.raising !== null ? paintedFor(ui, field) : [];
  const mine = ui.on
    ? ui.drawn.filter(
        (note) => note.anchorKind !== "WORKPAPER" && note.field === field,
      )
    : [];
  const where = whereWords({ anchorKind: "FIELD", field }, ui.context);
  const canRaise = ui.set?.canRaise === true;
  const Box = inline || !rich ? "span" : "div";
  const Wrap = inline ? "span" : "div";
  const selectedHere =
    ui.selected !== null && mine.some((note) => note.id === ui.selected);
  const raisingHere =
    ui.raising !== null &&
    ui.raising.anchorKind === "FIELD" &&
    ui.raising.field === field;
  // What the field's own keyboard button notes: the words selected in this field (a
  // keyboard or screen reader selection), else the field. Read as it takes the focus,
  // for its name, and again as it is pressed (independent review, 16 November 2026:
  // before, it always noted the whole field).
  const [selection, setSelection] = useState<"none" | "words" | "long">("none");
  const selectionHere = (): Offer | null => {
    const offer = offerOf(ui.rootRef.current, ui.texts);
    return offer !== null && offer.field === field ? offer : null;
  };
  const addLabel =
    selection === "words"
      ? `Add review note on the selected words in ${where}`
      : selection === "long"
        ? `${TOO_LONG_WORDS} in ${where}`
        : `Add review note on ${where}`;
  const pick = (event: { target: EventTarget }) => {
    const mark =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("mark[data-rn-notes]")
        : null;
    if (mark === null) {
      return;
    }
    const ids = (mark.dataset.rnNotes ?? "")
      .split(" ")
      .filter((id) => id !== PENDING);
    if (ids.length === 0) {
      return;
    }
    // Words two notes highlight: each press goes to the next of them.
    const at = ui.selected === null ? -1 : ids.indexOf(ui.selected);
    ui.select(ids[(at + 1) % ids.length] ?? null, "document");
  };
  return (
    <Wrap
      className={`rn-field${inline ? " is-inline" : ""}${selectedHere || raisingHere ? " is-selected" : ""}`}
      data-rn-field={field}
    >
      {text === undefined ? (
        <Box className="rn-text">{children}</Box>
      ) : (
        <Box className="rn-text" data-rn-text="" onClick={pick}>
          {rich ? (
            <PaintedRich text={text} painted={painted} selected={ui.selected} />
          ) : (
            <PaintedWords
              words={text}
              offset={0}
              painted={painted}
              selected={ui.selected}
            />
          )}
        </Box>
      )}
      {canRaise ? (
        // From the keyboard: the margin shows its icon level with the field while this
        // has the focus (NotesMargin); it takes no room of the field.
        <button
          type="button"
          className="rn-add"
          data-rn-skip=""
          aria-label={addLabel}
          aria-disabled={selection === "long" ? "true" : undefined}
          onFocus={() => {
            const offer = selectionHere();
            setSelection(
              offer === null
                ? "none"
                : offer.anchor === null
                  ? "long"
                  : "words",
            );
          }}
          onBlur={() => setSelection("none")}
          onClick={(event) => {
            const offer = selectionHere();
            if (offer !== null && offer.anchor === null) {
              // Too many words for a note: said, never noted on the whole field.
              setSelection("long");
              ui.announce(`${TOO_LONG_WORDS}.`);
              return;
            }
            if (offer?.anchor != null) {
              ui.startRaise({
                anchorKind: "TEXT",
                field,
                anchor: offer.anchor,
                where: whereWords({ anchorKind: "TEXT", field }, ui.context),
                opener: event.currentTarget,
              });
              window.getSelection()?.removeAllRanges();
              setSelection("none");
              return;
            }
            ui.startRaise({
              anchorKind: "FIELD",
              field,
              anchor: null,
              where,
              opener: event.currentTarget,
            });
          }}
        />
      ) : null}
    </Wrap>
  );
}

/* The margin: markers and "Add review note" -------------------------------------------- */

type Offer = {
  field: string;
  /** Null where the words selected are more than a note can hold (`selectionTooLong`):
   * the margin says so, and notes nothing. */
  anchor: (TextAnchor & { start: number; end: number }) | null;
  /** The selection's top in the sheet's own coordinates. */
  top: number;
};

/** The selection's offset in a field's text: the characters before it, counted as the
 * text's nodes hold them. */
function offsetIn(textRoot: Element, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(textRoot);
  range.setEnd(node, offset);
  return range.toString().length;
}

const textRootOf = (node: Node): Element | null =>
  (node instanceof Element ? node : node.parentElement)?.closest(
    "[data-rn-text]",
  ) ?? null;

/** What a selection inside one field offers: its anchor and its top; null for a
 * selection across fields, outside the sheet, or of nothing but space. */
function offerOf(
  root: HTMLElement | null,
  texts: ReadonlyMap<string, string>,
): Offer | null {
  const selection = window.getSelection();
  if (
    root === null ||
    selection === null ||
    selection.rangeCount === 0 ||
    selection.isCollapsed
  ) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const start = textRootOf(range.startContainer);
  const end = textRootOf(range.endContainer);
  if (start === null || start !== end || !root.contains(start)) {
    return null;
  }
  const field =
    start.closest<HTMLElement>("[data-rn-field]")?.dataset.rnField ?? "";
  if (field === "") {
    return null;
  }
  const shown = start.textContent ?? "";
  const stored = texts.get(field);
  const text = stored === shown ? stored : shown;
  const from = offsetIn(start, range.startContainer, range.startOffset);
  const to = offsetIn(start, range.endContainer, range.endOffset);
  const anchor = anchorOf(text, from, to);
  if (anchor === null && !selectionTooLong(text, from, to)) {
    return null;
  }
  const first = range.getClientRects()[0] ?? range.getBoundingClientRect();
  return { field, anchor, top: first.top - root.getBoundingClientRect().top };
}

/** Where things sit in the margin: each marker's top, and the margin's middle, in the
 * sheet's own coordinates. */
type MarginPlan = {
  middle: number;
  markers: Array<{ note: ReviewNote; top: number }>;
};

const ICON = 28;
const MARKER = 18;
const MARKER_GAP = 4;

/** The margin's middle: the centre of the document sheet's right padding, from the
 * sheet's own box (the root it is drawn in). */
function marginMiddle(root: HTMLElement): number {
  const sheet = root.querySelector<HTMLElement>(".dw-sheet") ?? root;
  const rootBox = root.getBoundingClientRect();
  const box = sheet.getBoundingClientRect();
  const pad = Number.parseFloat(getComputedStyle(sheet).paddingRight) || 40;
  return box.right - rootBox.left - pad / 2;
}

function topIn(root: HTMLElement, element: Element): number {
  return element.getBoundingClientRect().top - root.getBoundingClientRect().top;
}

/**
 * The document's right margin (option 2, product owner, 16 November 2026): a comment icon
 * level with the field under the pointer (or with the focus, or with words selected in a
 * field), "Add review note", never over the text; and a small numbered marker level with
 * each drawn note's place, which selects its note. Drawn inside the sheet's box.
 */
export function NotesMargin() {
  const ui = useNotesUi();
  const active = ui?.active === true;
  const canRaise = ui?.set?.canRaise === true;
  const rootRef = ui?.rootRef;
  const texts = ui?.texts;
  const drawn = ui?.drawn;
  const on = ui?.on === true;
  const [hover, setHover] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [plan, setPlan] = useState<MarginPlan | null>(null);
  const [tick, setTick] = useState(0);

  // The sheet changes size (a window, a section opened): the margin is laid out again.
  useEffect(() => {
    const root = rootRef?.current;
    if (!active || root === null || root === undefined) {
      return;
    }
    const observer = new ResizeObserver(() => setTick((n) => n + 1));
    observer.observe(root);
    return () => observer.disconnect();
  }, [active, rootRef]);

  useLayoutEffect(() => {
    const root = rootRef?.current;
    if (!active || root === null || root === undefined || drawn === undefined) {
      setPlan(null);
      return;
    }
    const markers: MarginPlan["markers"] = [];
    if (on) {
      for (const note of drawn) {
        if (note.anchorKind === "WORKPAPER") {
          continue;
        }
        const place =
          (note.anchorKind === "TEXT"
            ? root.querySelector(`mark[data-rn-notes~="${note.id}"]`)
            : null) ?? root.querySelector(fieldSelector(note.field));
        if (place !== null) {
          markers.push({ note, top: topIn(root, place) + 1 });
        }
      }
    }
    markers.sort((a, b) => a.top - b.top || a.note.number - b.note.number);
    // Markers at the same height are stacked, one under the other.
    let last = Number.NEGATIVE_INFINITY;
    for (const marker of markers) {
      marker.top = Math.max(marker.top, last + MARKER + MARKER_GAP);
      last = marker.top;
    }
    const next: MarginPlan = { middle: marginMiddle(root), markers };
    setPlan((current) =>
      current !== null &&
      current.middle === next.middle &&
      current.markers.length === next.markers.length &&
      current.markers.every(
        (item, at) =>
          item.note === next.markers[at]?.note &&
          item.top === next.markers[at]?.top,
      )
        ? current
        : next,
    );
  });

  // The field under the pointer: kept while the pointer crosses the margin to the icon,
  // let go when it leaves the sheet. A touch on a field shows it too.
  useEffect(() => {
    const root = rootRef?.current;
    if (!active || !canRaise || root === null || root === undefined) {
      setHover(null);
      return;
    }
    const fieldOf = (target: EventTarget | null) =>
      target instanceof Element
        ? (target.closest<HTMLElement>("[data-rn-field]")?.dataset.rnField ??
          null)
        : null;
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch" && event.type === "pointermove") {
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest(".rn-margin")
      ) {
        return;
      }
      const field = fieldOf(event.target);
      if (field !== null) {
        setHover(field);
      }
    };
    const leave = () => setHover(null);
    const focusIn = (event: FocusEvent) => setFocused(fieldOf(event.target));
    const focusOut = (event: FocusEvent) => {
      if (fieldOf(event.relatedTarget) === null) {
        setFocused(null);
      }
    };
    root.addEventListener("pointermove", move, { passive: true });
    root.addEventListener("pointerdown", move, { passive: true });
    root.addEventListener("pointerleave", leave);
    root.addEventListener("focusin", focusIn);
    root.addEventListener("focusout", focusOut);
    return () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerdown", move);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("focusin", focusIn);
      root.removeEventListener("focusout", focusOut);
    };
  }, [active, canRaise, rootRef]);

  // Words selected in a field: the icon moves level with them.
  useEffect(() => {
    if (!active || !canRaise || rootRef === undefined || texts === undefined) {
      setOffer(null);
      return;
    }
    let frame = 0;
    const check = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() =>
        setOffer(offerOf(rootRef.current, texts)),
      );
    };
    document.addEventListener("selectionchange", check);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", check);
    };
  }, [active, canRaise, rootRef, texts]);

  const root = rootRef?.current ?? null;
  if (ui === null || !active || plan === null || root === null) {
    return null;
  }
  // The icon: by the selected words, else the focused field, else the one pointed at.
  const field = offer?.field ?? focused ?? hover;
  let iconTop: number | null = null;
  if (canRaise && field !== null) {
    if (offer !== null) {
      iconTop = offer.top - 5;
    } else {
      const box = root.querySelector(fieldSelector(field));
      iconTop = box === null ? null : topIn(root, box) - 4;
    }
  }
  // The icon stays level with what it adds a note on: a marker at that height steps
  // under it while it shows (and the ones under that marker follow).
  const markers: Array<{ note: ReviewNote; top: number }> = [];
  let below = Number.NEGATIVE_INFINITY;
  for (const marker of plan.markers) {
    let top = Math.max(marker.top, below + MARKER + MARKER_GAP);
    if (
      iconTop !== null &&
      top < iconTop + ICON + MARKER_GAP &&
      top + MARKER + MARKER_GAP > iconTop
    ) {
      top = iconTop + ICON + MARKER_GAP;
    }
    markers.push({ note: marker.note, top });
    below = top;
  }
  // Words selected that are too many for a note: the icon says so and notes nothing
  // (independent review, 16 November 2026: before, it fell back to the whole field).
  const tooLong = offer !== null && offer.anchor === null;
  const start = () => {
    if (field === null || tooLong) {
      return;
    }
    if (offer?.anchor != null) {
      ui.startRaise({
        anchorKind: "TEXT",
        field: offer.field,
        anchor: offer.anchor,
        where: whereWords(
          { anchorKind: "TEXT", field: offer.field },
          ui.context,
        ),
        opener: root.querySelector<HTMLElement>(
          `${fieldSelector(offer.field)} .rn-add`,
        ),
      });
      window.getSelection()?.removeAllRanges();
      setOffer(null);
      return;
    }
    ui.startRaise({
      anchorKind: "FIELD",
      field,
      anchor: null,
      where: whereWords({ anchorKind: "FIELD", field }, ui.context),
      opener: root.querySelector<HTMLElement>(
        `${fieldSelector(field)} .rn-add`,
      ),
    });
  };
  return (
    <div className="rn-margin" data-rn-skip="" data-tick={tick}>
      {markers.map(({ note, top }) => (
        <button
          key={note.id}
          type="button"
          className={`rn-marker${note.id === ui.selected ? " is-selected" : ""}`}
          style={{ top, left: plan.middle - MARKER / 2 }}
          aria-pressed={note.id === ui.selected}
          aria-label={`Review note ${note.number}: ${CRITICALITY_WORDS[note.criticality]}, ${STATUS_WORDS[note.status].toLowerCase()}`}
          onClick={() =>
            ui.select(note.id === ui.selected ? null : note.id, "document")
          }
        >
          {note.number}
        </button>
      ))}
      {iconTop !== null ? (
        <button
          key={offer === null ? `field-${field}` : "words"}
          type="button"
          // The keyboard has each field's own button: this one is the pointer's.
          tabIndex={-1}
          className={`rn-margin-add${focused !== null && offer === null && field === focused ? " is-focus" : ""}${tooLong ? " is-refused" : ""}`}
          style={{ top: iconTop, left: plan.middle - ICON / 2 }}
          aria-disabled={tooLong ? "true" : undefined}
          aria-label={
            tooLong
              ? TOO_LONG_WORDS
              : offer === null
                ? "Add review note"
                : "Add review note on the selected words"
          }
          // The selection stays as it is while the icon is pressed.
          onMouseDown={(event) => event.preventDefault()}
          onClick={start}
        >
          <CommentPlus />
          <span className="rn-tip" aria-hidden="true">
            {tooLong ? TOO_LONG_WORDS : "Add review note"}
          </span>
        </button>
      ) : null}
    </div>
  );
}

/** A speech bubble with a plus: "Add review note". */
function CommentPlus() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20 15.5a2 2 0 0 1-2 2H8.5L4 21V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />
      <path d="M12 7.5v6M9 10.5h6" />
    </svg>
  );
}

/* The criticality: a pill and its menu ------------------------------------------------- */

/**
 * The criticality as a small pill ("● Normal ▾"): one press opens Urgent, Normal and
 * Follow-up, each with its key (1, 2, 3). The pill shows `value`: a note's as the server
 * has it, so a change shows only once its write is confirmed; or the new note's, as
 * chosen. Escape, a press outside or the focus leaving closes the menu; the arrow keys
 * move in it (product owner, 16 November 2026: notes rail, inbox (option 3)).
 */
function CritPill({
  value,
  label,
  busy = false,
  onPick,
}: {
  value: Criticality | "OTHER";
  /** What it sets, for its accessible name: "Criticality of note 2". */
  label: string;
  busy?: boolean;
  onPick: (value: Criticality) => void;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) {
      setUp(false);
      return;
    }
    // Opens above the pill where the rail's list would cut it off below.
    const menu = root.current?.querySelector<HTMLElement>(".rn-menu");
    const box = root.current?.closest<HTMLElement>(".rn-rail-body");
    const bottom = Math.min(
      window.innerHeight,
      box?.getBoundingClientRect().bottom ?? window.innerHeight,
    );
    if (menu != null && menu.getBoundingClientRect().bottom > bottom - 4) {
      setUp(true);
    }
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    // Escape closes the menu only: caught first, so the open note stays open.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        setOpen(false);
        button.current?.focus();
      }
    };
    // The focus leaving the pill and its menu closes it.
    const away = (event: FocusEvent) => {
      if (
        event.relatedTarget instanceof Node &&
        !root.current?.contains(event.relatedTarget)
      ) {
        setOpen(false);
      }
    };
    const node = root.current;
    node?.addEventListener("focusout", away);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", onKey, true);
    (
      root.current?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      root.current?.querySelector<HTMLElement>('[role="menuitemradio"]')
    )?.focus();
    return () => {
      node?.removeEventListener("focusout", away);
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const pick = (item: Criticality) => {
    setOpen(false);
    button.current?.focus();
    if (item !== value) {
      onPick(item);
    }
  };
  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        '[role="menuitemradio"]',
      ),
    ];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : items.length - 1;
      items[(Math.max(at, 0) + step) % items.length]?.focus();
      return;
    }
    const chosen = criticalityForKey(event.key);
    if (chosen !== null) {
      event.preventDefault();
      pick(chosen);
    }
  };
  return (
    <div className={`rn-pill-wrap${open ? " is-open" : ""}`} ref={root}>
      <button
        ref={button}
        type="button"
        className={`rn-pill rn-${CRITICALITY_TONE[value]}${busy ? " is-busy" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={`${label}: ${CRITICALITY_WORDS[value]}`}
        aria-busy={busy}
        aria-disabled={busy ? "true" : undefined}
        onClick={() => {
          if (!busy) {
            setOpen((now) => !now);
          }
        }}
      >
        <span className="rn-dot" aria-hidden="true" />
        {CRITICALITY_WORDS[value]}
        <UiIcon name="chevronDown" size={12} />
      </button>
      {open ? (
        <div
          className={`rn-menu${up ? " is-up" : ""}`}
          id={`${id}-menu`}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
        >
          {CRITICALITIES.map((item, index) => (
            <button
              key={item}
              type="button"
              role="menuitemradio"
              aria-checked={item === value}
              className={`rn-menu-item rn-${CRITICALITY_TONE[item]}`}
              onClick={() => pick(item)}
            >
              <span className="rn-dot" aria-hidden="true" />
              <span className="rn-menu-word">{CRITICALITY_WORDS[item]}</span>
              <span className="rn-key" aria-hidden="true">
                {index + 1}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* The form of a new note: at the top of the rail's list ------------------------------- */

/** The new note, written in the rail (on a narrow window, a sheet at the bottom of it),
 * never over the document: its words stay in view, in the chosen criticality's colour.
 * One note box, the owner, then the criticality's pill (Normal to start), Cancel and Add
 * note. */
function RaiseForm({ target }: { target: RaiseTarget }) {
  const ui = useNotesUi();
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLFormElement>(null);
  const sendKey = useSendKey();
  const set = ui?.set ?? null;
  const members = set?.members ?? [];
  const key = raiseKey(target);
  // What was typed here before and not sent comes back (the form was replaced, closed
  // by Escape, or the view changed); Cancel and a confirmed note let it go.
  const [text, setText] = useState(() => ui?.draftFor(key) ?? "");
  const [owner, setOwner] = useState(
    set?.defaultOwnerId ?? members[0]?.id ?? "",
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const criticality = ui?.pendingCriticality ?? "NORMAL";
  const root = ui?.rootRef;

  // The form takes the focus where it opens; the rail shows it at its top; on a narrow
  // window (a sheet at the bottom) the words are brought up above it.
  useEffect(() => {
    area.current?.focus({ preventScroll: true });
    const list = box.current?.closest<HTMLElement>(".rn-rail-body");
    if (list !== null && list !== undefined) {
      list.scrollTop = 0;
    }
    if (!railBelow() || root?.current === null || root === undefined) {
      return;
    }
    const sheet = root.current;
    const place =
      (target.anchorKind === "TEXT"
        ? sheet.querySelector<HTMLElement>(`mark[data-rn-notes~="${PENDING}"]`)
        : null) ??
      (target.anchorKind === "WORKPAPER"
        ? null
        : sheet.querySelector<HTMLElement>(fieldSelector(target.field)));
    if (place !== null) {
      window.scrollTo({
        top:
          window.scrollY +
          place.getBoundingClientRect().top -
          window.innerHeight * 0.15,
        behavior: scrollBehavior(),
      });
    }
  }, [target, root]);

  const close = useCallback(() => {
    ui?.endRaise();
    const back = target.opener;
    window.requestAnimationFrame(() => {
      if (back?.isConnected) {
        back.focus({ preventScroll: true });
      }
    });
  }, [ui, target.opener]);
  /** Cancel: what was typed is let go too. Escape only closes, and keeps it. */
  const cancel = () => {
    ui?.keepDraft(key, "");
    close();
  };

  if (ui === null) {
    return null;
  }
  const submit = async () => {
    const wrong =
      noteTextProblem(text) ??
      (owner === "" ? "Choose who resolves the note." : null);
    if (wrong !== null) {
      setProblem(wrong);
      area.current?.focus();
      return;
    }
    setSending(true);
    setProblem(null);
    const result = await ui.notes.act({
      intent: "raise",
      anchorKind: target.anchorKind,
      field: target.field,
      anchor: target.anchor,
      workpaperVersion: ui.workpaperVersion,
      text: text.trim(),
      criticality,
      ownerId: owner,
    });
    setSending(false);
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    ui.announce(doneWords("raise", result.note.number));
    ui.keepDraft(key, "");
    ui.endRaise();
    ui.select(result.note.id, "document");
    // The form that had the focus is gone: the new note's card takes it once drawn, or,
    // where the rail does not show it, what opened the form (independent review, 16
    // November 2026: before, the focus fell to the page).
    focusCard(result.note.id, target.opener);
  };
  const onKey = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      close();
    } else if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      !sending
    ) {
      event.preventDefault();
      submit().catch(() => undefined);
    }
  };
  const on =
    target.anchorKind === "TEXT"
      ? "the highlighted words"
      : target.anchorKind === "FIELD"
        ? "the field"
        : "";
  return (
    <form
      ref={box}
      autoComplete="off"
      className={`rn-new rn-${CRITICALITY_TONE[criticality]}`}
      aria-labelledby={`${id}-head`}
      aria-describedby={`${id}-where`}
      onKeyDown={onKey}
      onSubmit={(event) => {
        event.preventDefault();
        submit().catch(() => undefined);
      }}
    >
      <h3 id={`${id}-head`} className="rn-new-head">
        New review note
      </h3>
      <p id={`${id}-where`} className="rn-card-line">
        {target.where}
        {on === "" ? "" : ` · ${on}`}
      </p>
      <label className="sr-only" htmlFor={`${id}-text`}>
        Note
      </label>
      <textarea
        id={`${id}-text`}
        ref={area}
        className="rn-input"
        rows={3}
        value={text}
        maxLength={4000}
        disabled={sending}
        aria-invalid={problem !== null && noteTextProblem(text) !== null}
        onChange={(event) => {
          setText(event.target.value);
          ui.keepDraft(key, event.target.value);
        }}
        placeholder="What should change, or what is unclear?"
      />
      <div className="rn-new-row">
        <label className="rn-new-owner" htmlFor={`${id}-owner`}>
          Owner
        </label>
        <select
          id={`${id}-owner`}
          className="rn-select"
          value={owner}
          disabled={sending || members.length === 0}
          onChange={(event) => setOwner(event.target.value)}
        >
          {members.length === 0 ? (
            <option value="">Nobody on the engagement yet</option>
          ) : null}
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {memberWords(member)}
            </option>
          ))}
        </select>
      </div>
      {problem !== null ? (
        <p className="rn-problem" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="rn-compose-row">
        <CritPill
          value={criticality}
          label="Criticality"
          busy={sending}
          onPick={ui.setPendingCriticality}
        />
        <span className="rn-act-gap" />
        <button
          type="button"
          className="rn-btn is-quiet"
          onClick={cancel}
          disabled={sending}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="rn-btn is-primary"
          title={`Add note (${sendKey} ↵)`}
          disabled={sending}
        >
          {sending ? "Adding…" : "Add note"}
        </button>
      </div>
    </form>
  );
}

function SendHint({ shown, sendKey }: { shown: boolean; sendKey: string }) {
  return (
    <span className={`rn-hint${shown ? " is-shown" : ""}`} aria-hidden="true">
      <kbd>{sendKey}</kbd>
      <kbd>↵</kbd> to send
    </span>
  );
}

/* A note: its line, and opened, the note ---------------------------------------------- */

/** The agent's help with a note (docs/workpaper-review.md, section 7) goes here, in a
 * later increment. Nothing is drawn yet. */
function AgentHelpSlot(_props: { note: ReviewNote }) {
  return null;
}

/** The replies under the note: only the words people wrote (threadEvents), a thin ruled
 * thread, each with its author, its time and what it was. */
function Thread({ note }: { note: ReviewNote }) {
  const events = threadEvents(note);
  if (events.length === 0) {
    return null;
  }
  return (
    <ol className="rn-thread" aria-label={`Replies to note ${note.number}`}>
      {events.map((event) => {
        const tag = threadTag(event);
        return (
          <li key={event.id} className="rn-reply">
            <p className="rn-reply-head">
              <b>{event.by.name}</b>
              <time dateTime={event.at} title={whenWords(event.at)}>
                {timeLabel(event.at)}
              </time>
              {tag !== "" ? <span>· {tag}</span> : null}
            </p>
            <p className="rn-reply-text">{event.text}</p>
          </li>
        );
      })}
    </ol>
  );
}

/** The note's whole history, on request from its "···" (docs/workpaper-review.md,
 * section 2): every event, the criticality's and the owner's changes and who cleared or
 * dismissed it included, as the server keeps them. */
function History({ note }: { note: ReviewNote }) {
  const rows = historyOf(note);
  if (rows.length === 0) {
    return null;
  }
  return (
    <section
      className="rn-history"
      aria-label={`History of note ${note.number}`}
    >
      <p className="rn-history-head">History</p>
      <ol>
        {rows.map((row) => (
          <li key={row.id}>
            <span>{row.words}</span>{" "}
            <time dateTime={row.at}>{whenWords(row.at)}</time>
            {row.text !== "" ? (
              <span className="rn-history-text">{row.text}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** What the note is about, under its card in All notes: the passage around its words as
 * the field reads now, the field's text, or the workpaper. */
function Passage({ ui, note }: { ui: NotesUi; note: ReviewNote }) {
  if (note.anchorKind === "WORKPAPER") {
    return <p className="rn-passage is-quiet">On the workpaper as a whole.</p>;
  }
  // On the removed "Matters for the reviewer" (docs/design-workpaper.md, section 3.9):
  // its kept words, and no marker on the page.
  if (isRetiredField(note.field)) {
    return (
      <p className="rn-passage is-quiet">
        {RETIRED_FIELD}.
        {note.quote !== "" ? (
          <>
            {" "}
            As raised: <q className="rn-quote">{note.quote}</q>
          </>
        ) : null}
      </p>
    );
  }
  if (note.anchorKind === "FIELD") {
    const text = ui.texts.get(note.field) ?? "";
    return (
      <p className="rn-passage">
        {text === "" ? (
          <span className="rn-quiet">On the field.</span>
        ) : (
          `${text.slice(0, 240)}${text.length > 240 ? "…" : ""}`
        )}
      </p>
    );
  }
  const passage = passageOf(note, ui.texts);
  if (passage === null) {
    return (
      <div className="rn-passage is-gone">
        <p className="rn-gone">{GONE_WORDS}.</p>
        <p>
          As raised: <q className="rn-quote">{note.quote}</q>
        </p>
      </div>
    );
  }
  return (
    <p className="rn-passage">
      {passage.before}
      <mark className={`rn-hl rn-${CRITICALITY_TONE[note.criticality]}`}>
        {passage.words}
      </mark>
      {passage.after}
    </p>
  );
}

type Composer = "reply" | "reopen" | "dismiss" | "owner";

/** The open note's "···": what its action row does not already offer, as `can` allows,
 * and its whole history. */
function NoteMenu({
  note,
  history,
  onHistory,
  onCompose,
}: {
  note: ReviewNote;
  history: boolean;
  onHistory: () => void;
  onCompose: (composer: Composer) => void;
}) {
  const { can } = note;
  const items: RowMenuItem[] = [];
  if (can.owner) {
    items.push({
      label: "Change owner…",
      icon: "user",
      onSelect: () => onCompose("owner"),
    });
  }
  if (can.dismiss) {
    items.push({
      label: "Dismiss…",
      icon: "xCircle",
      onSelect: () => onCompose("dismiss"),
    });
  }
  if (can.reopen) {
    items.push({
      label: "Reopen…",
      icon: "retry",
      onSelect: () => onCompose("reopen"),
    });
  }
  items.push({
    label: history ? "Hide history" : "History",
    icon: "clock",
    onSelect: onHistory,
  });
  return <RowMenu label={`note ${note.number}`} items={items} />;
}

/**
 * A note in the rail: one line (its criticality's dot, its first words, how many replies,
 * its time; a resolved one faint, with ✓). Selected, it opens in place under its line,
 * one at a time; Escape closes it and gives its line the focus. In All notes' pane the
 * same note, always open, so the two look the same (product owner, 16 November 2026:
 * notes rail, inbox (option 3)).
 */
function NoteCard({
  ui,
  note,
  place,
}: {
  ui: NotesUi;
  note: ReviewNote;
  place: "rail" | "panel";
}) {
  const selected = place === "panel" || ui.selected === note.id;
  const Tag = place === "rail" ? "li" : "div";
  return (
    <Tag
      className={`rn-item rn-${CRITICALITY_TONE[note.criticality]}${selected ? " is-open" : ""}${isClosed(note) ? " is-closed" : ""}${place === "panel" ? " is-panel" : ""}`}
      data-rn-card={note.id}
      onKeyDown={(event) => {
        if (place === "rail") {
          moveInList(event);
        }
        if (
          event.key !== "Escape" ||
          event.defaultPrevented ||
          place !== "rail" ||
          !selected
        ) {
          return;
        }
        event.preventDefault();
        const line =
          event.currentTarget.querySelector<HTMLElement>(".rn-card-pick");
        ui.select(null, "rail");
        line?.focus({ preventScroll: true });
        // A note listed only while it was selected (just resolved) leaves the list: the
        // focus goes to the first line there is.
        window.requestAnimationFrame(() => {
          if (line !== null && !line.isConnected) {
            document
              .querySelector<HTMLElement>(".rn-rail .rn-card-pick")
              ?.focus({ preventScroll: true });
          }
        });
      }}
    >
      <NoteBody ui={ui} note={note} place={place} selected={selected} />
    </Tag>
  );
}

/** The note's line, and, opened, the note and what may be done from it. */
function NoteBody({
  ui,
  note,
  place,
  selected,
}: {
  ui: NotesUi;
  note: ReviewNote;
  place: "rail" | "panel";
  selected: boolean;
}) {
  const id = useId();
  const sendKey = useSendKey();
  const [composer, setComposer] = useState<Composer>("reply");
  const [history, setHistory] = useState(false);
  const [text, setText] = useState("");
  const [owner, setOwner] = useState(note.owner.id);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState<NoteIntent | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const ownerBox = useRef<HTMLSelectElement>(null);
  const answer = replyMode(note);
  // A composer the note's state no longer takes goes back to the reply box (a dismissal
  // on a note just cleared).
  const shown: Composer =
    composer === "reply" || note.can[composer] ? composer : "reply";
  const where = whereWords(note, ui.context);
  const gone = wordsGone(note, ui.texts);
  const closed = isClosed(note);
  const replies = replyCount(note);

  // A note closed again shows its line only: its history and a composer it had open go
  // (a reply typed and not sent stays, for when it is opened again).
  useEffect(() => {
    if (!selected) {
      setHistory(false);
      setComposer("reply");
      setProblem(null);
    }
  }, [selected]);

  // The reply box grows with what is typed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again for each text.
  useLayoutEffect(() => {
    const node = area.current;
    if (node !== null) {
      node.style.height = "auto";
      node.style.height = `${node.scrollHeight + 2}px`;
    }
  }, [text, shown, selected]);

  const run = async (action: NoteAction): Promise<ReviewNote | null> => {
    setSending(action.intent);
    setProblem(null);
    const result = await ui.notes.act(action);
    setSending(null);
    if (!result.ok) {
      setProblem(result.problem);
      return null;
    }
    ui.announce(doneWords(action.intent, note.number));
    if (action.intent === "clear" || action.intent === "dismiss") {
      // Resolve and Dismiss go with the note's open state, and the focus with them: the
      // note stays in the rail, selected (it is listed while selected), and its card
      // takes the focus (independent review, 16 November 2026).
      if (place === "rail" && !selected) {
        ui.select(note.id, "rail");
      }
      focusCard(note.id);
    }
    return result.note;
  };

  const pickCriticality = (value: Criticality) => {
    if (sending !== null || value === note.criticality) {
      return;
    }
    run({
      intent: "criticality",
      noteId: note.id,
      version: note.version,
      criticality: value,
    }).catch(() => undefined);
  };
  // Keys 1, 2, 3 set the selected note's criticality (not while typing).
  const pickRef = useRef(pickCriticality);
  pickRef.current = pickCriticality;
  useEffect(() => {
    if (!selected || !note.can.criticality) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        typingIn(event.target)
      ) {
        return;
      }
      const value = criticalityForKey(event.key);
      if (value !== null) {
        event.preventDefault();
        pickRef.current(value);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, note.can.criticality]);

  const compose = (next: Composer) => {
    setComposer(next);
    setProblem(null);
    setText("");
    setOwner(note.owner.id);
    window.requestAnimationFrame(() =>
      next === "owner" ? ownerBox.current?.focus() : area.current?.focus(),
    );
  };
  const back = () => {
    setComposer("reply");
    setProblem(null);
    setText("");
  };

  /** The reply (the response, where the note is the person's to answer). */
  const reply = async (): Promise<ReviewNote | null> => {
    const wrong = replyProblem(text);
    if (answer === null || wrong !== null) {
      setProblem(wrong ?? "You cannot reply to this note.");
      area.current?.focus();
      return null;
    }
    const done = await run({
      intent: "reply",
      noteId: note.id,
      version: note.version,
      text: text.trim(),
      responds: answer === "respond",
    });
    if (done !== null) {
      setText("");
    }
    return done;
  };
  /** Resolve: the typed reply first, then the clearing, each confirmed; it stops at the
   * first refusal and says it. */
  const resolve = async () => {
    let version = note.version;
    if (text.trim() !== "" && answer !== null) {
      const replied = await reply();
      if (replied === null) {
        return;
      }
      version = replied.version;
    }
    await run({ intent: "clear", noteId: note.id, version });
  };
  const send = () => {
    if (sending !== null) {
      return;
    }
    if (shown === "reply") {
      reply().catch(() => undefined);
      return;
    }
    if (shown === "owner") {
      if (owner === note.owner.id) {
        setProblem("That person is already the note's resolution owner.");
        return;
      }
      run({
        intent: "owner",
        noteId: note.id,
        version: note.version,
        ownerId: owner,
      })
        .then((done) => (done === null ? undefined : back()))
        .catch(() => undefined);
      return;
    }
    const wrong =
      shown === "dismiss" ? reasonProblem(text) : replyProblem(text);
    if (wrong !== null) {
      setProblem(wrong);
      area.current?.focus();
      return;
    }
    const words = text.trim();
    run(
      shown === "dismiss"
        ? {
            intent: "dismiss",
            noteId: note.id,
            version: note.version,
            reason: words,
          }
        : {
            intent: "reopen",
            noteId: note.id,
            version: note.version,
            text: words,
          },
    )
      .then((done) => (done === null ? undefined : back()))
      .catch(() => undefined);
  };
  const onKey = (event: ReactKeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    } else if (event.key === "Escape" && shown !== "reply") {
      event.preventDefault();
      back();
    }
  };

  const busy = sending !== null;
  const typed = text.trim() !== "";
  const label =
    shown === "dismiss"
      ? `Why note ${note.number} is dismissed`
      : shown === "reopen"
        ? `Why note ${note.number} is reopened`
        : answer === "respond"
          ? `Respond to note ${note.number}`
          : `Reply to note ${note.number}`;
  const hasRow = note.can.criticality || answer !== null || note.can.clear;
  return (
    <>
      <div className="rn-item-head">
        <button
          type="button"
          className="rn-card-pick"
          aria-expanded={place === "rail" ? selected : undefined}
          aria-label={`Note ${note.number} by ${note.raisedBy.name}: ${CRITICALITY_WORDS[note.criticality]}, ${STATUS_WORDS[note.status].toLowerCase()}, on ${where}, owner ${note.owner.name}${replies > 0 ? `, ${replies} ${replies === 1 ? "reply" : "replies"}` : ""}`}
          onClick={() =>
            place === "rail"
              ? ui.select(selected ? null : note.id, "rail")
              : ui.select(note.id, "table")
          }
        >
          {closed ? (
            <span className="rn-check" aria-hidden="true">
              ✓
            </span>
          ) : (
            <span className="rn-dot" aria-hidden="true" />
          )}
          <span className="rn-line-words">
            {selected ? headLine(note.text) : firstWords(note.text, 90)}
          </span>
          {!selected && replies > 0 ? (
            <span className="rn-count" aria-hidden="true">
              {replies}
            </span>
          ) : null}
          {closed && !selected ? (
            <span className="rn-line-tag">{closedWord(note)}</span>
          ) : (
            <time dateTime={note.raisedAt} title={whenWords(note.raisedAt)}>
              {timeLabel(note.raisedAt)}
            </time>
          )}
        </button>
        {selected && !busy ? (
          <NoteMenu
            note={note}
            history={history}
            onHistory={() => setHistory((now) => !now)}
            onCompose={compose}
          />
        ) : null}
      </div>
      {selected ? (
        <div className="rn-item-body">
          <p className="rn-card-line">{whereLine(note, ui.context)}</p>
          {isClosed(note) && closedLine(note) !== "" ? (
            // Who closed it and when: the evidence of review, on the card (section 2).
            <p className="rn-card-line rn-closed-line">{closedLine(note)}</p>
          ) : null}
          {gone ? <p className="rn-gone">{GONE_WORDS}.</p> : null}
          <p className="rn-text-body">{note.text}</p>
          <Thread note={note} />
          {history ? <History note={note} /> : null}
          <AgentHelpSlot note={note} />
          {problem !== null ? (
            <p className="rn-problem" role="alert">
              {problem}
            </p>
          ) : null}
          {shown !== "reply" ? (
            <form
              autoComplete="off"
              className="rn-compose"
              onKeyDown={onKey}
              onSubmit={(event) => {
                event.preventDefault();
                send();
              }}
            >
              {shown === "owner" ? (
                <div className="rn-owner">
                  <label htmlFor={`${id}-owner`}>New owner</label>
                  <select
                    id={`${id}-owner`}
                    ref={ownerBox}
                    className="rn-select"
                    value={owner}
                    disabled={busy}
                    onChange={(event) => setOwner(event.target.value)}
                  >
                    {(ui.set?.members ?? []).map((member) => (
                      <option key={member.id} value={member.id}>
                        {memberWords(member)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <label className="sr-only" htmlFor={`${id}-box`}>
                    {label}
                  </label>
                  <textarea
                    id={`${id}-box`}
                    ref={area}
                    className="rn-input rn-reply-box"
                    rows={2}
                    value={text}
                    maxLength={4000}
                    disabled={busy}
                    placeholder={
                      shown === "dismiss"
                        ? "Why it is dismissed…"
                        : "Why it is reopened…"
                    }
                    onChange={(event) => setText(event.target.value)}
                  />
                </>
              )}
              <div className="rn-compose-row">
                <SendHint
                  shown={typed && shown !== "owner"}
                  sendKey={sendKey}
                />
                <button
                  type="button"
                  className="rn-btn is-quiet"
                  disabled={busy}
                  onClick={back}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rn-btn is-primary"
                  disabled={busy}
                >
                  {busy
                    ? "Saving…"
                    : shown === "dismiss"
                      ? "Dismiss"
                      : shown === "reopen"
                        ? "Reopen"
                        : "Change owner"}
                </button>
              </div>
            </form>
          ) : hasRow ? (
            // One row: the criticality's pill, the reply box with its send arrow, and
            // Resolve as a quiet check.
            <form
              autoComplete="off"
              className="rn-compose rn-act"
              onKeyDown={onKey}
              onSubmit={(event) => {
                event.preventDefault();
                send();
              }}
            >
              {note.can.criticality ? (
                <CritPill
                  value={note.criticality}
                  label={`Criticality of note ${note.number}`}
                  busy={sending === "criticality"}
                  onPick={pickCriticality}
                />
              ) : null}
              {answer !== null ? (
                <div className="rn-reply-wrap">
                  <label className="sr-only" htmlFor={`${id}-box`}>
                    {label}
                  </label>
                  <textarea
                    id={`${id}-box`}
                    ref={area}
                    className="rn-input rn-reply-box"
                    rows={1}
                    value={text}
                    maxLength={4000}
                    disabled={busy}
                    placeholder={answer === "respond" ? "Respond…" : "Reply…"}
                    onChange={(event) => setText(event.target.value)}
                  />
                  <button
                    type="submit"
                    className={`rn-send${typed ? " is-ready" : ""}`}
                    aria-label={
                      answer === "respond"
                        ? "Send the response"
                        : "Send the reply"
                    }
                    title={`Send (${sendKey} ↵)`}
                    disabled={busy}
                  >
                    <UiIcon name="arrowUp" size={14} />
                  </button>
                </div>
              ) : (
                <span className="rn-act-gap" />
              )}
              {note.can.clear ? (
                <button
                  type="button"
                  className={`rn-icon-btn rn-resolve${sending === "clear" ? " is-busy" : ""}`}
                  aria-label={typed ? "Send the reply and resolve" : "Resolve"}
                  title={typed ? "Send the reply and resolve" : "Resolve"}
                  aria-busy={sending === "clear"}
                  disabled={busy}
                  onClick={() => {
                    resolve().catch(() => undefined);
                  }}
                >
                  <UiIcon name="check" size={16} />
                </button>
              ) : null}
            </form>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function CritWord({ criticality }: { criticality: ReviewNote["criticality"] }) {
  return (
    <span className={`rn-crit rn-${CRITICALITY_TONE[criticality]}`}>
      <span className="rn-dot" aria-hidden="true" />
      {CRITICALITY_WORDS[criticality]}
    </span>
  );
}

/* The rail ----------------------------------------------------------------------------- */

/** The section in view: that of the last field of the sheet whose top is above a third
 * of the window (the first field where none is). */
function sectionInView(
  root: HTMLElement | null,
  context: FieldContext,
): number | null {
  if (root === null) {
    return null;
  }
  let found: number | null = null;
  let first: number | null = null;
  for (const node of root.querySelectorAll<HTMLElement>("[data-rn-field]")) {
    const n = sectionOf(
      {
        anchorKind: "FIELD",
        field: node.dataset.rnField ?? "",
      },
      context,
    );
    if (n === null) {
      continue;
    }
    first ??= n;
    if (node.getBoundingClientRect().top <= window.innerHeight / 3) {
      found = n;
    }
  }
  return found ?? first;
}

/** The rail's filter menu: Urgent only, Mine, This section, and an owner. */
function RailFilter({ ui }: { ui: NotesUi }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", onKey, true);
    root.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const view = ui.railView;
  const viewer = ui.set?.viewerId ?? null;
  const owners = [
    ...new Map(ui.ordered.map((note) => [note.owner.id, note.owner.name])),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const change = (next: Partial<RailView>) => {
    if (next.section === true) {
      ui.setSection(sectionInView(ui.rootRef.current, ui.context));
    }
    ui.setRailView((current) => ({ ...current, ...next }));
  };
  const on = railFiltered(view);
  return (
    <div className={`rn-filter-wrap${open ? " is-open" : ""}`} ref={root}>
      <button
        ref={button}
        type="button"
        className={`rn-icon-btn${on ? " is-set" : ""}`}
        aria-expanded={open}
        aria-controls={open ? `${id}-pop` : undefined}
        aria-label={on ? "Filter the notes (filters on)" : "Filter the notes"}
        title="Filter"
        onClick={() => setOpen((now) => !now)}
      >
        <UiIcon name="filter" size={15} />
      </button>
      {open ? (
        <fieldset className="rn-pop" id={`${id}-pop`}>
          <legend className="sr-only">Filter the notes</legend>
          <label className="rn-pop-item">
            <input
              type="checkbox"
              checked={view.urgent}
              onChange={(event) => change({ urgent: event.target.checked })}
            />
            <span>Urgent only</span>
          </label>
          {viewer !== null && view.tab !== "mine" ? (
            <label className="rn-pop-item">
              <input
                type="checkbox"
                checked={view.mine}
                onChange={(event) => change({ mine: event.target.checked })}
              />
              <span>Mine</span>
            </label>
          ) : null}
          <label className="rn-pop-item">
            <input
              type="checkbox"
              checked={view.section}
              onChange={(event) => change({ section: event.target.checked })}
            />
            <span>This section</span>
          </label>
          <label className="rn-pop-owner">
            <span>Owner</span>
            <select
              className="rn-select"
              value={view.owner ?? ""}
              onChange={(event) =>
                change({
                  owner: event.target.value === "" ? null : event.target.value,
                })
              }
            >
              <option value="">Anyone</option>
              {owners.map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {on ? (
            <button
              type="button"
              className="rn-pop-clear"
              onClick={() =>
                change({
                  urgent: false,
                  mine: false,
                  section: false,
                  owner: null,
                })
              }
            >
              Clear filters
            </button>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}

/** The rail's header: its title, the search (an icon that opens a one-line box in its
 * place) and the filter menu; under it, one switch, Open · Mine · Resolved, each with its
 * count; and, where a filter is on, a quiet line that says which, with Clear. */
function RailHead({ ui }: { ui: NotesUi }) {
  const viewer = ui.set?.viewerId ?? null;
  const [searching, setSearching] = useState(ui.railView.search !== "");
  const [typed, setTyped] = useState(ui.railView.search);
  const opener = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const { setRailView } = ui;
  useEffect(() => {
    const wait = window.setTimeout(
      () =>
        setRailView((current) =>
          current.search === typed ? current : { ...current, search: typed },
        ),
      SEARCH_WAIT_MS,
    );
    return () => window.clearTimeout(wait);
  }, [typed, setRailView]);
  useEffect(() => {
    if (searching) {
      box.current?.focus();
    }
  }, [searching]);
  const closeSearch = () => {
    setTyped("");
    setRailView((current) => ({ ...current, search: "" }));
    setSearching(false);
    window.requestAnimationFrame(() => opener.current?.focus());
  };
  const view = ui.railView;
  const said = [
    view.urgent ? "Urgent" : "",
    view.mine ? "Mine" : "",
    view.section
      ? (SECTIONS.find((item) => item.n === ui.section)?.name ?? "This section")
      : "",
    view.owner === null
      ? ""
      : `Owner ${ui.ordered.find((note) => note.owner.id === view.owner)?.owner.name ?? ""}`.trim(),
  ].filter((part) => part !== "");
  return (
    <div className="rn-rail-head">
      <div className="rn-head-row">
        {searching ? (
          <>
            <label className="rn-rail-search">
              <span className="sr-only">Search the notes and replies</span>
              <UiIcon name="search" size={14} />
              <input
                ref={box}
                type="search"
                value={typed}
                placeholder="Search notes"
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeSearch();
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="rn-icon-btn"
              aria-label="Close the search"
              title="Close"
              onClick={closeSearch}
            >
              <UiIcon name="x" size={14} />
            </button>
          </>
        ) : (
          <>
            <h2 className="rn-rail-title">Review notes</h2>
            <button
              ref={opener}
              type="button"
              className="rn-icon-btn"
              aria-label="Search the notes"
              title="Search"
              onClick={() => setSearching(true)}
            >
              <UiIcon name="search" size={15} />
            </button>
          </>
        )}
        <RailFilter ui={ui} />
      </div>
      <fieldset className="rn-tabs">
        <legend className="sr-only">Show notes</legend>
        {RAIL_TABS.filter((tab) => tab.key !== "mine" || viewer !== null).map(
          (tab) => (
            <button
              key={tab.key}
              type="button"
              className="rn-tab"
              aria-pressed={ui.railView.tab === tab.key}
              onClick={() => {
                // A note open in the other tab is closed: the new tab lists its own.
                if (
                  ui.selected !== null &&
                  !railNotes(
                    ui.ordered,
                    { ...view, tab: tab.key },
                    viewer,
                    ui.section,
                    ui.context,
                  ).some((note) => note.id === ui.selected)
                ) {
                  ui.select(null, "rail");
                }
                setRailView((current) => ({ ...current, tab: tab.key }));
              }}
            >
              {tab.label}
              <span className="rn-tab-count">
                {tabCount(
                  ui.ordered,
                  view,
                  tab.key,
                  viewer,
                  ui.section,
                  ui.context,
                )}
              </span>
            </button>
          ),
        )}
      </fieldset>
      {said.length > 0 ? (
        <p className="rn-filter-line">
          <span>{said.join(" · ")}</span>
          <button
            type="button"
            className="rn-link"
            onClick={() =>
              setRailView((current) => ({
                ...current,
                urgent: false,
                mine: false,
                section: false,
                owner: null,
              }))
            }
          >
            Clear
          </button>
        </p>
      ) : null}
    </div>
  );
}

/** Arrow keys between the notes' lines (Home and End to the first and the last). */
function moveInList(event: ReactKeyboardEvent<HTMLElement>) {
  const target = event.target;
  if (
    !(target instanceof HTMLElement) ||
    !target.classList.contains("rn-card-pick") ||
    !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
  ) {
    return;
  }
  const lines = [
    ...(target
      .closest(".rn-groups")
      ?.querySelectorAll<HTMLElement>(".rn-card-pick") ?? []),
  ];
  const at = lines.indexOf(target);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? lines.length - 1
        : Math.min(
            lines.length - 1,
            Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)),
          );
  event.preventDefault();
  lines[next]?.focus();
}

/** The rail's notes: grouped Urgent, Normal, Follow-up (only the groups that have notes
 * under the switch and the filters), each note one line; under Resolved, one list of
 * faint lines. */
function RailList({ ui }: { ui: NotesUi }) {
  const id = useId();
  const view = ui.railView;
  if (ui.listed.length === 0) {
    return (
      <p className="rn-empty">
        {ui.ordered.length === 0
          ? ui.set?.canRaise
            ? "No review note yet. Point at a field and press the note icon in the margin, or select words in it."
            : "No review note on this workpaper."
          : railFiltered(view) || view.search.trim() !== ""
            ? "No note matches these filters."
            : view.tab === "resolved"
              ? "No resolved note yet."
              : view.tab === "mine"
                ? "No open note is yours."
                : "No open note. Every note is resolved."}
      </p>
    );
  }
  const card = (note: ReviewNote) => (
    <NoteCard key={note.id} ui={ui} note={note} place="rail" />
  );
  return (
    <div className="rn-groups">
      {view.tab === "resolved" ? (
        <ol className="rn-list" aria-label="Resolved notes">
          {ui.listed.map(card)}
        </ol>
      ) : (
        groupsOf(ui.listed).map((group) => (
          <section
            key={group.key}
            className="rn-group"
            aria-labelledby={`${id}-${group.key}`}
          >
            <h3 className="rn-group-label" id={`${id}-${group.key}`}>
              {group.label}
            </h3>
            <ol className="rn-list">{group.notes.map(card)}</ol>
          </section>
        ))
      )}
    </div>
  );
}

/** The rail beside the Document view (section 6; product owner, 16 November 2026: notes
 * rail, inbox (option 3)): its header (search, filter, the switch), then a new note's
 * form where one is being written, the notes as one-line rows grouped by criticality,
 * the selected one open in place, and a note on the whole workpaper. */
export function NotesRail({ id }: { id?: string }) {
  const ui = useNotesUi();
  const sectionOn = ui?.railView.section === true;
  const setSection = ui?.setSection;
  const root = ui?.rootRef;
  const context = ui?.context ?? NO_CONTEXT;
  // "This section" follows the section in view while it is on.
  useEffect(() => {
    if (!sectionOn || setSection === undefined || root === undefined) {
      return;
    }
    let frame = 0;
    const follow = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() =>
        setSection(sectionInView(root.current, context)),
      );
    };
    follow();
    window.addEventListener("scroll", follow, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", follow);
    };
  }, [sectionOn, setSection, root, context]);
  if (ui === null) {
    return null;
  }
  const { notes, set } = ui;
  return (
    <aside
      className="rn-rail"
      id={id}
      aria-label="Review notes"
      data-rn-rail=""
    >
      {notes.status === "loading" ? (
        <p className="rn-quiet rn-rail-wait" aria-busy="true">
          Reading the review notes…
        </p>
      ) : notes.status === "failed" || set === null ? (
        <div className="rn-failed">
          <p role="alert">
            {notes.problem ?? "The review notes could not be read."}
          </p>
          <button type="button" className="rn-btn" onClick={notes.reread}>
            Read them again
          </button>
        </div>
      ) : (
        <>
          <RailHead ui={ui} />
          <div className="rn-rail-body">
            {ui.raising !== null ? (
              <RaiseForm key={raiseKey(ui.raising)} target={ui.raising} />
            ) : null}
            <RailList ui={ui} />
            {set.canRaise ? (
              <button
                type="button"
                className="rn-whole"
                onClick={(event) =>
                  ui.startRaise({
                    anchorKind: "WORKPAPER",
                    field: "",
                    anchor: null,
                    where: "The workpaper as a whole",
                    opener: event.currentTarget,
                  })
                }
              >
                <UiIcon name="plus" size={13} />
                Note on the whole workpaper
              </button>
            ) : null}
          </div>
        </>
      )}
    </aside>
  );
}

/**
 * The review notes folded, in focus mode (product owner, 16 November 2026: focus mode,
 * option A): a slim strip at the panel's right edge, with the notes icon, the open count
 * and one dot per open note by its criticality. Its button opens the rail (NotesRail, as
 * it is) as a column beside the document, and folds it again.
 */
export function NotesStrip({
  open,
  onToggle,
  railId,
}: {
  open: boolean;
  onToggle: () => void;
  railId: string;
}) {
  const ui = useNotesUi();
  if (ui === null) {
    return null;
  }
  // While the notes are read, or where the read failed, the button is still there: the
  // rail it opens says so, with "Read them again".
  const strip = notesStripOf(ui.set?.notes ?? []);
  return (
    <div className={`rn-strip${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="rn-strip-btn"
        aria-expanded={open}
        aria-controls={open ? railId : undefined}
        aria-label={`${open ? "Fold" : "Open"} the ${strip.label.charAt(0).toLowerCase()}${strip.label.slice(1)}`}
        title={open ? "Fold the review notes" : "Open the review notes"}
        onClick={onToggle}
      >
        <UiIcon name="message" size={16} />
        {strip.open > 0 ? (
          <span className="rn-strip-count" aria-hidden="true">
            {strip.open}
          </span>
        ) : null}
      </button>
      {strip.dots.length > 0 ? (
        <span className="rn-strip-dots" aria-hidden="true">
          {strip.dots.map((tone, index) => (
            <span
              // The dots are drawn in order and never reordered by themselves.
              // biome-ignore lint/suspicious/noArrayIndexKey: a dot has no identity of its own
              key={index}
              className={`rn-dot rn-${tone}`}
            />
          ))}
          {strip.more > 0 ? (
            <span className="rn-strip-more">+{strip.more}</span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/* All notes ---------------------------------------------------------------------------- */

type Choice = { value: string; label: string };

/** A filter of All notes: a chip that opens its choices, each with its count. Several
 * may be chosen where `multi`; otherwise one, or anyone. */
function FilterMenu({
  label,
  choices,
  chosen,
  counts,
  multi,
  onChange,
}: {
  label: string;
  choices: readonly Choice[];
  chosen: readonly string[];
  counts: ReadonlyMap<string, number>;
  multi: boolean;
  onChange: (chosen: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", onKey, true);
    root.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const names = choices
    .filter((item) => chosen.includes(item.value))
    .map((item) => item.label);
  return (
    <div className={`rn-filter${open ? " is-open" : ""}`} ref={root}>
      <button
        ref={button}
        type="button"
        className={`rn-chip${names.length > 0 ? " is-set" : ""}`}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => setOpen((value) => !value)}
      >
        {names.length > 0 ? `${label}: ${names.join(", ")}` : label}
        <UiIcon name="chevronDown" size={12} />
      </button>
      {open ? (
        <fieldset className="rn-filter-list" id={`${id}-list`}>
          <legend className="sr-only">{label}</legend>
          {multi ? null : (
            <label>
              <input
                type="radio"
                name={`${id}-one`}
                checked={chosen.length === 0}
                onChange={() => onChange([])}
              />
              <span>Anyone</span>
            </label>
          )}
          {choices.map((item) => (
            <label key={item.value}>
              <input
                type={multi ? "checkbox" : "radio"}
                name={`${id}-one`}
                checked={chosen.includes(item.value)}
                onChange={(event) =>
                  onChange(
                    multi
                      ? event.target.checked
                        ? [...chosen, item.value]
                        : chosen.filter((value) => value !== item.value)
                      : [item.value],
                  )
                }
              />
              <span>{item.label}</span>
              <span className="rn-filter-count">
                {counts.get(item.value) ?? 0}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}

function readFilters(workpaperId: string): NoteFilters {
  try {
    const raw = window.sessionStorage.getItem(filtersKey(workpaperId));
    return (
      (raw === null ? null : parseFilters(JSON.parse(raw))) ?? STARTING_FILTERS
    );
  } catch {
    return STARTING_FILTERS;
  }
}

function keepFilters(workpaperId: string, filters: NoteFilters): void {
  try {
    window.sessionStorage.setItem(
      filtersKey(workpaperId),
      JSON.stringify(filters),
    );
  } catch {
    // Not kept: the filters still apply on this page.
  }
}

const SEARCH_WAIT_MS = 150;

/** All notes (section 6): search and filters with their counts, the table of notes, and
 * the selected note beside it as its card (its thread, a reply box and its actions), with
 * its passage under it. The filters are kept in the browser for the session, not in the
 * address. */
export function AllNotesView({
  workpaperId,
  onOpenAt,
}: {
  workpaperId: string;
  /** "Open the workpaper at this passage": the Document view, the rail, the note. */
  onOpenAt: (noteId: string) => void;
}) {
  const ui = useNotesUi();
  const [filters, setFilters] = useState<NoteFilters>(STARTING_FILTERS);
  const [typed, setTyped] = useState("");
  const [kept, setKept] = useState(false);
  useEffect(() => {
    const start = readFilters(workpaperId);
    setFilters(start);
    setTyped(start.search);
    setKept(true);
  }, [workpaperId]);
  useEffect(() => {
    if (kept) {
      keepFilters(workpaperId, filters);
    }
  }, [kept, workpaperId, filters]);
  useEffect(() => {
    const wait = window.setTimeout(
      () =>
        setFilters((current) =>
          current.search === typed ? current : { ...current, search: typed },
        ),
      SEARCH_WAIT_MS,
    );
    return () => window.clearTimeout(wait);
  }, [typed]);
  if (ui === null) {
    return null;
  }
  const { notes, set } = ui;
  if (notes.status === "loading") {
    return (
      <p className="rn-quiet" aria-busy="true">
        Reading the review notes…
      </p>
    );
  }
  if (notes.status === "failed" || set === null) {
    return (
      <div className="rn-failed card">
        <p role="alert">
          {notes.problem ?? "The review notes could not be read."}
        </p>
        <button type="button" className="rn-btn" onClick={notes.reread}>
          Read them again
        </button>
      </div>
    );
  }
  const all = ui.ordered;
  const list = filterNotes(all, filters, ui.context);
  const selected =
    list.find((note) => note.id === ui.selected) ?? list[0] ?? null;
  const counts = (key: FilterKey) =>
    choiceCounts(all, filters, key, ui.context);
  const people = (
    pick: (note: ReviewNote) => { id: string; name: string },
  ): Choice[] => {
    const found = new Map<string, string>();
    for (const note of all) {
      const person = pick(note);
      found.set(person.id, person.name);
    }
    return [...found]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  };
  const sections: Choice[] = SECTIONS.filter((item) =>
    all.some((note) => sectionOf(note, ui.context) === item.n),
  ).map((item) => ({ value: String(item.n), label: item.name }));
  const change = (next: Partial<NoteFilters>) =>
    setFilters((current) => ({ ...current, ...next }));
  // The rail shows the note: its switch lets it through (a closed note under Resolved).
  const openAt = (note: ReviewNote) => {
    ui.setRailView({
      ...RAIL_START,
      tab: isClosed(note) ? "resolved" : "open",
    });
    ui.select(note.id, "open");
    onOpenAt(note.id);
  };
  const urgent = list.filter(
    (note) => note.criticality === "URGENT" && !isClosed(note),
  ).length;
  return (
    <section className="rn-all" aria-label="All review notes">
      <div className="card rn-all-bar">
        <label className="rn-search">
          <span className="sr-only">
            Search notes, replies and highlighted words
          </span>
          <UiIcon name="search" size={14} />
          <input
            type="search"
            value={typed}
            placeholder="Search notes and highlighted words"
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        <fieldset className="rn-filters">
          <legend className="sr-only">Filters</legend>
          <FilterMenu
            label="Status"
            multi
            choices={STATUSES.map((value) => ({
              value,
              label: STATUS_WORDS[value],
            }))}
            chosen={filters.statuses}
            counts={counts("statuses")}
            onChange={(chosen) =>
              change({
                statuses: STATUSES.filter((item) => chosen.includes(item)),
              })
            }
          />
          <FilterMenu
            label="Criticality"
            multi
            choices={CRITICALITIES.map((value) => ({
              value,
              label: CRITICALITY_WORDS[value],
            }))}
            chosen={filters.criticalities}
            counts={counts("criticalities")}
            onChange={(chosen) =>
              change({
                criticalities: CRITICALITIES.filter((item) =>
                  chosen.includes(item),
                ),
              })
            }
          />
          <FilterMenu
            label="Owner"
            multi={false}
            choices={people((note) => note.owner)}
            chosen={filters.owner === null ? [] : [filters.owner]}
            counts={counts("owner")}
            onChange={(chosen) => change({ owner: chosen[0] ?? null })}
          />
          <FilterMenu
            label="Section"
            multi={false}
            choices={sections}
            chosen={filters.section === null ? [] : [String(filters.section)]}
            counts={counts("section")}
            onChange={(chosen) =>
              change({
                section: chosen[0] === undefined ? null : Number(chosen[0]),
              })
            }
          />
          <FilterMenu
            label="Raised by"
            multi={false}
            choices={people((note) => note.raisedBy)}
            chosen={filters.raisedBy === null ? [] : [filters.raisedBy]}
            counts={counts("raisedBy")}
            onChange={(chosen) => change({ raisedBy: chosen[0] ?? null })}
          />
        </fieldset>
        <p className="rn-all-count" aria-live="polite">
          <b>{list.length}</b> of {all.length}{" "}
          {all.length === 1 ? "note" : "notes"}
          {urgent > 0 ? ` · ${urgent} urgent` : ""}
        </p>
        {isFiltered(filters) ? (
          <button
            type="button"
            className="rn-btn is-quiet"
            onClick={() => {
              setTyped("");
              setFilters({ ...STARTING_FILTERS, statuses: [] });
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>
      <div className="rn-all-body">
        <div className="card rn-table-wrap">
          {list.length === 0 ? (
            <p className="rn-empty">
              {all.length === 0
                ? "No review note on this workpaper yet."
                : "No note matches these filters."}
            </p>
          ) : (
            <table className="rn-table">
              <thead>
                <tr>
                  <th scope="col" className="is-num">
                    #
                  </th>
                  <th scope="col">Note</th>
                  <th scope="col">Where</th>
                  <th scope="col">Criticality</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((note) => {
                  const on = selected?.id === note.id;
                  return (
                    <tr
                      key={note.id}
                      className={`rn-${CRITICALITY_TONE[note.criticality]}${on ? " is-selected" : ""}`}
                      onClick={() => ui.select(note.id, "table")}
                    >
                      <td className="is-num">{note.number}</td>
                      <td className="is-note">
                        <button
                          type="button"
                          className="rn-row-pick"
                          aria-current={on ? "true" : undefined}
                          onClick={(event) => {
                            event.stopPropagation();
                            ui.select(note.id, "table");
                          }}
                        >
                          {note.text}
                        </button>
                      </td>
                      <td className="is-where">
                        {whereWords(note, ui.context)}
                        {anchorWords(note) !== "" ? (
                          <small>{anchorWords(note)}</small>
                        ) : null}
                      </td>
                      <td>
                        <CritWord criticality={note.criticality} />
                      </td>
                      <td>{note.owner.name}</td>
                      <td className="rn-status">{STATUS_WORDS[note.status]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {selected !== null ? (
          <aside className="rn-detail" aria-label={`Note ${selected.number}`}>
            <NoteCard key={selected.id} ui={ui} note={selected} place="panel" />
            <div className="rn-detail-foot">
              <p className="rn-detail-head">In the workpaper</p>
              <Passage ui={ui} note={selected} />
              <button
                type="button"
                className="rn-open-at"
                onClick={() => openAt(selected)}
              >
                {selected.anchorKind !== "WORKPAPER"
                  ? "Open the workpaper at this passage"
                  : "Open the workpaper"}
                <UiIcon name="arrow" size={13} />
              </button>
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
