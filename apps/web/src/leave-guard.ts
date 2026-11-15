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
