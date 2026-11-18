"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";

import { guardedHref, leaving, linkScroll } from "./leave-guard";

/**
 * The page's router, asking first (docs/design-workpaper.md, section 3.4): going
 * somewhere else in the app goes through `leaving`, so an editor with changes that are
 * not in the workpaper can ask. `refresh` and `prefetch` take nobody anywhere and are
 * the router's own. Where nothing asks, it is the router as it was.
 */
export function useGuardedRouter(): ReturnType<typeof useRouter> {
  const router = useRouter();
  return useMemo(
    () => ({
      ...router,
      push: (...args: Parameters<typeof router.push>) =>
        leaving(() => router.push(...args)),
      replace: (...args: Parameters<typeof router.replace>) =>
        leaving(() => router.replace(...args)),
      back: () => leaving(() => router.back()),
      forward: () => leaving(() => router.forward()),
    }),
    [router],
  );
}

/**
 * Notes whether anything after the guard prevents the click's default: the link's own
 * `onClick` (React calls the native event's `preventDefault`), or a listener of its own.
 */
function noteOwnPrevent(event: Event): { prevented: boolean } {
  const seen = { prevented: false };
  const prevent = event.preventDefault.bind(event);
  Object.defineProperty(event, "preventDefault", {
    configurable: true,
    value: () => {
      seen.prevented = true;
      prevent();
    },
  });
  return seen;
}

/**
 * While `active`, a click on a link that would take the person elsewhere in the app is
 * held and asked about first; where they go on, the app goes there as the link would.
 * Every other click is left alone.
 *
 * Independent review, 15 November 2026: the click is held in the capture phase, before
 * `next/link`, which goes in its own `onClick` unless the default is already prevented, so
 * a bubble-phase listener would come too late for every `next/link`. Only the default is
 * prevented: the click goes on to the link's own handlers (the toolbar's layout links store
 * the layout, a row menu closes). Once the click is done, a link whose own handler
 * prevented the default has taken it, and is left alone; otherwise the way out is asked
 * about, keeping the scroll for a link to another view of this page (`linkScroll`).
 */
export function useGuardedLinks(active: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (!active) {
      return;
    }
    const onClick = (event: MouseEvent) => {
      const link =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (!(link instanceof HTMLAnchorElement)) {
        return;
      }
      const here = window.location.href;
      const href = guardedHref(
        event,
        {
          href: link.href,
          target: link.target,
          download: link.hasAttribute("download"),
        },
        here,
      );
      if (href === null) {
        return;
      }
      event.preventDefault();
      const own = noteOwnPrevent(event);
      const options = linkScroll(href, here);
      // After every handler of this click has run, whatever stopped it from bubbling.
      window.setTimeout(() => {
        if (!own.prevented) {
          leaving(() => router.push(href, options));
        }
      }, 0);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [active, router]);
}
