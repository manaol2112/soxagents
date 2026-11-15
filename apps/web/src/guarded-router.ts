"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";

import { guardedHref, leaving } from "./leave-guard";

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
 * While `active`, a click on a link that would take the person elsewhere in the app is
 * held and asked about first; where they go on, the app goes there as the link would.
 * Every other click is left alone.
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
      const href = guardedHref(
        event,
        {
          href: link.href,
          target: link.target,
          download: link.hasAttribute("download"),
        },
        window.location.href,
      );
      if (href === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      leaving(() => router.push(href));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [active, router]);
}
