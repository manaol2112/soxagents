"use client";

import {
  createContext,
  Fragment,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  type AnchorKind,
  anchorOf,
  anchorWords,
  CRITICALITIES,
  CRITICALITY_TONE,
  CRITICALITY_WORDS,
  type Criticality,
  chipCount,
  choiceCounts,
  contextOf,
  documentOrder,
  doneWords,
  eventWords,
  type FieldContext,
  type FilterKey,
  fieldTextsOf,
  filterNotes,
  filtersKey,
  GONE_WORDS,
  isClosed,
  isFiltered,
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
  openLine,
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
  type RailChips,
  type ReviewNote,
  type ReviewNotes,
  railNotes,
  reasonProblem,
  replyProblem,
  SECTIONS,
  STARTING_FILTERS,
  STATUS_WORDS,
  STATUSES,
  sectionOf,
  type TextAnchor,
  type WorkpaperNotesScope,
  whenWords,
  whereWords,
  withNote,
  wordsGone,
} from "./review-notes-model";
import { parseRich, type Run } from "./rich-text-model";
import { RowMenu, type RowMenuItem } from "./row-menu";
import { UiIcon } from "./ui-icon";
import { useFocusTrap } from "./use-focus-trap";

/**
 * Workpaper review notes on the screen (docs/workpaper-review.md, section 6): one read of
 * a workpaper's notes and the writes to them; the markers and the highlighted words in the
 * Document view; the rail beside it; All notes; and the line on the reviewer's step.
 *
 * Nothing is shown as done before the server confirms it: a write's answer is the note as
 * the server then has it, and the notes are read again after it. Who may do what is the
 * server's: each note's `can` says what to offer. Every text of a note, a reply or a
 * quote is a person's, shown as text and never taken as markup.
 *
 * The agent's help (section 7) is a later increment: a note's card leaves a place for it
 * (`AgentHelpSlot`) and offers nothing yet.
 */

const calm = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const scrollBehavior = (): ScrollBehavior => (calm() ? "auto" : "smooth");

/** Whether the page was opened at All notes (`#review-notes`, from D&I Conclusion and
 * Review). */
export function openedAtNotes(): boolean {
  return (
    typeof window !== "undefined" && window.location.hash === `#${NOTES_ANCHOR}`
  );
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
  /** What the form shows beside its fields: "4 Attributes · C, result". */
  where: string;
  /** What had the focus when the form opened: it gets it back. */
  opener: HTMLElement | null;
};

type SelectFrom = "document" | "rail" | "table" | "open";

type NotesUi = {
  notes: NotesState;
  set: ReviewNotes | null;
  /** The document draws the markers and the highlighted words. */
  on: boolean;
  texts: ReadonlyMap<string, string>;
  context: FieldContext;
  /** Every note, in the order of the document. */
  ordered: ReviewNote[];
  /** What the rail lists: its chips over the ordered notes. */
  listed: ReviewNote[];
  /** What the document draws: the listed notes that are not closed, and the selected
   * one whatever it is. */
  drawn: ReviewNote[];
  selected: string | null;
  select: (id: string | null, from: SelectFrom) => void;
  raising: RaiseTarget | null;
  startRaise: (target: RaiseTarget) => void;
  endRaise: () => void;
  /** The criticality chosen in the open form: the pending words take its colour. */
  pendingCriticality: Criticality;
  setPendingCriticality: (value: Criticality) => void;
  chips: RailChips;
  setChips: (chips: RailChips) => void;
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

const fieldSelector = (field: string) =>
  `[data-rn-field="${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(field) : field}"]`;

/**
 * The notes of the workpaper on screen, shared by its Document view (the markers and
 * the highlighted words), the rail and All notes. `on` says whether the Document view
 * draws them (the rail's switch); `rootRef` is the document sheet the selection and the
 * scrolling look in.
 */
export function ReviewNotesProvider({
  notes,
  paper,
  on,
  workpaperVersion,
  rootRef,
  children,
}: {
  notes: NotesState;
  paper: PaperFields | null;
  on: boolean;
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
  const [chips, setChips] = useState<RailChips>(RAIL_START);
  const [section, setSection] = useState<number | null>(null);
  const [said, setSaid] = useState("");
  const set = notes.set;
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
  const listed = useMemo(
    () => railNotes(ordered, chips, set?.viewerId ?? null, section),
    [ordered, chips, set, section],
  );
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
  const startRaise = useCallback((target: RaiseTarget) => {
    setPendingCriticality("NORMAL");
    setRaising(target);
  }, []);
  const endRaise = useCallback(() => setRaising(null), []);

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
    on,
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
    pendingCriticality,
    setPendingCriticality,
    chips,
    setChips,
    section,
    setSection,
    workpaperVersion,
    announce,
    rootRef,
  };
  return (
    <NotesContext.Provider value={value}>
      {children}
      {on ? <SelectionOffer /> : null}
      {raising !== null ? <RaiseForm target={raising} /> : null}
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
 * One field of the workpaper (section 3's key): its text, the highlighted words of its
 * notes in their criticality's colour, a numbered marker for each of its notes, and
 * "Add review note" with the pointer or the focus. Where no provider is above or the
 * notes are off (the printed sheet), it is the text alone, as before.
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
  /** Inside a line of text (a paragraph): the marker follows the words. */
  inline?: boolean;
  /** What is drawn while the notes are off (and, with no `text`, while they are on);
   * the text where none is given. */
  children?: ReactNode;
}) {
  const ui = useNotesUi();
  if (ui === null || !ui.on) {
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
  const painted = paintedFor(ui, field);
  const mine = ui.drawn.filter(
    (note) => note.anchorKind !== "WORKPAPER" && note.field === field,
  );
  const where = whereWords({ anchorKind: "FIELD", field }, ui.context);
  const canRaise = ui.set?.canRaise === true;
  const Box = inline || !rich ? "span" : "div";
  const Wrap = inline ? "span" : "div";
  const selectedHere =
    ui.selected !== null && mine.some((note) => note.id === ui.selected);
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
      className={`rn-field${inline ? " is-inline" : ""}${selectedHere ? " is-selected" : ""}`}
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
      <span className="rn-corner" data-rn-skip="">
        {mine.map((note) => (
          <button
            key={note.id}
            type="button"
            className={`rn-marker${note.id === ui.selected ? " is-selected" : ""}`}
            aria-pressed={note.id === ui.selected}
            aria-label={`Review note ${note.number}: ${CRITICALITY_WORDS[note.criticality]}, ${STATUS_WORDS[note.status].toLowerCase()}`}
            onClick={() =>
              ui.select(note.id === ui.selected ? null : note.id, "document")
            }
          >
            {note.number}
          </button>
        ))}
        {canRaise ? (
          <button
            type="button"
            className="rn-add"
            aria-label={`Add review note on ${where}`}
            title="Add review note"
            onClick={(event) =>
              ui.startRaise({
                anchorKind: "FIELD",
                field,
                anchor: null,
                where,
                opener: event.currentTarget,
              })
            }
          >
            <UiIcon name="plus" size={12} />
            <span className="rn-add-words">Add review note</span>
          </button>
        ) : null}
      </span>
    </Wrap>
  );
}

/* Highlighting words: the selection ---------------------------------------------------- */

type Offer = {
  field: string;
  anchor: TextAnchor & { start: number; end: number };
  x: number;
  y: number;
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

/** What a selection inside one field offers: its anchor and where to show the button;
 * null for a selection across fields, outside the sheet, or of nothing but space. */
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
  const anchor = anchorOf(
    text,
    offsetIn(start, range.startContainer, range.startOffset),
    offsetIn(start, range.endContainer, range.endOffset),
  );
  if (anchor === null) {
    return null;
  }
  const rects = range.getClientRects();
  const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
  return { field, anchor, x: last.right, y: last.bottom, top: last.top };
}

/** "Add review note" beside words selected in a field (with the pointer, or the
 * keyboard where the browser lets it select). */
function SelectionOffer() {
  const ui = useNotesUi();
  const [offer, setOffer] = useState<Offer | null>(null);
  const canRaise = ui?.set?.canRaise === true;
  const root = ui?.rootRef;
  const texts = ui?.texts;
  const raising = ui?.raising ?? null;
  useEffect(() => {
    if (
      !canRaise ||
      root === undefined ||
      texts === undefined ||
      raising !== null
    ) {
      setOffer(null);
      return;
    }
    let frame = 0;
    const check = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() =>
        setOffer(offerOf(root.current, texts)),
      );
    };
    document.addEventListener("selectionchange", check);
    window.addEventListener("scroll", check, { passive: true, capture: true });
    window.addEventListener("resize", check);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", check);
      window.removeEventListener("scroll", check, { capture: true });
      window.removeEventListener("resize", check);
    };
  }, [canRaise, root, texts, raising]);
  if (ui === null || offer === null || typeof document === "undefined") {
    return null;
  }
  const width = 150;
  const left = Math.max(
    8,
    Math.min(offer.x - width / 2, window.innerWidth - width - 8),
  );
  const top = offer.y + 40 > window.innerHeight ? offer.top - 38 : offer.y + 6;
  return createPortal(
    <button
      type="button"
      className="rn-offer"
      style={{ left, top }}
      // The selection stays as it is while the button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        ui.startRaise({
          anchorKind: "TEXT",
          field: offer.field,
          anchor: offer.anchor,
          where: whereWords(
            { anchorKind: "TEXT", field: offer.field },
            ui.context,
          ),
          opener: document.querySelector<HTMLElement>(
            `${fieldSelector(offer.field)} .rn-add`,
          ),
        });
        window.getSelection()?.removeAllRanges();
        setOffer(null);
      }}
    >
      <UiIcon name="plus" size={13} />
      Add review note
    </button>,
    document.body,
  );
}

/* The form of a new note --------------------------------------------------------------- */

function CriticalityChoice({
  value,
  onChange,
  name,
  disabled = false,
}: {
  value: Criticality;
  onChange: (value: Criticality) => void;
  name: string;
  disabled?: boolean;
}) {
  return (
    <fieldset className="rn-seg" disabled={disabled}>
      <legend>Criticality</legend>
      <div className="rn-seg-row">
        {CRITICALITIES.map((item) => (
          <label
            key={item}
            className={`rn-seg-item rn-${CRITICALITY_TONE[item]}`}
          >
            <input
              type="radio"
              name={name}
              value={item}
              checked={value === item}
              onChange={() => onChange(item)}
            />
            <span className="rn-dot" aria-hidden="true" />
            {CRITICALITY_WORDS[item]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Where the form opens: beside the words or the field, or the rail's button for the
 * workpaper as a whole; under it where there is room, else above. */
function placeOfTarget(ui: NotesUi, target: RaiseTarget): DOMRect | null {
  const root = ui.rootRef.current;
  if (target.anchorKind === "TEXT") {
    const mark = root?.querySelector<HTMLElement>(
      `mark[data-rn-notes~="${PENDING}"]`,
    );
    if (mark) {
      return mark.getBoundingClientRect();
    }
  }
  if (target.anchorKind !== "WORKPAPER") {
    const box = root?.querySelector<HTMLElement>(fieldSelector(target.field));
    if (box) {
      return box.getBoundingClientRect();
    }
  }
  return target.opener?.isConnected
    ? target.opener.getBoundingClientRect()
    : null;
}

function RaiseForm({ target }: { target: RaiseTarget }) {
  const ui = useNotesUi();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const set = ui?.set ?? null;
  const members = set?.members ?? [];
  const [text, setText] = useState("");
  const [owner, setOwner] = useState(
    set?.defaultOwnerId ?? members[0]?.id ?? "",
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(
    null,
  );
  const criticality = ui?.pendingCriticality ?? "NORMAL";
  // Tab stays in the form while it is open; Escape closes it.
  useFocusTrap(box);

  const close = useCallback(() => {
    ui?.endRaise();
    const back = target.opener;
    window.requestAnimationFrame(() => {
      if (back?.isConnected) {
        back.focus({ preventScroll: true });
      }
    });
  }, [ui, target.opener]);

  useLayoutEffect(() => {
    if (ui === null) {
      return;
    }
    let frame = 0;
    const locate = () => {
      const node = box.current;
      const rect = placeOfTarget(ui, target);
      if (node === null) {
        return;
      }
      const width = node.offsetWidth || 360;
      const height = node.offsetHeight || 320;
      if (rect === null) {
        setPlace({
          left: Math.max(16, (window.innerWidth - width) / 2),
          top: Math.max(16, (window.innerHeight - height) / 2),
        });
        return;
      }
      const left = Math.max(
        16,
        Math.min(rect.left, window.innerWidth - width - 16),
      );
      const below = rect.bottom + 8;
      const top =
        below + height <= window.innerHeight - 16
          ? below
          : Math.max(16, rect.top - height - 8);
      setPlace({ left, top });
    };
    const again = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(locate);
    };
    locate();
    window.addEventListener("scroll", again, { passive: true, capture: true });
    window.addEventListener("resize", again);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", again, { capture: true });
      window.removeEventListener("resize", again);
    };
  }, [ui, target]);

  // The focus goes to the note's text once the form is placed (it is hidden until then,
  // and a hidden box cannot take the focus).
  const placed = place !== null;
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (placed && !focusedOnce.current) {
      focusedOnce.current = true;
      area.current?.focus({ preventScroll: true });
    }
  }, [placed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  if (ui === null || typeof document === "undefined") {
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
    ui.endRaise();
    ui.select(result.note.id, "document");
  };
  const heading =
    target.anchorKind === "TEXT"
      ? "Review note on the highlighted words"
      : target.anchorKind === "WORKPAPER"
        ? "Review note on the workpaper as a whole"
        : "Review note on this field";
  return createPortal(
    <div
      ref={box}
      className={`rn-pop${place === null ? " is-placing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-head`}
      aria-describedby={`${id}-where`}
      style={place === null ? undefined : { left: place.left, top: place.top }}
    >
      <form
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          submit().catch(() => undefined);
        }}
      >
        <h3 id={`${id}-head`}>{heading}</h3>
        <p id={`${id}-where`} className="rn-pop-where">
          {target.where}
          {target.anchor !== null ? (
            <>
              {" · "}
              <q className="rn-quote">{target.anchor.quote}</q>
            </>
          ) : null}
        </p>
        <label className="rn-label" htmlFor={`${id}-text`}>
          Note
        </label>
        <textarea
          id={`${id}-text`}
          ref={area}
          rows={3}
          value={text}
          maxLength={4000}
          disabled={sending}
          aria-invalid={problem !== null && noteTextProblem(text) !== null}
          onChange={(event) => setText(event.target.value)}
          placeholder="What should change, or what is unclear?"
        />
        <CriticalityChoice
          name={`${id}-crit`}
          value={criticality}
          onChange={ui.setPendingCriticality}
          disabled={sending}
        />
        <label className="rn-label" htmlFor={`${id}-owner`}>
          Resolution owner
        </label>
        <select
          id={`${id}-owner`}
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
        {problem !== null ? (
          <p className="rn-problem" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="rn-pop-actions">
          <button
            type="button"
            className="rn-btn"
            onClick={close}
            disabled={sending}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rn-btn is-primary"
            disabled={sending}
          >
            {sending ? "Adding…" : "Add note"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/* A note: its words, its thread and what may be done ----------------------------------- */

type Composer = "reply" | "respond" | "reopen" | "dismiss" | "owner";

const COMPOSER_WORDS: Record<
  Composer,
  { label: string; submit: string; busy: string }
> = {
  reply: { label: "Reply", submit: "Reply", busy: "Replying…" },
  respond: { label: "Response", submit: "Respond", busy: "Responding…" },
  reopen: {
    label: "Why it is reopened",
    submit: "Reopen note",
    busy: "Reopening…",
  },
  dismiss: {
    label: "Why it is dismissed",
    submit: "Dismiss note",
    busy: "Dismissing…",
  },
  owner: {
    label: "Resolution owner",
    submit: "Change owner",
    busy: "Changing…",
  },
};

/** The agent's help with a note (docs/workpaper-review.md, section 7) goes here, in a
 * later increment. Nothing is drawn yet. */
function AgentHelpSlot(_props: { note: ReviewNote }) {
  return null;
}

function Thread({ note }: { note: ReviewNote }) {
  const events = note.events.filter((event) => event.kind !== "RAISED");
  if (events.length === 0) {
    return null;
  }
  return (
    <ol className="rn-thread" aria-label={`Thread of note ${note.number}`}>
      {events.map((event) => (
        <li key={event.id} className={`rn-ev is-${event.kind.toLowerCase()}`}>
          <p className="rn-ev-head">
            {event.kind === "REPLIED" ? (
              <b>{event.by.name}</b>
            ) : (
              <span>{eventWords(event)}</span>
            )}
            <time dateTime={event.at}>{whenWords(event.at)}</time>
          </p>
          {event.text !== "" ? (
            <p className="rn-ev-text">{event.text}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** What the note is about, shown in the side panel: the passage around its words as
 * the field reads now, the field's text, or the workpaper. */
function Passage({ ui, note }: { ui: NotesUi; note: ReviewNote }) {
  if (note.anchorKind === "WORKPAPER") {
    return <p className="rn-passage is-quiet">On the workpaper as a whole.</p>;
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

function NoteActions({
  note,
  place,
  onCompose,
  onRun,
  sending,
}: {
  note: ReviewNote;
  place: "rail" | "panel";
  onCompose: (composer: Composer) => void;
  onRun: (action: NoteAction) => void;
  sending: boolean;
}) {
  const { can } = note;
  const items: RowMenuItem[] = [];
  if (place === "rail" && can.reply) {
    items.push({
      label: "Reply",
      icon: "message",
      onSelect: () => onCompose("reply"),
    });
  }
  if (place === "rail" && can.respond) {
    items.push({
      label: "Respond",
      icon: "compose",
      onSelect: () => onCompose("respond"),
    });
  }
  if (can.clear) {
    items.push({
      label: "Clear note",
      icon: "check",
      onSelect: () =>
        onRun({ intent: "clear", noteId: note.id, version: note.version }),
    });
  }
  if (can.reopen) {
    items.push({
      label: "Reopen with a reply",
      icon: "retry",
      onSelect: () => onCompose("reopen"),
    });
  }
  if (can.dismiss) {
    items.push({
      label: "Dismiss with a reason",
      icon: "xCircle",
      onSelect: () => onCompose("dismiss"),
    });
  }
  if (can.owner) {
    items.push({
      label: "Change resolution owner",
      icon: "user",
      onSelect: () => onCompose("owner"),
    });
  }
  if (can.criticality) {
    for (const item of CRITICALITIES) {
      items.push({
        label: CRITICALITY_WORDS[item],
        section: "Criticality",
        unavailable: item === note.criticality ? "It is this now" : null,
        onSelect: () =>
          onRun({
            intent: "criticality",
            noteId: note.id,
            version: note.version,
            criticality: item,
          }),
      });
    }
  }
  if (items.length === 0 || sending) {
    return null;
  }
  return (
    <RowMenu
      label={`note ${note.number}`}
      items={items}
      trigger={{
        label: "Actions",
        icon: "more",
        className: "rn-menu-trigger",
        ariaLabel: `Actions on note ${note.number}`,
      }}
    />
  );
}

/** The selected note's thread, the composer and the actions: in the rail's card and in
 * All notes' panel. */
function NoteBody({
  ui,
  note,
  place,
}: {
  ui: NotesUi;
  note: ReviewNote;
  place: "rail" | "panel";
}) {
  const id = useId();
  const startComposer: Composer | null =
    place === "panel" && (note.can.reply || note.can.respond) ? "reply" : null;
  const [composer, setComposer] = useState<Composer | null>(startComposer);
  const [text, setText] = useState("");
  const [responds, setResponds] = useState(false);
  const [owner, setOwner] = useState(note.owner.id);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const ownerBox = useRef<HTMLSelectElement>(null);
  // A composer that the note's state no longer takes closes (a reply on a cleared note).
  const open =
    composer === "reply"
      ? note.can.reply || note.can.respond
      : composer === null
        ? false
        : note.can[composer];
  const shown: Composer | null = open
    ? composer
    : place === "panel"
      ? startComposer
      : null;

  const run = async (action: NoteAction): Promise<boolean> => {
    setSending(true);
    setProblem(null);
    const result = await ui.notes.act(action);
    setSending(false);
    if (!result.ok) {
      setProblem(result.problem);
      return false;
    }
    ui.announce(doneWords(action.intent, note.number));
    setText("");
    setResponds(false);
    setComposer(startComposer);
    return true;
  };
  const compose = (next: Composer) => {
    setComposer(next);
    setProblem(null);
    setText("");
    setResponds(next === "respond");
    setOwner(note.owner.id);
    window.requestAnimationFrame(() =>
      next === "owner" ? ownerBox.current?.focus() : area.current?.focus(),
    );
  };
  const send = () => {
    if (shown === null) {
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
      }).catch(() => undefined);
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
    const action: NoteAction =
      shown === "dismiss"
        ? {
            intent: "dismiss",
            noteId: note.id,
            version: note.version,
            reason: words,
          }
        : shown === "reopen"
          ? {
              intent: "reopen",
              noteId: note.id,
              version: note.version,
              text: words,
            }
          : {
              intent: "reply",
              noteId: note.id,
              version: note.version,
              text: words,
              responds:
                shown === "respond" ||
                (note.can.respond && (responds || !note.can.reply)),
            };
    run(action).catch(() => undefined);
  };
  const words = shown === null ? null : COMPOSER_WORDS[shown];
  // A resolution owner who may not reply otherwise answers only with a response.
  const mustRespond = !note.can.reply && note.can.respond;
  return (
    <div className="rn-body">
      <Thread note={note} />
      <AgentHelpSlot note={note} />
      {shown !== null && words !== null ? (
        <form
          autoComplete="off"
          className="rn-compose"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <label className="rn-label" htmlFor={`${id}-${shown}`}>
            {mustRespond && shown === "reply" ? "Response" : words.label}
          </label>
          {shown === "owner" ? (
            <select
              id={`${id}-${shown}`}
              ref={ownerBox}
              value={owner}
              disabled={sending}
              onChange={(event) => setOwner(event.target.value)}
            >
              {(ui.set?.members ?? []).map((member) => (
                <option key={member.id} value={member.id}>
                  {memberWords(member)}
                </option>
              ))}
            </select>
          ) : (
            <textarea
              id={`${id}-${shown}`}
              ref={area}
              rows={2}
              value={text}
              maxLength={4000}
              disabled={sending}
              onChange={(event) => setText(event.target.value)}
            />
          )}
          {shown === "reply" && note.can.respond && !mustRespond ? (
            <label className="rn-check">
              <input
                type="checkbox"
                checked={responds}
                disabled={sending}
                onChange={(event) => setResponds(event.target.checked)}
              />
              This is the response: mark the note responded to
            </label>
          ) : null}
          <div className="rn-compose-actions">
            {place === "rail" || shown !== startComposer ? (
              <button
                type="button"
                className="rn-btn is-quiet"
                disabled={sending}
                onClick={() => {
                  setComposer(startComposer);
                  setProblem(null);
                }}
              >
                Cancel
              </button>
            ) : null}
            <button
              type="submit"
              className="rn-btn is-primary"
              disabled={sending}
            >
              {sending
                ? words.busy
                : mustRespond && shown === "reply"
                  ? "Respond"
                  : words.submit}
            </button>
          </div>
        </form>
      ) : null}
      {problem !== null ? (
        <p className="rn-problem" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="rn-body-actions">
        <NoteActions
          note={note}
          place={place}
          onCompose={compose}
          onRun={(action) => {
            run(action).catch(() => undefined);
          }}
          sending={sending}
        />
        {sending ? (
          <span className="rn-quiet" role="status">
            Saving…
          </span>
        ) : null}
      </div>
    </div>
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

const CHIPS: ReadonlyArray<{ key: keyof RailChips; label: string }> = [
  { key: "open", label: "Open" },
  { key: "urgent", label: "Urgent" },
  { key: "mine", label: "Mine" },
  { key: "section", label: "This section" },
];

/** The section in view: that of the last field of the sheet whose top is above a third
 * of the window (the first field where none is). */
function sectionInView(root: HTMLElement | null): number | null {
  if (root === null) {
    return null;
  }
  let found: number | null = null;
  let first: number | null = null;
  for (const node of root.querySelectorAll<HTMLElement>("[data-rn-field]")) {
    const n = sectionOf({
      anchorKind: "FIELD",
      field: node.dataset.rnField ?? "",
    });
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

function NoteCard({ ui, note }: { ui: NotesUi; note: ReviewNote }) {
  const selected = ui.selected === note.id;
  const where = whereWords(note, ui.context);
  const gone = wordsGone(note, ui.texts);
  return (
    <li
      className={`rn-card rn-${CRITICALITY_TONE[note.criticality]}${selected ? " is-selected" : ""}${isClosed(note) ? " is-closed" : ""}`}
      data-rn-card={note.id}
    >
      <button
        type="button"
        className="rn-card-pick"
        aria-expanded={selected}
        aria-label={`Note ${note.number}: ${CRITICALITY_WORDS[note.criticality]}, ${STATUS_WORDS[note.status].toLowerCase()}, on ${where}`}
        onClick={() => ui.select(selected ? null : note.id, "rail")}
      >
        <span className="rn-num" aria-hidden="true">
          {note.number}
        </span>
        <CritWord criticality={note.criticality} />
        <span className="rn-status">{STATUS_WORDS[note.status]}</span>
      </button>
      <p className="rn-where">
        {where}
        {note.anchorKind === "FIELD" ? " · the field" : ""}
      </p>
      {note.anchorKind === "TEXT" ? (
        <p className="rn-quote-line">
          <q className="rn-quote">{note.quote}</q>
          {gone ? <span className="rn-gone">{GONE_WORDS}.</span> : null}
        </p>
      ) : null}
      <p className="rn-text-body">{note.text}</p>
      <p className="rn-meta">
        <span>
          {note.raisedBy.name} ·{" "}
          <time dateTime={note.raisedAt}>{whenWords(note.raisedAt)}</time>
        </span>
        <span>Owner {note.owner.name}</span>
      </p>
      {selected ? <NoteBody ui={ui} note={note} place="rail" /> : null}
    </li>
  );
}

/** The rail beside the Document view (section 6): the one-press filters, then the notes
 * in the order of the document, each numbered as its marker. */
export function NotesRail({ id }: { id?: string }) {
  const ui = useNotesUi();
  const sectionOn = ui?.chips.section === true;
  const setSection = ui?.setSection;
  const root = ui?.rootRef;
  // "This section" follows the section in view while it is pressed.
  useEffect(() => {
    if (!sectionOn || setSection === undefined || root === undefined) {
      return;
    }
    let frame = 0;
    const follow = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() =>
        setSection(sectionInView(root.current)),
      );
    };
    follow();
    window.addEventListener("scroll", follow, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", follow);
    };
  }, [sectionOn, setSection, root]);
  if (ui === null) {
    return null;
  }
  const { notes, set } = ui;
  const viewer = set?.viewerId ?? null;
  return (
    <aside
      className="rn-rail"
      id={id}
      aria-label="Review notes"
      data-rn-rail=""
    >
      {notes.status === "loading" ? (
        <p className="rn-quiet" aria-busy="true">
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
          <fieldset className="rn-chips">
            <legend className="sr-only">Show notes</legend>
            {CHIPS.filter((chip) => chip.key !== "mine" || viewer !== null).map(
              (chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className="rn-chip"
                  aria-pressed={ui.chips[chip.key]}
                  onClick={() => {
                    const next = {
                      ...ui.chips,
                      [chip.key]: !ui.chips[chip.key],
                    };
                    if (chip.key === "section" && next.section) {
                      ui.setSection(sectionInView(ui.rootRef.current));
                    }
                    ui.setChips(next);
                  }}
                >
                  {chip.label}
                  {chip.key !== "section" || ui.section !== null ? (
                    <span className="rn-chip-count">
                      {chipCount(
                        ui.ordered,
                        ui.chips,
                        chip.key,
                        viewer,
                        ui.section,
                      )}
                    </span>
                  ) : null}
                </button>
              ),
            )}
          </fieldset>
          {ui.chips.section && ui.section !== null ? (
            <p className="rn-quiet rn-chip-note">
              {SECTIONS.find((item) => item.n === ui.section)?.name}
            </p>
          ) : null}
          {ui.listed.length === 0 ? (
            <p className="rn-empty">
              {ui.ordered.length === 0
                ? set.canRaise
                  ? "No review note yet. Select words in a field, or use + on a field, to raise one."
                  : "No review note on this workpaper."
                : "No note matches these filters."}
            </p>
          ) : (
            <ol className="rn-list">
              {ui.listed.map((note) => (
                <NoteCard key={note.id} ui={ui} note={note} />
              ))}
            </ol>
          )}
          {set.canRaise ? (
            <button
              type="button"
              className="rn-btn is-quiet rn-whole"
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
        </>
      )}
    </aside>
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
 * the selected note beside it with its passage, its thread, a reply box and its actions.
 * The filters are kept in the browser for the session, not in the address. */
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
  const list = filterNotes(all, filters);
  const selected =
    list.find((note) => note.id === ui.selected) ?? list[0] ?? null;
  const counts = (key: FilterKey) => choiceCounts(all, filters, key);
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
    all.some((note) => sectionOf(note) === item.n),
  ).map((item) => ({ value: String(item.n), label: item.name }));
  const change = (next: Partial<NoteFilters>) =>
    setFilters((current) => ({ ...current, ...next }));
  // The rail shows the note: its chips let it through (a closed note with Open off).
  const openAt = (note: ReviewNote) => {
    ui.setChips({ ...RAIL_START, open: !isClosed(note) });
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
                        {note.anchorKind === "TEXT" ? (
                          <q className="rn-quote">{note.quote}</q>
                        ) : null}
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
          <aside
            className={`card rn-detail rn-${CRITICALITY_TONE[selected.criticality]}`}
            aria-label={`Note ${selected.number}`}
          >
            <p className="rn-detail-head">
              Note {selected.number} · {whereWords(selected, ui.context)}
            </p>
            <Passage ui={ui} note={selected} />
            <div className="rn-detail-note">
              <p className="rn-ev-head">
                <b>{selected.raisedBy.name}</b>
                <time dateTime={selected.raisedAt}>
                  {whenWords(selected.raisedAt)}
                </time>
                <CritWord criticality={selected.criticality} />
              </p>
              <p className="rn-text-body">{selected.text}</p>
              <p className="rn-meta">
                <span>{STATUS_WORDS[selected.status]}</span>
                <span>Owner {selected.owner.name}</span>
              </p>
            </div>
            <NoteBody key={selected.id} ui={ui} note={selected} place="panel" />
            {selected.anchorKind !== "WORKPAPER" ? (
              <button
                type="button"
                className="rn-open-at"
                onClick={() => openAt(selected)}
              >
                Open the workpaper at this passage
                <UiIcon name="arrow" size={13} />
              </button>
            ) : (
              <button
                type="button"
                className="rn-open-at"
                onClick={() => openAt(selected)}
              >
                Open the workpaper
                <UiIcon name="arrow" size={13} />
              </button>
            )}
          </aside>
        ) : null}
      </div>
    </section>
  );
}

/* The reviewer's step ------------------------------------------------------------------ */

/** D&I Conclusion and Review (section 6): how many notes are open and how many are
 * urgent, with the way to All notes. What holds the sign-off is the server's `blocking`,
 * which the step already says. */
export function ReviewNotesLine({
  scope,
  href,
}: {
  scope: WorkpaperNotesScope | null;
  href: string;
}) {
  const notes = useReviewNotes(scope);
  if (scope === null) {
    return (
      <span className="rn-step-line">
        No review note: no design workpaper yet
      </span>
    );
  }
  if (notes.status === "loading") {
    return <span className="rn-step-line">Reading the review notes…</span>;
  }
  if (notes.status !== "ready" || notes.set === null) {
    return (
      <span className="rn-step-line">
        The review notes could not be read. <a href={href}>Open them</a>
      </span>
    );
  }
  const { counts } = notes.set;
  return (
    <span className={`rn-step-line${counts.urgentOpen > 0 ? " is-held" : ""}`}>
      <span>{openLine(counts)}</span>
      {notes.set.notes.length > 0 ? (
        <a href={href}>Open the review notes</a>
      ) : null}
    </span>
  );
}
