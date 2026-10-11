"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refreshes the page while an agent works in the background, then stops. */
export function AutoRefresh({
  seconds = 3,
  limit = 40,
}: {
  seconds?: number;
  limit?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      if (count > limit) {
        window.clearInterval(timer);
        return;
      }
      router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [router, seconds, limit]);
  return null;
}
