"use client";

import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useId,
  useState,
  useTransition,
} from "react";

import {
  batchProblem,
  outcomeLine,
  parseSubmitResult,
} from "./controls-batch-model";
import {
  type ActionItem,
  agentText,
  evidenceText,
  nextDue,
  rowState,
  type Sort,
  TABLE_COLUMNS,
  type TableColumn,
  tableColumns,
} from "./controls-register-model";
import { LAYOUT_KEY } from "./controls-toolbar";
import { CATEGORIES, type ControlRow } from "./engagement-model";
import { formatDate } from "./format";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string };

async function post(fields: Record<string, unknown>): Promise<{
  status: number;
  result: unknown;
}> {
  try {
    const response = await fetch("/workspace/controls-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields),
    });
    const body = (await response.json()) as {
      status?: unknown;
      result?: unknown;
    };
    return {
      status: typeof body.status === "number" ? body.status : 0,
      result: body.result ?? null,
    };
  } catch {
    return { status: 0, result: null };
  }
}

/** Submit drafted requests for approval together, after one confirmation. Each request
 * still gets its own approval; what could not go is said, with why. */
function SubmitBatch({
  ids,
  items,
  label,
}: {
  ids: Ids;
  items: Array<{ requestId: string; version: number }>;
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<{ text: string; ok: boolean } | null>(null);
  async function run() {
    setBusy(true);
    const answer = await post({
      intent: "submit",
      organization_id: ids.organizationId,
      project_id: ids.projectId,
      items: items.map((item) => ({
        request_id: item.requestId,
        version: item.version,
      })),
    });
    setBusy(false);
    setConfirming(false);
    const outcome =
      answer.status === 200 ? parseSubmitResult(answer.result) : null;
    setLine(
      outcome !== null
        ? { text: outcomeLine(outcome), ok: outcome.failed === 0 }
        : { text: batchProblem(answer.status) ?? "", ok: false },
    );
    startTransition(() => router.refresh());
  }
  if (items.length === 0) {
    return null;
  }
  return (
    <span className="co-batch" aria-busy={busy || pending}>
      {confirming ? (
        <>
          <span className="co-confirm">
            Submit {items.length} request{items.length === 1 ? "" : "s"}? Each
            goes to an approver; nothing is sent before it is approved.
          </span>
          <button
            type="button"
            className="btn-sm"
            disabled={busy}
            onClick={run}
          >
            {busy ? "Submitting…" : "Submit"}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn-sm"
          disabled={pending}
          onClick={() => {
            setLine(null);
            setConfirming(true);
          }}
        >
          {label}
        </button>
      )}
      {line !== null ? (
        <span
          className={`co-outcome${line.ok ? "" : " is-partial"}`}
          role="status"
        >
          {line.text}
        </span>
      ) : null}
    </span>
  );
}

/**
 * What needs a person across the register, most pressing first, each once. A batch of
 * drafted requests is one item with one action; the rest open the controls they concern.
 */
export function ActionCenter({
  ids,
  items,
  hrefs,
}: {
  ids: Ids;
  items: ActionItem[];
  /** Where each item opens, by its key. */
  hrefs: Record<string, string>;
}) {
  return (
    <section className="co-card co-actions" aria-labelledby="co-actions-title">
      <h2 id="co-actions-title" className="co-card-title">
        Needs attention
        <span className="co-count">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="co-calm">
          <UiIcon name="check" size={14} />
          Nothing needs a person right now.
        </p>
      ) : (
        <ul className="co-action-list">
          {items.map((item) => (
            <li key={item.key} className={`is-${item.tone}`}>
              <span className="co-action-mark" aria-hidden="true">
                <UiIcon
                  name={item.tone === "alert" ? "risk" : "info"}
                  size={13}
                />
              </span>
              <span className="co-action-text">
                <a href={hrefs[item.key]}>{item.title}</a>
                <small>{item.detail}</small>
              </span>
              {item.batch !== null && item.batch.length > 0 ? (
                <SubmitBatch ids={ids} items={item.batch} label="Submit all" />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A register row with its details on request: the main line always, the rest when
 * opened. */
export function ExpandableRow({
  className,
  label,
  main,
  more,
}: {
  className: string;
  label: string;
  main: ReactNode;
  more: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className={`${className}${open ? " is-expanded" : ""}`}>
      {main}
      <button
        type="button"
        className="cr-expand"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${open ? "Hide" : "Show"} details: ${label}`}
        onClick={() => setOpen(!open)}
      >
        <UiIcon name="chevron" size={14} />
      </button>
      <div id={id} className="cr-more" hidden={!open}>
        {more}
      </div>
    </li>
  );
}

/** On the register without a chosen view, open the one the person last chose. */
export function LayoutMemory({ tableHref }: { tableHref: string }) {
  const router = useRouter();
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(LAYOUT_KEY);
    } catch {
      saved = null;
    }
    if (saved === "table") {
      router.replace(tableHref, { scroll: false });
    }
  }, [router, tableHref]);
  return null;
}

const COLUMNS_KEY = "aw.controls.columns";
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES);
const PAGE = 100;

export type TableLink = {
  open: string;
  /** The viewer's next step, when it is theirs. */
  step: { label: string; href: string } | null;
};

/**
 * The register as one table for working at scale: columns a person chooses, sortable
 * headings, and selection for the batch actions, which run each control through its own
 * checks. Rows come a hundred at a time.
 */
export function ControlsTable({
  ids,
  rows,
  links,
  sortHrefs,
  sort,
  canSubmit,
  canAssign,
}: {
  ids: Ids;
  rows: ControlRow[];
  links: Record<string, TableLink>;
  sortHrefs: Record<Sort, string>;
  sort: Sort;
  canSubmit: boolean;
  canAssign: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [columns, setColumns] = useState<TableColumn[]>(tableColumns(null));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [assigning, setAssigning] = useState(false);
  const [owner, setOwner] = useState({ name: "", email: "" });
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(
    null,
  );
  const id = useId();
  useEffect(() => {
    try {
      setColumns(tableColumns(window.localStorage.getItem(COLUMNS_KEY)));
    } catch {
      // The standard columns stand.
    }
  }, []);
  const choose = (key: TableColumn, on: boolean) => {
    const next = TABLE_COLUMNS.filter((column) =>
      column.key === key ? on : columns.includes(column.key),
    ).map((column) => column.key);
    if (next.length === 0) {
      return;
    }
    setColumns(next);
    try {
      window.localStorage.setItem(COLUMNS_KEY, next.join(","));
    } catch {
      // Kept for this page only.
    }
  };
  const shown = rows.slice(0, limit);
  const allShown =
    shown.length > 0 && shown.every((row) => selected.has(row.id));
  const picked = rows.filter((row) => selected.has(row.id));
  const drafts = picked.flatMap((row) =>
    row.requests
      .filter((request) => request.status === "DRAFT")
      .map((request) => ({ requestId: request.id, version: request.version })),
  );
  const toggle = (rowId: string, on: boolean) => {
    const next = new Set(selected);
    if (on) {
      next.add(rowId);
    } else {
      next.delete(rowId);
    }
    setSelected(next);
  };
  async function assign() {
    const answer = await post({
      intent: "owner",
      organization_id: ids.organizationId,
      project_id: ids.projectId,
      control_ids: picked.map((row) => row.id),
      owner_name: owner.name,
      owner_email: owner.email,
    });
    if (answer.status === 200) {
      const updated =
        typeof (answer.result as { updated?: unknown } | null)?.updated ===
        "number"
          ? (answer.result as { updated: number }).updated
          : picked.length;
      setMessage({
        text: `Owner set on ${updated} control${updated === 1 ? "" : "s"}, with every instance of each.`,
        ok: true,
      });
      setAssigning(false);
      setSelected(new Set());
      startTransition(() => router.refresh());
    } else {
      setMessage({ text: batchProblem(answer.status) ?? "", ok: false });
    }
  }
  const label = (key: TableColumn) =>
    TABLE_COLUMNS.find((column) => column.key === key)?.label ?? key;
  const sortOf = (key: TableColumn) =>
    TABLE_COLUMNS.find((column) => column.key === key)?.sort ?? null;
  return (
    <div className="ct" aria-busy={pending}>
      <div className="ct-bar">
        {selected.size > 0 ? (
          <section className="ct-selection" aria-label="Selected controls">
            <strong>{selected.size} selected</strong>
            {canSubmit && drafts.length > 0 ? (
              <SubmitBatch
                ids={ids}
                items={drafts}
                label={`Submit ${drafts.length} drafted request${drafts.length === 1 ? "" : "s"}`}
              />
            ) : null}
            {canAssign && !assigning ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setMessage(null);
                  setAssigning(true);
                }}
              >
                Set owner
              </button>
            ) : null}
            <button
              type="button"
              className="cr-link-button"
              onClick={() => {
                setSelected(new Set());
                setAssigning(false);
              }}
            >
              Clear selection
            </button>
          </section>
        ) : (
          <span className="ct-hint">
            Select controls to submit their drafted requests
            {canAssign ? " or set their owner" : ""}.
          </span>
        )}
        <details className="ct-columns">
          <summary>
            <UiIcon name="table" size={14} />
            Columns
          </summary>
          <fieldset>
            <legend className="sr-only">Columns</legend>
            {TABLE_COLUMNS.map((column) => (
              <label key={column.key} className="cr-check">
                <input
                  type="checkbox"
                  checked={columns.includes(column.key)}
                  onChange={(event) => choose(column.key, event.target.checked)}
                />
                <span>{column.label}</span>
              </label>
            ))}
          </fieldset>
        </details>
      </div>
      {assigning ? (
        <form
          autoComplete="off"
          className="ct-assign"
          onSubmit={(event) => {
            event.preventDefault();
            void assign();
          }}
        >
          <label htmlFor={`${id}-name`}>Owner</label>
          <input
            id={`${id}-name`}
            value={owner.name}
            maxLength={200}
            placeholder="Name"
            onChange={(event) =>
              setOwner({ ...owner, name: event.target.value })
            }
          />
          <label htmlFor={`${id}-email`} className="sr-only">
            Email
          </label>
          <input
            id={`${id}-email`}
            type="email"
            value={owner.email}
            maxLength={200}
            placeholder="name@client.example"
            onChange={(event) =>
              setOwner({ ...owner, email: event.target.value })
            }
          />
          <button
            type="submit"
            className="btn-sm"
            disabled={owner.name.trim() === "" || !owner.email.includes("@")}
          >
            Set owner on {picked.length}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setAssigning(false)}
          >
            Cancel
          </button>
          <small>
            Every instance of each control gets this owner. Requests already
            sent keep their recipient.
          </small>
        </form>
      ) : null}
      {message !== null ? (
        <p
          className={`co-outcome${message.ok ? "" : " is-partial"}`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}
      <div className="ct-scroll">
        <table className="ct-table">
          <thead>
            <tr>
              <th scope="col" className="ct-pick">
                <input
                  type="checkbox"
                  aria-label="Select every control shown"
                  checked={allShown}
                  onChange={(event) => {
                    const next = new Set(selected);
                    for (const row of shown) {
                      if (event.target.checked) {
                        next.add(row.id);
                      } else {
                        next.delete(row.id);
                      }
                    }
                    setSelected(next);
                  }}
                />
              </th>
              <th
                scope="col"
                aria-sort={sort === "control" ? "ascending" : undefined}
              >
                <a href={sortHrefs.control}>Control</a>
              </th>
              {columns.map((key) => {
                const by = sortOf(key);
                return (
                  <th
                    key={key}
                    scope="col"
                    aria-sort={
                      by !== null && sort === by ? "ascending" : undefined
                    }
                  >
                    {by !== null ? (
                      <a
                        href={sortHrefs[by]}
                        className={sort === by ? "is-sorted" : undefined}
                      >
                        {label(key)}
                      </a>
                    ) : (
                      label(key)
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const state = rowState(row);
              const link = links[row.id];
              return (
                <tr
                  key={row.id}
                  className={selected.has(row.id) ? "is-picked" : undefined}
                >
                  <td className="ct-pick">
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.controlRef} ${row.applicationName}`}
                      checked={selected.has(row.id)}
                      onChange={(event) => toggle(row.id, event.target.checked)}
                    />
                  </td>
                  <td className="ct-control">
                    <a href={link?.open}>
                      <span className="cr-id">{row.controlRef}</span>
                      <span className="ct-title">{row.title}</span>
                    </a>
                  </td>
                  {columns.map((key) => (
                    <td key={key} className={`ct-${key}`}>
                      {key === "application" ? (
                        row.applicationName || "None"
                      ) : key === "owner" ? (
                        row.ownerName || row.ownerEmail || "PBC coordinator"
                      ) : key === "status" ? (
                        <span className={`co-state is-${state.tone}`}>
                          {state.label}
                          {state.detail !== "" ? (
                            <small>{state.detail}</small>
                          ) : null}
                        </span>
                      ) : key === "evidence" ? (
                        evidenceText(row)
                      ) : key === "agent" ? (
                        agentText(row)
                      ) : key === "next" ? (
                        link?.step !== null && link?.step !== undefined ? (
                          <a className="cr-action" href={link.step.href}>
                            {link.step.label}
                          </a>
                        ) : row.drafted ? null : (
                          <span className="cr-waiting">{row.nextStep}</span>
                        )
                      ) : key === "type" ? (
                        (CATEGORY_LABEL[row.category] ?? row.area)
                      ) : key === "frequency" ? (
                        row.frequencyLabel || row.frequency
                      ) : (
                        (() => {
                          const due = nextDue(row);
                          return due === null ? "" : formatDate(due);
                        })()
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > limit ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm ct-more"
          onClick={() => setLimit(limit + PAGE)}
        >
          Show {Math.min(PAGE, rows.length - limit)} more of{" "}
          {rows.length - limit}
        </button>
      ) : null}
    </div>
  );
}
