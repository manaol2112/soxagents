/** Where a detail panel beside a list sits (decided by the product owner on 28 October
 * 2026: "is there any way to avoid any scrolling?"): never a scroll area of its own. A
 * panel that fits below the page's sticky bars stays in view as the list scrolls; a taller
 * one opens beside the item picked and scrolls with the page, read top to bottom. */

export type PanelPlacement =
  | { mode: "pinned"; offset: 0 }
  | { mode: "beside"; offset: number };

export function panelPlacement(input: {
  /** The panel's full height, everything in it shown. */
  panelHeight: number;
  /** The window's height, and how much of its top the sticky bars take. */
  viewportHeight: number;
  stickyTop: number;
  /** Where the picked item starts, from the top of the list, and the list's height. */
  itemTop: number;
  listHeight: number;
}): PanelPlacement {
  const room = input.viewportHeight - input.stickyTop - 12;
  if (input.panelHeight <= room) {
    return { mode: "pinned", offset: 0 };
  }
  // Beside the item, but never past the list's end, so the page grows no taller for it.
  const latest = Math.max(0, input.listHeight - input.panelHeight);
  return {
    mode: "beside",
    offset: Math.round(Math.max(0, Math.min(input.itemTop, latest))),
  };
}
