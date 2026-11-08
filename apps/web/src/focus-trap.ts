/**
 * Keyboard focus stays inside an open modal dialog (WCAG 2.2: 2.4.3 Focus Order and
 * 2.4.11 Focus Not Obscured; product owner, 2 November 2026): Tab past the last control
 * returns to the first, Shift+Tab before the first goes to the last. Pure: which control
 * to focus, and which open dialog keeps the focus; the hook in use-focus-trap.ts applies
 * them.
 */

/** What Tab can reach inside a dialog. */
export const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Where Tab goes, given how many controls the dialog holds and the index of the focused
 * one (-1 when focus is on the dialog itself or outside it): the index to focus, -1 for
 * the dialog itself when it holds none, or null to let the browser move on as usual.
 */
export function trapTarget(
  count: number,
  index: number,
  backwards: boolean,
): number | null {
  if (count === 0) {
    return -1;
  }
  if (index < 0 || index >= count) {
    return backwards ? count - 1 : 0;
  }
  if (!backwards && index === count - 1) {
    return 0;
  }
  if (backwards && index === 0) {
    return count - 1;
  }
  return null;
}

/** Whether this dialog keeps the focus: the last open modal in the page's order, so a
 * dialog opened over another (a confirmation, Add supporting documentation over the
 * setup) takes it, and the one beneath leaves it alone. */
export function isTopmost<T>(open: readonly T[], mine: T): boolean {
  return open.length === 0 || open[open.length - 1] === mine;
}
