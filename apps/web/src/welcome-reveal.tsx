"use client";

import { useEffect } from "react";

/** Adds `is-in` to each `[data-reveal]` element as it scrolls into view. */
export function WelcomeReveal() {
  useEffect(() => {
    const items = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
    if (
      items.length === 0 ||
      !("IntersectionObserver" in window) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      for (const item of items) {
        item.classList.add("is-in");
      }
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
    );
    for (const item of items) {
      observer.observe(item);
    }
    return () => observer.disconnect();
  }, []);
  return null;
}
