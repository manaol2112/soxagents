"use client";

import { useEffect, useState } from "react";

import {
  type PopulationPage,
  parsePopulationPage,
} from "./evidence-dialog-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string };

/** The population as a table: paged, searchable, and, when picking a walkthrough
 * instance, a row to choose. */
export function DataTable({
  ids,
  fileId,
  compact = false,
  onAll,
  picking,
  chosenRow,
  busy,
  onPick,
  onCancel,
}: {
  ids: Ids;
  fileId: string;
  /** The first rows only, as the Preview shows a table; the Data view has the rest. */
  compact?: boolean;
  onAll?: () => void;
  picking: boolean;
  chosenRow: number | null;
  busy: boolean;
  onPick: (row: number) => void;
  onCancel: () => void;
}) {
  const [page, setPage] = useState<PopulationPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [offset, setOffset] = useState(0);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [row, setRow] = useState<number | null>(chosenRow);
  const limit = compact ? 8 : 25;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(typed);
      setOffset(0);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [typed]);
  useEffect(() => {
    // The latest request wins: an answer to an earlier page or search is dropped.
    let current = true;
    const query = new URLSearchParams({
      organization: ids.organizationId,
      project: ids.projectId,
      file: fileId,
      offset: String(offset),
      limit: String(limit),
      search,
    });
    fetch(`/workspace/evidence-dialog?${query}`)
      .then((response) => response.json())
      .then((body: { status?: unknown; result?: unknown }) => {
        if (!current) {
          return;
        }
        const parsed =
          body.status === 200 ? parsePopulationPage(body.result) : null;
        setPage(parsed);
        setFailed(parsed === null);
      })
      .catch(() => {
        if (current) {
          setFailed(true);
        }
      });
    return () => {
      current = false;
    };
  }, [ids.organizationId, ids.projectId, fileId, offset, search, limit]);

  if (failed) {
    return (
      <p className="ed-quiet">
        The file could not be read as a table. Open the preview instead.
      </p>
    );
  }
  if (page === null) {
    return (
      <p className="ed-quiet">
        <span className="spinner small" aria-hidden="true" /> Reading the rows…
      </p>
    );
  }
  return (
    <div className="ed-data">
      {picking ? (
        <p className="ed-pick-note" role="status">
          Pick the instance to walk through, then upload its evidence. Search by
          ID or name to find it.
        </p>
      ) : null}
      {compact ? null : (
        <div className="ed-data-bar">
          <label className="ed-data-search">
            <UiIcon name="search" size={14} />
            <span className="sr-only">Search the rows</span>
            <input
              type="search"
              value={typed}
              placeholder="Search the rows…"
              onChange={(event) => setTyped(event.target.value)}
            />
          </label>
          <small>
            {page.matched === page.total
              ? `${page.total.toLocaleString()} rows`
              : `${page.matched.toLocaleString()} of ${page.total.toLocaleString()} rows`}
            {page.keyColumn ? ` · key ${page.keyColumn}` : ""}
          </small>
        </div>
      )}
      <div className="ed-table-wrap">
        <table className="ed-table">
          <thead>
            <tr>
              {picking ? <th aria-label="Pick" /> : null}
              {compact ? null : <th>#</th>}
              {page.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((entry) => (
              <tr
                key={entry.rowNumber}
                className={
                  entry.rowNumber === row || entry.rowNumber === chosenRow
                    ? "is-on"
                    : undefined
                }
              >
                {picking ? (
                  <td>
                    <input
                      type="radio"
                      name="ed-row"
                      aria-label={`Pick row ${entry.rowNumber}`}
                      checked={row === entry.rowNumber}
                      onChange={() => setRow(entry.rowNumber)}
                    />
                  </td>
                ) : null}
                {compact ? null : (
                  <td className="ed-row-no">{entry.rowNumber}</td>
                )}
                {page.columns.map((column, index) => (
                  <td key={column}>{entry.values[index] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {compact ? (
        <div className="ed-data-foot">
          <small>
            Showing {Math.min(limit, page.total)} of{" "}
            {page.total.toLocaleString()} rows
          </small>
          {onAll !== undefined && page.total > limit ? (
            <button type="button" className="btn-ghost btn-sm" onClick={onAll}>
              View all rows
            </button>
          ) : null}
        </div>
      ) : (
        <div className="ed-data-foot">
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
          >
            Previous
          </button>
          <small>
            {page.matched === 0
              ? "Nothing matches"
              : `${offset + 1}–${Math.min(offset + limit, page.matched)} of ${page.matched.toLocaleString()}`}
          </small>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={offset + limit >= page.matched}
            onClick={() => setOffset(offset + limit)}
          >
            Next
          </button>
          {picking ? (
            <span className="ed-data-pick">
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={row === null || busy}
                onClick={() => row !== null && onPick(row)}
              >
                {busy ? (
                  <span className="spinner small" aria-hidden="true" />
                ) : null}
                Use row {row ?? ""} as the walkthrough instance
              </button>
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
