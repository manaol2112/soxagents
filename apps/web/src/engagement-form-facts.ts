"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { GuideClient, GuideFacts } from "./engagement-guide-model";

/** The New engagement form's id, shared by the guide, the agent panel, and the cycle. */
export const ENGAGEMENT_FORM_ID = "engagement-form";
/** Opens the guided tour from anywhere on the page. */
export const OPEN_GUIDE_EVENT = "aw:open-engagement-guide";

export type FactsBase = {
  clients: readonly GuideClient[];
};

/** The form as it stands, read from the page. */
export function readEngagementForm(base: FactsBase): GuideFacts {
  const form = document.getElementById(ENGAGEMENT_FORM_ID);
  const data = form instanceof HTMLFormElement ? new FormData(form) : null;
  const text = (key: string) => {
    const value = data?.get(key);
    return typeof value === "string" ? value : "";
  };
  const lead = document.getElementById("create-owner");
  const clientId = text("client_id");
  const newName = form?.querySelector(
    'input[name="client_name"]:not([type="hidden"])',
  );
  return {
    ...base,
    client:
      clientId !== ""
        ? { kind: "existing", id: clientId }
        : newName instanceof HTMLInputElement
          ? { kind: "new", name: newName.value }
          : null,
    startFrom: text("rollforward_from"),
    name: text("name"),
    periodEnd: text("period_end"),
    leadName:
      lead instanceof HTMLSelectElement
        ? (lead.selectedOptions[0]?.textContent ?? "")
        : "",
    methodology: text("methodology"),
    scope: text("scope"),
  };
}

/**
 * The form's facts, kept current: read again after anything is entered or chosen (once
 * React has drawn it, since some fields are set by the page's own components).
 */
export function useEngagementFacts(
  base: FactsBase,
  active = true,
): GuideFacts | null {
  const [facts, setFacts] = useState<GuideFacts | null>(null);
  const latest = useRef(base);
  latest.current = base;
  const refresh = useCallback(() => {
    setFacts(readEngagementForm(latest.current));
  }, []);
  useEffect(() => {
    if (!active) {
      return;
    }
    refresh();
    const form = document.getElementById(ENGAGEMENT_FORM_ID);
    let timer = 0;
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, 60);
    };
    for (const type of ["input", "change", "click"]) {
      form?.addEventListener(type, later);
    }
    return () => {
      window.clearTimeout(timer);
      for (const type of ["input", "change", "click"]) {
        form?.removeEventListener(type, later);
      }
    };
  }, [active, refresh]);
  return facts;
}
