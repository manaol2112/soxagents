"use client";

import { useSyncExternalStore } from "react";

const OPTIONS = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
} as const;
const UTC = new Intl.DateTimeFormat("en-US", { ...OPTIONS, timeZone: "UTC" });
const LOCAL = new Intl.DateTimeFormat("en-US", OPTIONS);

const subscribe = () => () => {};

/**
 * A moment in the viewer's own time ("Nov 12, 12:07 PM"). The server does not know the
 * viewer's time zone, so it and the first client render both write the UTC time, and
 * the viewer's own replaces it once the page is live: the two renders never disagree
 * (the hydration error on the D&I list's activity, 12 November 2026).
 */
export function LocalTime({ at }: { at: string }) {
  const live = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const time = Date.parse(at);
  if (Number.isNaN(time)) {
    return <time>{at}</time>;
  }
  return (
    <time dateTime={at}>
      {live ? LOCAL.format(time) : `${UTC.format(time)} UTC`}
    </time>
  );
}
