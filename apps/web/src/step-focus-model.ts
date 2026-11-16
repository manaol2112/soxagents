/**
 * Focus mode for a control's workflow step (product owner, 16 November 2026: focus mode,
 * option A). The step's panel takes the whole content area, the navigation folds to its
 * icons, a step strip under the header leads to every step, and the review notes fold to
 * a slim strip at the right until they are opened. Pure: the strip's pills, the notes'
 * strip, the remembered preference and the shortcut, with no React and no DOM.
 */

/** The browser key the preference is kept under, per person (this browser). */
export const FOCUS_KEY = "aw.step-focus";

/** At this width and under, the panel is already full width: no toggle, no icon rail. */
export const FOCUS_NARROW = "(max-width: 1100px)";

type ReadStore = Pick<Storage, "getItem">;
type WriteStore = Pick<Storage, "setItem">;

/** The person's choice, read from the browser; off where nothing is kept or the store
 * refuses (a private window, blocked site data). */
export function rememberedFocus(
  open: () => ReadStore | null | undefined,
): boolean {
  try {
    return open()?.getItem(FOCUS_KEY) === "on";
  } catch {
    return false;
  }
}

/** Keeps the choice; a store that refuses is left alone, and focus still changes for this
 * visit. */
export function rememberFocus(
  open: () => WriteStore | null | undefined,
  on: boolean,
): void {
  try {
    open()?.setItem(FOCUS_KEY, on ? "on" : "off");
  } catch {
    // Nothing to keep it in: the choice lasts for this visit only.
  }
}

/** The toggle's words: its accessible name, and its tooltip with the shortcut. */
export function focusToggleOf(on: boolean): { label: string; tip: string } {
  const label = on ? "Exit full width" : "Expand to full width";
  return { label, tip: `${label} (Shift+F)` };
}

/** What the shortcut sees of a key press and the element that has the focus. */
export type ShortcutPress = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  defaultPrevented: boolean;
  /** The focused element's tag (upper case, as the DOM gives it), its type for an input,
   * and whether it is editable text. */
  target: { tagName: string; type?: string; editable: boolean } | null;
};

/** Inputs that take no typed text: a key press there is the page's. */
const NOT_TEXT = new Set([
  "button",
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "submit",
  "reset",
  "image",
]);

/** Whether a press is in a place that takes text (an editor, a field, a list box). */
export function inTextBox(target: ShortcutPress["target"]): boolean {
  if (target === null) {
    return false;
  }
  if (target.editable) {
    return true;
  }
  const tag = target.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return (
    tag === "INPUT" && !NOT_TEXT.has((target.type ?? "text").toLowerCase())
  );
}

/** Shift+F toggles focus, outside a text box and with no other modifier. Escape never
 * does: it is the editors' and the dialogs' (and, outside them, closes the panel). */
export function isFocusShortcut(press: ShortcutPress): boolean {
  return (
    !press.defaultPrevented &&
    !press.repeat &&
    press.shiftKey &&
    !press.ctrlKey &&
    !press.metaKey &&
    !press.altKey &&
    press.key.toLowerCase() === "f" &&
    !inTextBox(press.target)
  );
}

/** The part of a workflow step the strip reads. */
export type StripStep = {
  key: string;
  number: number;
  title: string;
  /** The step's tone (control-workflow-model's Tone). */
  tone: string;
};

export type PillState = "done" | "current" | "todo" | "skipped";

export type StepPill = {
  key: string;
  /** What the pill shows before the title: a tick for a done step, else its number. */
  mark: "check" | string;
  title: string;
  state: PillState;
  href: string;
  /** Its accessible name: number, title and where it stands. */
  label: string;
};

const STATE_WORDS: Record<PillState, string> = {
  done: "done",
  current: "open now",
  todo: "not done",
  skipped: "not performed",
};

/**
 * One pill per workflow step, in the workflow's order: a tick where the step is done,
 * its number for the rest, the open one marked current (whatever its tone). Each leads
 * to its step by the same address the panel's previous and next arrows use; a step
 * without one is left out rather than drawn as a dead link.
 */
export function stepStripOf(
  steps: readonly StripStep[],
  current: string | null,
  hrefs: Readonly<Record<string, string | undefined>>,
): StepPill[] {
  const pills: StepPill[] = [];
  for (const step of steps) {
    const href = hrefs[step.key];
    if (href === undefined || href === "") {
      continue;
    }
    const state: PillState =
      step.key === current
        ? "current"
        : step.tone === "done"
          ? "done"
          : step.tone === "skipped"
            ? "skipped"
            : "todo";
    const done = step.tone === "done";
    pills.push({
      key: step.key,
      mark: done ? "check" : String(step.number),
      title: step.title,
      state,
      href,
      label: `Step ${step.number}, ${step.title}, ${
        state === "current" && done ? "done, open now" : STATE_WORDS[state]
      }`,
    });
  }
  return pills;
}

/** The control a focused step belongs to, said before the step's title. */
export function focusCrumbOf(control: { ref: string; title: string }): string {
  const ref = control.ref.trim();
  const title = control.title.trim();
  return ref === "" ? title : title === "" ? ref : `${ref} · ${title}`;
}

/** The part of a review note the folded strip reads. */
export type StripNote = { status: string; criticality: string };

/** The most dots the strip draws; the rest are said by the count. */
export const MAX_NOTE_DOTS = 8;

const OPEN = new Set(["OPEN", "RESPONDED"]);
const DOT_ORDER = ["URGENT", "NORMAL", "FOLLOW_UP"];

/**
 * The folded notes' strip: how many notes are open (open, or responded to and not yet
 * cleared, as the rail counts them), and one dot per open note by its criticality, the
 * urgent first; a criticality this page does not know is drawn as a follow-up, never as
 * urgent (review-notes-model's CRITICALITY_TONE).
 */
export function notesStripOf(notes: readonly StripNote[]): {
  open: number;
  dots: string[];
  more: number;
  label: string;
} {
  const open = notes.filter((note) => OPEN.has(note.status));
  const rank = (criticality: string) => {
    const at = DOT_ORDER.indexOf(criticality);
    return at < 0 ? DOT_ORDER.length : at;
  };
  const tones = open
    .map((note) => note.criticality)
    .sort((a, b) => rank(a) - rank(b))
    .map((criticality) =>
      criticality === "URGENT"
        ? "urgent"
        : criticality === "NORMAL"
          ? "normal"
          : "follow-up",
    );
  const urgent = open.filter((note) => note.criticality === "URGENT").length;
  const count =
    open.length === 0
      ? "no open notes"
      : `${open.length} open ${open.length === 1 ? "note" : "notes"}`;
  return {
    open: open.length,
    dots: tones.slice(0, MAX_NOTE_DOTS),
    more: Math.max(0, tones.length - MAX_NOTE_DOTS),
    label: `Review notes, ${count}${urgent > 0 ? `, ${urgent} urgent` : ""}`,
  };
}
