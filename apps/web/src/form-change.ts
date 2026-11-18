/**
 * Whether a form holds changes not yet saved: its fields as they would be sent, compared
 * with the same fields when the page showed them. Order within a name is kept (a list of
 * choices); the order of names is not, so a re-render cannot read as a change.
 */
export function formSignature(
  entries: Iterable<[string, FormDataEntryValue]>,
): string {
  const values = new Map<string, string[]>();
  for (const [name, value] of entries) {
    // A file is a change by being chosen; its name stands for it.
    const text = typeof value === "string" ? value : `file:${value.name}`;
    values.set(name, [...(values.get(name) ?? []), text]);
  }
  return JSON.stringify(
    [...values.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
}
