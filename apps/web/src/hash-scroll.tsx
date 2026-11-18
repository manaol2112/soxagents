"use client";

import { useEffect } from "react";

/** A link to a part of the record (#step-…) lands on it: the page streams in after the
 * browser has looked for the anchor, so it is brought into view once rendered, opening
 * the fold that holds it. */
export function HashScroll() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id === "") {
      return;
    }
    const target = document.getElementById(id);
    if (target === null) {
      return;
    }
    const fold = target.closest("details");
    if (fold !== null) {
      fold.open = true;
    }
    target.scrollIntoView({ block: "start" });
  }, []);
  return null;
}
