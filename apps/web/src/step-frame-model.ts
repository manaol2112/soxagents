/**
 * The step drawer's frame, read for its layout (product owner, 11 November 2026: one
 * minimalist layout for every step's panel, except Control Understanding, which keeps its
 * own). The header's kind and branch label and its one status, the quiet line where nothing
 * is needed from the person, and the footer's "Based on" and "Next". Pure, so the drawer only
 * draws what is decided here.
 */

import {
  GROUPS,
  KIND_LABELS,
  type Kind,
  STEPS,
  type StepKey,
  TONE_LABELS,
  type Tone,
} from "./control-workflow-model.ts";
import type { PanelLink, PanelNeed } from "./step-panel-model.ts";

/** The step whose panel keeps the layout it had before (product owner, 11 November 2026:
 * "Except for the control understanding, don't change that for now"). */
export const KEEPS_OWN_LAYOUT: StepKey = "understanding";

/** Whether a step's panel takes the minimalist layout. */
export function takesMinimalLayout(key: StepKey): boolean {
  return key !== KEEPS_OWN_LAYOUT;
}

const pad = (n: number) => String(n).padStart(2, "0");

export type PanelHead = {
  key: StepKey;
  number: number;
  kind: Kind;
  /** "Step 03 · Human gate", with "· D&I branch" or "· OE branch" in a branch. */
  label: string;
};

/** The line above a step's title: its number, its kind, and its branch where it has one. */
export function headLabel(key: StepKey): string {
  const at = STEPS.findIndex((item) => item.key === key);
  const meta = STEPS[at];
  if (meta === undefined) {
    return "";
  }
  const branch =
    meta.group === "design" || meta.group === "operating"
      ? GROUPS.find((group) => group.key === meta.group)?.label
      : undefined;
  return [
    `Step ${pad(at + 1)}`,
    KIND_LABELS[meta.kind],
    ...(branch !== undefined ? [branch] : []),
  ].join(" · ");
}

/**
 * The step a drawer's kicker names. The workspace writes it as "03 · Human gate" (the step's
 * number and kind), and "Record" for the activity, which is no step: null then, and null for
 * a kicker whose number and kind do not agree with the workflow.
 */
export function panelHeadOf(kicker: string): PanelHead | null {
  const match = /^(\d{1,2}) · (.+)$/.exec(kicker.trim());
  if (match === null) {
    return null;
  }
  const number = Number(match[1]);
  const meta = STEPS[number - 1];
  if (meta === undefined || KIND_LABELS[meta.kind] !== match[2]) {
    return null;
  }
  return {
    key: meta.key,
    number,
    kind: meta.kind,
    label: headLabel(meta.key),
  };
}

/** The step a drawer shows, from its key (the workspace passes it; the kicker is only a
 * fallback for a caller that does not). */
export function panelHeadFor(key: string | null | undefined): PanelHead | null {
  const at = STEPS.findIndex((item) => item.key === key);
  const meta = STEPS[at];
  if (at < 0 || meta === undefined) {
    return null;
  }
  return {
    key: meta.key,
    number: at + 1,
    kind: meta.kind,
    label: headLabel(meta.key),
  };
}

/** The header's one status: the step's own words, or its tone's where it has none. */
export function statusPill(
  tone: Tone,
  status: string,
): { label: string; tone: Tone } {
  const label = status.trim();
  return { label: label === "" ? TONE_LABELS[tone] : label, tone };
}

export type QuietLine = {
  text: string;
  /** The agent is working: the line takes the reading treatment. */
  working: boolean;
  /** The step it waits on, to open. */
  link?: { label: string; step: StepKey };
};

/**
 * What the panel says where the step needs nothing from the person: one sentence, in place
 * of the decision row. Null where the person acts or something needs attention: those take
 * the decision row. Never the step's status again: the header's pill carries it.
 */
export function quietLineOf(need: PanelNeed): QuietLine | null {
  switch (need.kind) {
    case "act":
    case "flag":
      return null;
    case "done":
      return { text: "Nothing is needed from you here.", working: false };
    case "agent":
      return { text: need.detail, working: true };
    case "wait":
      return {
        text: need.detail,
        working: false,
        ...(need.action?.step !== undefined
          ? { link: { label: need.action.label, step: need.action.step } }
          : {}),
      };
    case "skipped":
      return { text: need.detail, working: false };
  }
}

/** A step as the footer names it: by its title alone, "Control Understanding". The header
 * and the canvas carry the step's number; in the footer the numbers ran across both branches
 * and read as a jump ("Next · 04 D&I Evidence", "Next · 07 Scope & Sampling"; product owner,
 * 12 November 2026: "the numbers here are not good. From 4 to 7?"). */
export function stepName(link: Pick<PanelLink, "title">): string {
  return link.title;
}

/**
 * The footer's "Based on": the first step this one rests on, with its status, and the
 * others as a count. Null for a step that rests on none (the setup).
 */
export function basedOnSummary(basedOn: readonly PanelLink[]): {
  first: PanelLink;
  label: string;
  more: PanelLink[];
} | null {
  const [first, ...more] = basedOn;
  if (first === undefined) {
    return null;
  }
  return {
    first,
    label: `${stepName(first)} · ${first.status}`,
    more,
  };
}

/** The branch a step sits in, as the workflow labels it ("D&I branch"), or null. */
function branchOf(key: StepKey): string | null {
  const group = STEPS.find((item) => item.key === key)?.group;
  return group === "design" || group === "operating"
    ? (GROUPS.find((each) => each.key === group)?.label ?? null)
    : null;
}

/** The footer's "Next": each step that follows, with the outcome it follows on where the
 * step decides ("If effective"). Where the work splits into both branches at once, as after
 * the attributes, each says its branch ("D&I branch · D&I Evidence"). */
export function nextLinks(
  next: ReadonlyArray<PanelLink & { when: string }>,
): Array<{ key: StepKey; label: string; title: string }> {
  const branches = new Set(next.map((item) => branchOf(item.key)));
  const forks = next.length > 1 && branches.size > 1;
  return next.map((item) => ({
    key: item.key,
    label:
      item.when !== ""
        ? item.when
        : forks
          ? (branchOf(item.key) ?? "Next")
          : "Next",
    title: stepName(item),
  }));
}
