// Asking before a person leaves with changes that are not in the workpaper
// (docs/design-workpaper.md, section 3.4). One asker at a time: the open editor sets it
// while it has such changes, and whatever would take the person elsewhere in the app
// (a link, the step switcher, the control switcher) goes through `leaving`. Pure: no
// router, no DOM. The browser's own Back button and a closed tab do not come this way
// (the working copy is kept, and the browser's own prompt covers what is not yet).

/** Asked with what to do if the person goes on: it calls `proceed` then, or never. */
export type LeaveAsker = (proceed: () => void) => void;

let asker: LeaveAsker | null = null;

/** Sets the asker; the function returned unsets it, if it is still the one set. */
export function setLeaveAsker(next: LeaveAsker): () => void {
  asker = next;
  return () => {
    if (asker === next) {
      asker = null;
    }
  };
}

export function hasLeaveAsker(): boolean {
  return asker !== null;
}

/** Goes on at once where nothing asks; otherwise the asker decides. */
export function leaving(proceed: () => void): void {
  if (asker === null) {
    proceed();
  } else {
    asker(proceed);
  }
}

/**
 * Where a click on a link would take the person, if that is somewhere else in the app
 * that the open editor should ask about; null where the click is not that: another
 * button or a modified click (a new tab or window), a link that opens elsewhere or
 * downloads, another site, the app's own data routes under /workspace/ (a download, a
 * preview: the page stays), or a place on this same page.
 */
export function guardedHref(
  click: {
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    defaultPrevented: boolean;
  },
  link: { href: string; target: string; download: boolean },
  here: string,
): string | null {
  if (
    click.defaultPrevented ||
    click.button !== 0 ||
    click.metaKey ||
    click.ctrlKey ||
    click.shiftKey ||
    click.altKey ||
    link.download ||
    (link.target !== "" && link.target !== "_self")
  ) {
    return null;
  }
  let to: URL;
  let from: URL;
  try {
    from = new URL(here);
    to = new URL(link.href, from);
  } catch {
    return null;
  }
  if (
    (to.protocol !== "http:" && to.protocol !== "https:") ||
    to.origin !== from.origin ||
    to.pathname.startsWith("/workspace/") ||
    (to.pathname === from.pathname && to.search === from.search)
  ) {
    return null;
  }
  return `${to.pathname}${to.search}${to.hash}`;
}

/**
 * Whether the open editor asks before the person goes (independent review, 15 November
 * 2026): while it has changes that are not in the workpaper, while a save of them is out
 * (the person is not let go before the server answered), and while the dialog is open.
 */
export function guarding(open: {
  phase: "editing" | "saving" | "refreshing";
  changed: boolean;
  asking: boolean;
}): boolean {
  return (
    open.asking ||
    open.phase === "saving" ||
    (open.phase === "editing" && open.changed)
  );
}

/** What a way out does when it is asked about: opens the dialog, or, while a save is out
 * and the dialog is not open, waits for the save's answer (it goes on once the server
 * confirmed the save; a refusal opens the dialog with it). */
export function whenAsked(open: {
  phase: "editing" | "saving" | "refreshing";
  asking: boolean;
}): "ask" | "after-save" {
  return !open.asking && open.phase === "saving" ? "after-save" : "ask";
}

/** How a held link goes once the person goes on: a link to another view of this same page
 * (only its query changes, as the step switcher's, the panel's and the toolbar's links do)
 * keeps the scroll where it is, as those links are written with `scroll={false}`. */
export function linkScroll(href: string, here: string): { scroll: boolean } {
  try {
    const from = new URL(here);
    return { scroll: new URL(href, from).pathname !== from.pathname };
  } catch {
    return { scroll: true };
  }
}
