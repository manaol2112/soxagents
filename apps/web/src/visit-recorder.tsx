"use client";

import { useEffect } from "react";

import {
  keep,
  recordVisit,
  storedVisits,
  VISITS_KEY,
} from "./recent-engagements";

/** Notes in this browser that the engagement was opened, for the Recent tab. Renders
 * nothing. */
export function VisitRecorder({ projectId }: { projectId: string }) {
  useEffect(() => {
    keep(VISITS_KEY, recordVisit(storedVisits(), projectId, Date.now()));
  }, [projectId]);
  return null;
}
