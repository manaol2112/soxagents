"use client";

import { Fragment, type ReactNode, useEffect, useId, useState } from "react";

import { UiIcon } from "./ui-icon";

export type ScopeTableRow = {
  id: string;
  /** The row's cells, rendered on the server, in the order of the columns. */
  cells: ReactNode[];
  /** What the search reads: the row's words. */
  text: string;
  /** The value the filter matches, such as a system's type. */
  kind: string;
  /** What opens under the row, rendered on the server. */
  detail: ReactNode;
};

/**
 * The systems or the processes in scope as a table (decided by the product owner, the
 * Systems & Processes reference): searched and filtered in the page, each row opening in
 * place under itself, one at a time, without a page load.
 */
export function ScopeTable({
  label,
  columns,
  rows,
  kinds,
  kindLabel,
  searchLabel,
  action = null,
  initial = null,
  empty = null,
}: {
  label: string;
  columns: string[];
  rows: ScopeTableRow[];
  /** The filter's choices, as value and words; none hides the filter. */
  kinds: ReadonlyArray<readonly [string, string]>;
  kindLabel: string;
  searchLabel: string;
  action?: ReactNode;
  /** The row open when the page loads, such as the one a link names. */
  initial?: string | null;
  /** What an empty table says when it holds no rows at all (a search says its own). */
  empty?: string | null;
}) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [open, setOpen] = useState<string | null>(initial);
  // The search waits for a pause in typing.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(typed), 150);
    return () => window.clearTimeout(timer);
  }, [typed]);
  const words = query.trim().toLowerCase();
  const shown = rows.filter(
    (row) =>
      (kind === "" || row.kind === kind) &&
      (words === "" || row.text.toLowerCase().includes(words)),
  );
  return (
    <section className="card st" aria-labelledby={`${id}-title`}>
      <header className="st-head">
        <h2 id={`${id}-title`}>
          {label} <span>({rows.length})</span>
        </h2>
        <div className="st-tools">
          <label className="st-search">
            <UiIcon name="search" size={14} />
            <input
              type="search"
              value={typed}
              placeholder={searchLabel}
              aria-label={searchLabel}
              onChange={(event) => setTyped(event.target.value)}
            />
          </label>
          {kinds.length > 1 ? (
            <label className="st-filter">
              <UiIcon name="filter" size={14} />
              <select
                value={kind}
                aria-label={kindLabel}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="">Filter</option>
                {kinds.map(([value, words]) => (
                  <option key={value} value={value}>
                    {words}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {action}
        </div>
      </header>
      <div className="st-scroll">
        <table className="st-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
              <th scope="col">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const isOpen = row.id === open;
              const detailId = `${id}-${row.id}`;
              return (
                <Fragment key={row.id}>
                  <tr
                    className={`st-row${isOpen ? " is-open" : ""}`}
                    onClick={() => setOpen(isOpen ? null : row.id)}
                  >
                    {row.cells.map((cell, at) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: the row's columns, in order
                      <td key={at} data-label={columns[at]}>
                        {cell}
                      </td>
                    ))}
                    <td className="st-open">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={detailId}
                        aria-label={`${isOpen ? "Close" : "Open"} ${row.text.split("\n")[0]}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpen(isOpen ? null : row.id);
                        }}
                      >
                        <UiIcon name="chevron" size={15} />
                      </button>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="st-detail" id={detailId}>
                      <td colSpan={columns.length + 1}>{row.detail}</td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length === 0 ? (
        <p className="st-none">
          {rows.length === 0 && empty !== null ? (
            empty
          ) : (
            <>
              Nothing matches the search
              {kind === "" ? "" : " and the filter"}.
            </>
          )}
        </p>
      ) : null}
    </section>
  );
}
