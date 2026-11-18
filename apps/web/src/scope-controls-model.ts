/**
 * The Controls tab as the one place controls are managed (decided by the product owner on
 * 26 October 2026): a system or a process opens it filtered to its own controls, the
 * filter stays visible and is cleared in one step, and the address keeps it.
 */

/** Asks the Controls tab to show one system's or process's controls; null shows all. */
export const CONTROLS_FILTER_EVENT = "aw:controls-filter";

export type ControlsFor = { kind: "system" | "process"; id: string };

/** The key a control row carries for each system and process it belongs to. */
export function scopeKey(filter: ControlsFor): string {
  return `${filter.kind}:${filter.id}`;
}

/** The filter an address names (`for=system:<id>` or `for=process:<id>`), or null. */
export function parseControlsFor(
  value: string | null | undefined,
): ControlsFor | null {
  const match = /^(system|process):([A-Za-z0-9_-]{1,64})$/.exec(value ?? "");
  if (match === null) {
    return null;
  }
  return { kind: match[1] as ControlsFor["kind"], id: match[2] ?? "" };
}

/** The keys of a control: its systems, then its named process or, for a standard
 * cycle's control, the cycle (a process row's id is its process, or its cycle). */
export function controlKeys(control: {
  applicationIds: readonly string[];
  processId: string | null;
  domain: string;
}): string[] {
  return [
    ...control.applicationIds.map((id) => `system:${id}`),
    control.processId !== null
      ? `process:${control.processId}`
      : `process:${control.domain}`,
  ];
}

/** Rows that belong to the filter; all of them with none. */
export function filterRows<T extends { keys: readonly string[] }>(
  rows: readonly T[],
  filter: ControlsFor | null,
): T[] {
  if (filter === null) {
    return [...rows];
  }
  const key = scopeKey(filter);
  return rows.filter((row) => row.keys.includes(key));
}

/** The address with the filter set, or cleared, the rest kept. */
export function withControlsFor(
  href: string,
  filter: ControlsFor | null,
): string {
  const url = new URL(href, "http://local");
  url.searchParams.delete("pane");
  if (filter === null) {
    url.searchParams.delete("for");
  } else {
    url.searchParams.set("for", scopeKey(filter));
  }
  return `${url.pathname}?${url.searchParams.toString()}`;
}
