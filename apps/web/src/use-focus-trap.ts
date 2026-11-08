import { type RefObject, useEffect } from "react";

import { FOCUSABLE, isTopmost, trapTarget } from "./focus-trap";

function shown(element: HTMLElement): boolean {
  return (
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== "hidden"
  );
}

function openModals(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"], dialog[open]',
    ),
  ].filter(shown);
}

/** Whether this dialog is the topmost open one, so Escape closes it and not the one
 * beneath (a dialog with no element yet keeps its own handling). */
export function isTopmostDialog(box: HTMLElement | null): boolean {
  return box === null || isTopmost(openModals(), box);
}

/**
 * Keeps keyboard focus inside the modal dialog `ref` points at while it is open: Tab
 * and Shift+Tab wrap around its controls instead of reaching the page behind the
 * backdrop. Only the topmost open modal does so (focus-trap.ts).
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active = true,
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented) {
        return;
      }
      const box = ref.current;
      if (box === null) {
        return;
      }
      if (!isTopmost(openModals(), box)) {
        return;
      }
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        shown,
      );
      const focused = document.activeElement;
      const index =
        focused instanceof HTMLElement ? items.indexOf(focused) : -1;
      const next = trapTarget(items.length, index, event.shiftKey);
      if (next === null) {
        return;
      }
      event.preventDefault();
      (next < 0 ? box : (items[next] ?? box)).focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ref, active]);
}
