"use client";

import { useEffect } from "react";

/** On a narrow screen the workspace navigation is one row that scrolls sideways: bring
 * the current page into view, so it is never hidden off the edge. */
export function NavScroll() {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(".sidebar nav");
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (
      nav === null ||
      nav === undefined ||
      current === null ||
      current === undefined
    ) {
      return;
    }
    if (nav.scrollWidth <= nav.clientWidth) {
      return;
    }
    const offset =
      current.getBoundingClientRect().left -
      nav.getBoundingClientRect().left +
      nav.scrollLeft;
    nav.scrollLeft = Math.max(
      0,
      offset - (nav.clientWidth - current.offsetWidth) / 2,
    );
  }, []);
  return null;
}
