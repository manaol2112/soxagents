"use client";

import { useEffect } from "react";

/** Keeps the page as the person's last on their account, so the workspace opens here
 * next time, on any computer. Renders nothing. */
export function LastPageRecorder({ path }: { path: string }) {
  useEffect(() => {
    // A moment on the page first: passing through on the way elsewhere is not kept.
    const timer = window.setTimeout(() => {
      void fetch("/workspace/last-page", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
        keepalive: true,
      }).catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [path]);
  return null;
}
