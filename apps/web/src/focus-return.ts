/**
 * Where keyboard focus goes when a form opened from a row or a menu closes or answers
 * (WCAG 2.2: 2.4.3 Focus Order; E1 design review, round 4, 18 November 2026: after Close,
 * Cancel, a confirmation and a refusal, focus fell to the page's body, so a keyboard
 * person started again from the top of the page). One rule for every such form, applied
 * by the hook in use-focus-return.ts:
 *
 * - once it answered (a confirmation, or a refusal that holds the change), the answer it
 *   has just drawn: the confirmation's line, or the held box's way out;
 * - else the control that opened it, while that is still on the page;
 * - else that control drawn again (the same kind of control with the same name, such as
 *   a row's menu button drawn anew when its form closed);
 * - else the row the form was opened on.
 *
 * Focus is moved only when it was lost (on the page's body, or on a control no longer on
 * the page): where a person has put it themselves, it stays.
 */

/** How the form ended: closed, so focus goes back to where the person came from (Cancel,
 * Close, Escape), or answered by the server, so focus goes to the answer (a confirmation,
 * the held box a refusal turns into). */
export type FocusEnd = "back" | "answer";

/** What a form's answer is drawn as: a line marked for it, or a confirmation's line. */
export const FOCUS_ANSWERS = [
  "[data-focus-return]",
  '.ep-done[role="status"]',
  '.wz-done[role="status"]',
  // A list's own confirmation line, kept on the page and said anew (round 6: a viewer's
  // confirmed removal was said there, unfocused).
  '.ta-done[role="status"]',
  // A page's notice, when the change comes back with the page (E1, round 5).
  '.banner[role="status"]',
].join(", ");

/** How long an answer is waited for after the server answered: the refusal's held box is
 * drawn once the impact has been read again. */
export const ANSWER_WAIT_MS = 8000;

export type FocusCandidates<T> = {
  answer: T | null;
  opener: T | null;
  standIn: T | null;
  row: T | null;
};

/** The element focus goes to, by the rule above. */
export function focusReturnTarget<T>(
  end: FocusEnd,
  found: FocusCandidates<T>,
): T | null {
  return (
    (end === "answer" ? found.answer : null) ??
    found.opener ??
    found.standIn ??
    found.row
  );
}

/** Whether focus was lost: nowhere, on the page's body, or on an element taken off the
 * page. */
export function focusLost(
  active: { isConnected: boolean } | null,
  body: unknown,
): boolean {
  return active === null || active === body || !active.isConnected;
}

/** What a control is found again by once it is drawn anew: its kind and its name. */
export function controlKey(tag: string, name: string): string {
  return `${tag.toLowerCase()}:${name.trim().replace(/\s+/g, " ")}`;
}

/** A control focused earlier on the page, as the focus keeper remembers it. */
export type FocusSeen<T> = {
  element: T;
  /** Still on the page, shown and switched on. */
  usable: boolean;
  /** Left the page, and drawn again near where it was (same kind, same name), or null. */
  twin: T | null;
  /** The address the page had when it was focused. */
  href: string;
};

/**
 * Where the focus keeper gives focus back when a control took it with it as it left the
 * page (a form's Cancel, Escape, Close: every in-row form, on every screen; E1 design
 * review, round 8: Cancel on Planning's "Edit wording" left it on the page's body). The
 * newest entry is the control that left; the one before it still on the page (or drawn
 * again) is what opened the form. Nothing is done on another page, or where the newest
 * control is still on the page (the person clicked elsewhere).
 */
export function keeperTarget<T>(
  seen: ReadonlyArray<FocusSeen<T>>,
  href: string,
): T | null {
  const newest = seen.at(-1);
  if (newest === undefined || newest.usable || newest.href !== href) {
    return null;
  }
  for (let index = seen.length - 2; index >= 0; index -= 1) {
    const entry = seen[index];
    if (entry === undefined || entry.href !== href) {
      return null;
    }
    if (entry.usable) {
      return entry.element;
    }
    if (entry.twin !== null) {
      return entry.twin;
    }
  }
  return null;
}

/** The press that closes an in-row form, as Escape finds it: its Cancel or its Close. */
export function closesForm(label: string): boolean {
  return /^(cancel|close)$/i.test(label.replace(/\s+/g, " ").trim());
}

/** Where an in-row form ends, as Escape looks for its Cancel: a form, a confirm, an editor
 * or a change form (never past an open dialog: its own Escape closes it). */
export const ESCAPE_FORMS = [
  "form",
  '[role="alertdialog"]',
  ".pl-edit",
  ".change-form",
  ".move-confirm",
  "[data-escape-closes]",
].join(", ");

/** An open modal dialog, as an Escape on the page behind it looks for one. */
export const MODAL_OPEN =
  "dialog[open], [role='dialog'][aria-modal='true'], [role='alertdialog'][aria-modal='true']";

/** Whether an Escape closes the page's own panel: decided by what was open when the key
 * went down, not after the other listeners ran. A dialog closes itself on that same
 * Escape, and a panel that looked afterwards found no dialog and closed too: Escape in a
 * file's preview closed the step behind it, and focus fell to the page (E1 design review,
 * round 10). */
export function escapeGate(modalOpen: () => boolean): {
  /** On the key's way down (capture), before any dialog has acted. */
  press: (event: { key: string }) => void;
  /** On its way back (bubble): true when the page's panel should close. */
  acts: (event: {
    key: string;
    defaultPrevented: boolean;
    isComposing?: boolean;
  }) => boolean;
} {
  let inDialog = false;
  return {
    press: (event) => {
      if (event.key === "Escape") {
        inDialog = modalOpen();
      }
    },
    acts: (event) =>
      event.key === "Escape" &&
      !event.defaultPrevented &&
      event.isComposing !== true &&
      !inDialog,
  };
}

/** Calls `close` for an Escape the page's panel takes (escapeGate); returns the cleanup. */
export function onPageEscape(close: () => void): () => void {
  const gate = escapeGate(() => document.querySelector(MODAL_OPEN) !== null);
  const press = (event: KeyboardEvent) => gate.press(event);
  const onKey = (event: KeyboardEvent) => {
    if (gate.acts(event)) {
      close();
    }
  };
  window.addEventListener("keydown", press, true);
  window.addEventListener("keydown", onKey);
  return () => {
    window.removeEventListener("keydown", press, true);
    window.removeEventListener("keydown", onKey);
  };
}
