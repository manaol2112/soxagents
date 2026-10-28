/** After a system is added, the offer to select its controls (the product owner's
 * reference, 27 October 2026): which system was added, and where its controls open. */

import { SELECT_CONTROLS_EVENT } from "./controls-guide-model.ts";
import { inScopeSystems, type Onboarding } from "./onboarding-model.ts";
import { workspaceHref } from "./shell-model.ts";

export type AddedSystem = { id: string; name: string };

/** The system the save added: in scope now, absent before, and named as entered. Null
 * when the answer does not show it (the page then refreshes without the offer). */
export function addedSystem(
  before: readonly { id: string }[],
  after: Onboarding | null,
  name: string,
): AddedSystem | null {
  if (after === null) {
    return null;
  }
  const known = new Set(before.map((system) => system.id));
  const wanted = name.trim().toLowerCase();
  const added = inScopeSystems(after).filter((system) => !known.has(system.id));
  const match =
    added.find((system) => system.name.trim().toLowerCase() === wanted) ??
    (added.length === 1 ? added[0] : undefined);
  return match === undefined ? null : { id: match.id, name: match.name };
}

/** The Controls page filtered to the system, where its controls are selected. */
export function mapControlsHref(
  organizationId: string,
  projectId: string,
  systemId: string,
): string {
  return `${workspaceHref("register", organizationId, projectId)}&for=system:${systemId}`;
}

/** The detail Map controls sends: the system just added, which the page may not list
 * until it has refreshed. Any other opener names a target the page already lists. */
export type AwaitedTarget = { awaiting: string };

/** Asks the page's Select controls to open on the system, in place (decided by the
 * product owner on 27 October 2026). True when a Select controls on the page took it;
 * false when none is there, and the Controls page is opened instead. */
export function openSelectControls(on: EventTarget, systemId: string): boolean {
  const detail: AwaitedTarget = { awaiting: systemId };
  return !on.dispatchEvent(
    new CustomEvent(SELECT_CONTROLS_EVENT, { detail, cancelable: true }),
  );
}

/** What Select controls opens on: the target its opener named, else the first; for a
 * system just added (Map controls), nothing until the refreshed page lists it. */
export function selectTargetFor<T extends { id: string }>(
  targets: readonly T[],
  named: unknown,
): { wait: true } | { wait: false; target: T | null } {
  if (
    typeof named === "object" &&
    named !== null &&
    typeof (named as AwaitedTarget).awaiting === "string"
  ) {
    const target = targets.find(
      (item) => item.id === (named as AwaitedTarget).awaiting,
    );
    return target === undefined ? { wait: true } : { wait: false, target };
  }
  const target = targets.find((item) => item.id === named);
  return { wait: false, target: target ?? targets[0] ?? null };
}
