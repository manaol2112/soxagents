"use client";

import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import type { ControlRequest } from "./engagement-model";
import {
  BULK_LABELS,
  type BulkAction,
  type BulkOutcome,
  bulkSummary,
  type CenterList,
  type CenterQuery,
  type CenterRow,
  centerHref,
  exportHref,
  type Facet,
  filtered,
  KPI_LABELS,
  KPIS,
  type Kpi,
  PAGE_SIZES,
  PHASE_LABELS,
  parseBulkResult,
  type Sort,
  STAGE_TONES,
  viewQuery,
} from "./evidence-center-model";
import { requestStage } from "./evidence-flow";
import { formatDate } from "./format";
import type { EvidenceCenterState } from "./load-evidence-center";
import { RecordDialog } from "./record-dialog";
import type { Contact } from "./request-details-model";
import { ContactSearch, NewContact, RequestReview } from "./request-review";
import { reviewProblem } from "./request-review-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string };
type Answer = { status: number; detail: string; body: unknown };

async function post(
  ids: Ids,
  fields: Record<string, unknown>,
): Promise<Answer> {
  try {
    const response = await fetch("/workspace/evidence-center", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organization_id: ids.organizationId,
        project_id: ids.projectId,
        ...fields,
      }),
    });
    const body = (await response.json()) as Partial<Answer>;
    return {
      status: typeof body.status === "number" ? body.status : 0,
      detail: typeof body.detail === "string" ? body.detail : "",
      body: body.body ?? null,
    };
  } catch {
    return { status: 0, detail: "", body: null };
  }
}

/**
 * The engagement's evidence command center: the figures that need someone, every request
 * on one table that is searched, filtered, sorted, and paged by the API, changes to many
 * requests at once after a check, and the request open in a side panel. Its state lives
 * in the address.
 */
export function EvidenceCenter({
  ids,
  state,
  setupHref,
  coordinatorMissing,
  delivery = null,
}: {
  ids: Ids;
  state: EvidenceCenterState;
  setupHref: string;
  coordinatorMissing: boolean;
  /** The open request's delivery and reminders, rendered by the page. */
  delivery?: ReactNode;
}) {
  const { list, query } = state;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  const go = (patch: Partial<CenterQuery>) =>
    startTransition(() => router.push(centerHref(ids, query, patch)));
  const refresh = () => startTransition(() => router.refresh());
  // A change of filters or page keeps the selection only for requests still matching.
  const matching = useMemo(
    () =>
      new Map((list?.matching ?? []).map((item) => [item.id, item.version])),
    [list],
  );
  useEffect(() => {
    setSelected((current) => {
      const next = new Map<string, number>();
      for (const [id] of current) {
        const version = matching.get(id);
        if (version !== undefined) next.set(id, version);
      }
      return next.size === current.size ? current : next;
    });
  }, [matching]);
  if (list === null) {
    return (
      <p className="banner banner-warning" role="status">
        Evidence requests could not be loaded. Refresh to try again.
      </p>
    );
  }
  const open =
    query.request === null
      ? null
      : (list.rows.find((row) => row.id === query.request) ?? null);
  return (
    <div className="ec" aria-busy={pending}>
      <Kpis ids={ids} list={list} query={query} />
      {coordinatorMissing && list.kpis.needs_assignment > 0 ? (
        <p className="ec-setup" role="status">
          <UiIcon name="info" size={14} />
          <span>
            {list.kpis.needs_assignment} request
            {list.kpis.needs_assignment === 1 ? " has" : "s have"} no recipient
            and no evidence coordinator is set for the engagement.
          </span>
          <a href={setupHref}>Set the evidence coordinator</a>
        </p>
      ) : null}
      <Toolbar
        ids={ids}
        list={list}
        query={query}
        go={go}
        refresh={refresh}
        onSelectAll={
          list.canAct && selected.size === 0 && list.total > 0
            ? () =>
                setSelected(
                  new Map(list.matching.map((item) => [item.id, item.version])),
                )
            : null
        }
      />
      {selected.size > 0 ? (
        <BulkBar
          ids={ids}
          list={list}
          selected={selected}
          contacts={state.contacts}
          onClear={() => setSelected(new Map())}
          onDone={() => {
            setSelected(new Map());
            refresh();
          }}
        />
      ) : null}
      <RequestTable
        ids={ids}
        list={list}
        query={query}
        go={go}
        contacts={state.contacts}
        selected={selected}
        setSelected={setSelected}
        refresh={refresh}
      />
      <Pager list={list} go={go} />
      {query.request !== null ? (
        <Drawer
          ids={ids}
          query={query}
          row={open}
          state={state}
          canAct={list.canAct}
          canApprove={list.canApprove}
          delivery={delivery}
        />
      ) : null}
      {query.creating ? (
        <NewRequest
          ids={ids}
          list={list}
          query={query}
          contacts={state.contacts}
        />
      ) : null}
    </div>
  );
}

function Kpis({
  ids,
  list,
  query,
}: {
  ids: Ids;
  list: CenterList;
  query: CenterQuery;
}) {
  const items: Array<{ key: Kpi | null; label: string; count: number }> = [
    { key: null, label: "Total requests", count: list.kpis.total },
    ...KPIS.map((key) => ({
      key,
      label: KPI_LABELS[key],
      count: list.kpis[key],
    })),
  ];
  return (
    <ul className="ec-kpis" aria-label="Requests at a glance">
      {items.map((item) => {
        const active =
          item.key === null
            ? query.kpi === null && !filtered(query)
            : query.kpi === item.key;
        const alert =
          item.count > 0 &&
          (item.key === "needs_assignment" || item.key === "overdue");
        return (
          <li key={item.key ?? "total"}>
            <a
              href={centerHref(
                ids,
                query,
                item.key === null
                  ? {
                      kpi: null,
                      view: "all",
                      q: "",
                      stage: [],
                      phase: [],
                      type: [],
                      owner: [],
                      system: [],
                    }
                  : { kpi: active ? null : item.key, view: "all" },
              )}
              aria-current={active ? "true" : undefined}
              className={`ec-kpi${active ? " is-active" : ""}${alert ? " is-alert" : ""}`}
            >
              <span className="ec-kpi-label">{item.label}</span>
              <strong className="num">{item.count}</strong>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function Toolbar({
  ids,
  list,
  query,
  go,
  refresh,
  onSelectAll,
}: {
  ids: Ids;
  list: CenterList;
  query: CenterQuery;
  go: (patch: Partial<CenterQuery>) => void;
  refresh: () => void;
  /** Select every matching request, which opens the bulk changes. */
  onSelectAll: (() => void) | null;
}) {
  const id = useId();
  const [search, setSearch] = useState(query.q);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const custom = list.views.find(
    (view) => !view.builtIn && view.id === query.view,
  );
  return (
    <div className="ec-toolbar">
      <div className="ec-toolbar-row">
        <label className="sr-only" htmlFor={`${id}-view`}>
          View
        </label>
        <select
          id={`${id}-view`}
          className="ec-view"
          value={
            list.views.some((view) => view.id === query.view)
              ? query.view
              : "all"
          }
          onChange={(event) => {
            const view = list.views.find(
              (item) => item.id === event.target.value,
            );
            if (view !== undefined) {
              go(viewQuery(view));
            }
          }}
        >
          <optgroup label="Views">
            {list.views
              .filter((view) => view.builtIn)
              .map((view) => (
                <option key={view.id} value={view.id}>
                  {view.name}
                </option>
              ))}
          </optgroup>
          {list.views.some((view) => !view.builtIn) ? (
            <optgroup label="Saved views">
              {list.views
                .filter((view) => !view.builtIn)
                .map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
            </optgroup>
          ) : null}
        </select>
        <form
          className="ec-search"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            go({ q: search.trim() });
          }}
        >
          <UiIcon name="search" size={14} />
          <label className="sr-only" htmlFor={`${id}-q`}>
            Search requests
          </label>
          <input
            id={`${id}-q`}
            type="search"
            placeholder="Search title, control, owner, or system"
            value={search}
            maxLength={200}
            onChange={(event) => setSearch(event.target.value)}
          />
        </form>
        <FilterMenu
          label="Status"
          name="stage"
          facets={list.facets.stage}
          query={query}
          go={go}
        />
        <FilterMenu
          label="Phase"
          name="phase"
          facets={list.facets.phase.map((item) => ({
            ...item,
            label: PHASE_LABELS[item.key] ?? item.label,
          }))}
          query={query}
          go={go}
        />
        <FilterMenu
          label="Evidence type"
          name="type"
          facets={list.facets.type}
          query={query}
          go={go}
        />
        <FilterMenu
          label="Owner"
          name="owner"
          facets={list.facets.owner}
          query={query}
          go={go}
        />
        <FilterMenu
          label="System"
          name="system"
          facets={list.facets.system}
          query={query}
          go={go}
        />
        {filtered(query) ? (
          <a
            className="btn btn-sm btn-ghost"
            href={centerHref(ids, query, {
              q: "",
              stage: [],
              phase: [],
              type: [],
              owner: [],
              system: [],
              kpi: null,
              view: "all",
            })}
          >
            Clear filters
          </a>
        ) : null}
        <span className="ec-toolbar-end">
          {onSelectAll !== null ? (
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={onSelectAll}
              title={`Select the ${list.total} matching requests to change them together`}
            >
              Bulk actions
            </button>
          ) : null}
          {filtered(query) && custom === undefined ? (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setSaving(true)}
            >
              Save view
            </button>
          ) : null}
          {custom !== undefined ? (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={async () => {
                const answer = await post(ids, {
                  intent: "view-remove",
                  view_id: custom.id,
                });
                if (answer.status === 200) {
                  go({ view: "all" });
                } else {
                  setProblem(reviewProblem(answer.status, answer.detail));
                }
              }}
            >
              Delete view
            </button>
          ) : null}
          <a className="btn btn-sm btn-ghost" href={exportHref(ids, query)}>
            Export
          </a>
        </span>
      </div>
      {saving ? (
        <form
          className="ec-save"
          autoComplete="off"
          onSubmit={async (event) => {
            event.preventDefault();
            const answer = await post(ids, {
              intent: "view-save",
              name,
              filters: {
                q: query.q,
                stage: query.stage,
                phase: query.phase,
                type: query.type,
                owner: query.owner,
                system: query.system,
                kpi: query.kpi,
                view: /^[a-z]+$/.test(query.view) ? query.view : "all",
              },
            });
            const saved = answer.body as { id?: unknown } | null;
            if (answer.status === 200 && typeof saved?.id === "string") {
              setSaving(false);
              setName("");
              go({ view: saved.id });
              refresh();
            } else {
              setProblem(reviewProblem(answer.status, answer.detail));
            }
          }}
        >
          <label htmlFor={`${id}-name`}>View name</label>
          <input
            id={`${id}-name`}
            type="text"
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="submit"
            className="btn btn-sm"
            disabled={name.trim() === ""}
          >
            Save
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setSaving(false)}
          >
            Cancel
          </button>
        </form>
      ) : null}
      {problem !== null ? <p className="ec-problem">{problem}</p> : null}
    </div>
  );
}

function FilterMenu({
  label,
  name,
  facets,
  query,
  go,
}: {
  label: string;
  name: "stage" | "phase" | "type" | "owner" | "system";
  facets: Facet[];
  query: CenterQuery;
  go: (patch: Partial<CenterQuery>) => void;
}) {
  const chosen = query[name];
  const menu = useRef<HTMLDetailsElement>(null);
  return (
    <details className="ec-filter" ref={menu}>
      <summary className={chosen.length > 0 ? "is-on" : ""}>
        {label}
        {chosen.length > 0 ? (
          <span className="ec-filter-count">{chosen.length}</span>
        ) : null}
        <UiIcon name="chevron" size={12} />
      </summary>
      <div className="ec-filter-pop">
        {facets.length === 0 ? (
          <p className="ec-muted">None</p>
        ) : (
          <fieldset>
            <legend className="sr-only">{label}</legend>
            {facets.map((facet) => (
              <label key={facet.key}>
                <input
                  type="checkbox"
                  checked={chosen.includes(facet.key)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...chosen, facet.key]
                      : chosen.filter((item) => item !== facet.key);
                    if (menu.current !== null) menu.current.open = false;
                    go({ [name]: next });
                  }}
                />
                <span>{facet.label}</span>
                <span className="num ec-muted">{facet.count}</span>
              </label>
            ))}
          </fieldset>
        )}
      </div>
    </details>
  );
}

const COLUMNS: Array<{ key: Sort | null; label: string; className?: string }> =
  [
    { key: "title", label: "Request" },
    { key: "control", label: "Control / system" },
    { key: "phase", label: "Phase" },
    { key: "type", label: "Evidence type" },
    { key: "owner", label: "Owner" },
    { key: "stage", label: "Status" },
    { key: "due", label: "Due" },
    { key: "agent", label: "Agent" },
  ];

function RequestTable({
  ids,
  list,
  query,
  go,
  contacts,
  selected,
  setSelected,
  refresh,
}: {
  ids: Ids;
  list: CenterList;
  query: CenterQuery;
  go: (patch: Partial<CenterQuery>) => void;
  contacts: Contact[];
  selected: Map<string, number>;
  setSelected: (next: Map<string, number>) => void;
  refresh: () => void;
}) {
  if (list.total === 0) {
    return (
      <div className="ec-empty">
        <UiIcon name="inbox" size={20} />
        <p>
          {filtered(query)
            ? "No requests match these filters."
            : "No evidence requests yet. Create one, or generate the planned requests for the engagement's controls."}
        </p>
      </div>
    );
  }
  const page = list.rows;
  const allOnPage =
    page.length > 0 && page.every((row) => selected.has(row.id));
  const all =
    list.matching.length > 0 &&
    list.matching.every((item) => selected.has(item.id));
  return (
    <div className="ec-table-wrap">
      {allOnPage && !all && list.total > page.length ? (
        <p className="ec-select-all" role="status">
          All {page.length} on this page are selected.{" "}
          <button
            type="button"
            className="link-button"
            onClick={() =>
              setSelected(
                new Map(list.matching.map((item) => [item.id, item.version])),
              )
            }
          >
            Select all {list.total} matching requests
          </button>
        </p>
      ) : null}
      <table className="ec-table">
        <thead>
          <tr>
            <th scope="col" className="ec-check">
              <input
                type="checkbox"
                aria-label="Select every request on this page"
                checked={allOnPage}
                onChange={(event) => {
                  const next = new Map(selected);
                  for (const row of page) {
                    if (event.target.checked) next.set(row.id, row.version);
                    else next.delete(row.id);
                  }
                  setSelected(next);
                }}
              />
            </th>
            {COLUMNS.map((column) => {
              const sorted = query.sort === column.key;
              return (
                <th
                  key={column.label}
                  scope="col"
                  aria-sort={
                    sorted
                      ? query.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {column.key !== null ? (
                    <button
                      type="button"
                      className="ec-sort"
                      onClick={() =>
                        go({
                          sort: column.key as Sort,
                          dir: sorted && query.dir === "asc" ? "desc" : "asc",
                        })
                      }
                    >
                      {column.label}
                      {sorted ? (
                        <span aria-hidden="true">
                          {query.dir === "asc" ? " ↑" : " ↓"}
                        </span>
                      ) : null}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {page.map((row) => (
            <Row
              key={row.id}
              ids={ids}
              row={row}
              query={query}
              contacts={contacts}
              canAct={list.canAct}
              checked={selected.has(row.id)}
              onCheck={(checked) => {
                const next = new Map(selected);
                if (checked) next.set(row.id, row.version);
                else next.delete(row.id);
                setSelected(next);
              }}
              refresh={refresh}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  ids,
  row,
  query,
  contacts,
  canAct,
  checked,
  onCheck,
  refresh,
}: {
  ids: Ids;
  row: CenterRow;
  query: CenterQuery;
  contacts: Contact[];
  canAct: boolean;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  refresh: () => void;
}) {
  const href = centerHref(ids, query, { request: row.id, creating: false });
  const opened = query.request === row.id;
  return (
    <tr
      className={`${checked ? "is-selected" : ""}${opened ? " is-open" : ""}`}
    >
      <td className="ec-check">
        <input
          type="checkbox"
          aria-label={`Select ${row.reference}`}
          checked={checked}
          onChange={(event) => onCheck(event.target.checked)}
        />
      </td>
      <td className="ec-request">
        <a href={href} className="ec-title" title={row.title}>
          {row.title}
        </a>
        <span className="ec-sub">
          {row.reference}
          {row.priority !== "NORMAL" ? (
            <span className={`ec-priority is-${row.priority.toLowerCase()}`}>
              {row.priority === "HIGH" ? "High" : "Urgent"}
            </span>
          ) : null}
          {row.files > 0
            ? ` · ${row.files} file${row.files === 1 ? "" : "s"}`
            : ""}
          {row.supports.length > 0 ? (
            <span
              className="ec-supports"
              title="The test plan attributes its items evidence"
            >
              {" "}
              · Supports {row.supports.join(", ")}
            </span>
          ) : null}
        </span>
      </td>
      <td className="ec-clip">
        <span className="mono ec-control" title={row.controlTitle}>
          {row.controlRef}
        </span>
        <span className="ec-sub" title={row.systems.join(", ")}>
          {row.systems.join(", ") || "No system"}
        </span>
      </td>
      <td>
        {row.phase === null ? (
          <span className="ec-muted">—</span>
        ) : (
          (PHASE_LABELS[row.phase] ?? row.phase)
        )}
      </td>
      <td className="ec-clip">
        <span
          className={row.typeUncertain ? "ec-uncertain" : ""}
          title={row.typeUncertain ? "Recommended; to be confirmed" : undefined}
        >
          {row.typeLabel}
        </span>
      </td>
      <td className="ec-owner-cell">
        <OwnerCell
          ids={ids}
          row={row}
          contacts={contacts}
          canAct={canAct}
          refresh={refresh}
        />
      </td>
      <td>
        <span className={`pill pill-dot tone-${STAGE_TONES[row.stage]}`}>
          {row.stageLabel}
        </span>
        {row.overdue ? <span className="ec-flag is-late">Overdue</span> : null}
        {row.held ? <span className="ec-flag">{row.heldReason}</span> : null}
      </td>
      <td className={`num ec-due${row.overdue ? " is-late" : ""}`}>
        {formatDate(row.dueAt)}
      </td>
      <td className="ec-clip ec-agent">
        {row.agent === "NONE" ? (
          <span className="ec-muted">—</span>
        ) : (
          <span className={`ec-agent-${row.agent.toLowerCase()}`}>
            <UiIcon name="sparkles" size={12} />
            {row.agentLabel}
          </span>
        )}
      </td>
    </tr>
  );
}

const UNSENT = new Set(["DRAFT", "APPROVAL_PENDING"]);

/** Who the request goes to, changed in place: a search over the engagement's contacts,
 * with the control's owner first. */
function OwnerCell({
  ids,
  row,
  contacts,
  canAct,
  refresh,
}: {
  ids: Ids;
  row: CenterRow;
  contacts: Contact[];
  canAct: boolean;
  refresh: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The address typed when the person is not a contact yet: a new one is added here.
  const [creating, setCreating] = useState<string | null>(null);
  const editable = canAct && UNSENT.has(row.status);
  const assign = async (email: string): Promise<boolean> => {
    const answer = await post(ids, {
      intent: "bulk",
      action: "ASSIGN",
      recipient: email,
      items: [{ id: row.id, version: row.version }],
    });
    const outcome = parseBulkResult(answer.body)?.outcomes[0];
    if (answer.status === 200 && outcome?.ok) {
      return true;
    }
    setProblem(outcome?.detail || reviewProblem(answer.status, answer.detail));
    return false;
  };
  // The control's owner, from the engagement's control register, comes first.
  const ordered = [
    ...contacts.filter((item) => item.role.includes(row.controlRef)),
    ...contacts.filter((item) => !item.role.includes(row.controlRef)),
  ];
  const label =
    row.recipient === "" ? (
      <span className="ec-unassigned">Unassigned</span>
    ) : (
      <span className="ec-owner" title={row.recipient}>
        {row.recipientName || row.recipient}
        {row.ccCount > 0 ? (
          <span className="ec-muted"> +{row.ccCount}</span>
        ) : null}
      </span>
    );
  if (!editable) {
    return label;
  }
  return (
    <div className="ec-owner-wrap">
      <button
        type="button"
        className="ec-owner-button"
        aria-expanded={open}
        aria-label={`Change the owner of ${row.reference}`}
        onClick={() => {
          setOpen(!open);
          setProblem(null);
          setCreating(null);
        }}
      >
        {label}
        <UiIcon name="chevron" size={11} />
      </button>
      {open ? (
        <div className="ec-owner-pop">
          <span className="sr-only" id={`${id}-label`}>
            Owner of {row.reference}
          </span>
          {creating !== null ? (
            <NewContact
              id={`${id}-new`}
              email={creating}
              domains={[]}
              busy={busy}
              onCancel={() => setCreating(null)}
              onSave={async (contact) => {
                setBusy(true);
                setProblem(null);
                const added = await post(ids, {
                  intent: "contact",
                  ...contact,
                });
                const ok =
                  (added.status === 200 || added.status === 201) &&
                  (await assign(contact.email));
                setBusy(false);
                if (added.status !== 200 && added.status !== 201) {
                  // The API says why in plain words (an address outside the allowed
                  // domains, say); otherwise the general reason for the status.
                  setProblem(
                    added.detail !== ""
                      ? added.detail
                      : reviewProblem(added.status, added.detail),
                  );
                  return;
                }
                if (ok) {
                  setCreating(null);
                  setOpen(false);
                }
                refresh();
              }}
            />
          ) : (
            <ContactSearch
              id={`${id}-search`}
              labelledBy={`${id}-label`}
              contacts={ordered}
              exclude={row.recipient === "" ? [] : [row.recipient]}
              domains={[]}
              placeholder="Search engagement contacts"
              disabled={busy}
              focus
              onPick={async (email) => {
                setBusy(true);
                const ok = await assign(email);
                setBusy(false);
                if (ok) {
                  setOpen(false);
                  refresh();
                }
              }}
              onCreate={(email) => {
                setProblem(null);
                setCreating(email);
              }}
              onClose={() => setOpen(false)}
            />
          )}
          {problem !== null ? <p className="ec-problem">{problem}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function Pager({
  list,
  go,
}: {
  list: CenterList;
  go: (patch: Partial<CenterQuery>) => void;
}) {
  const id = useId();
  if (list.total === 0) {
    return null;
  }
  const pages = Math.max(1, Math.ceil(list.total / list.size));
  const first = (list.page - 1) * list.size + 1;
  const last = Math.min(list.total, list.page * list.size);
  return (
    <nav className="ec-pager" aria-label="Pages">
      <span className="num">
        {first}–{last} of {list.total}
      </span>
      <label htmlFor={`${id}-size`} className="ec-muted">
        Rows
      </label>
      <select
        id={`${id}-size`}
        value={list.size}
        onChange={(event) => go({ size: Number(event.target.value), page: 1 })}
      >
        {PAGE_SIZES.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        disabled={list.page <= 1}
        onClick={() => go({ page: list.page - 1 })}
      >
        Previous
      </button>
      <span className="num">
        Page {list.page} of {pages}
      </span>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        disabled={list.page >= pages}
        onClick={() => go({ page: list.page + 1 })}
      >
        Next
      </button>
    </nav>
  );
}

/** Changes to the selected requests: chosen, checked against each request, then applied
 * to the requests that passed. Approving and sending stay separate. */
function BulkBar({
  ids,
  list,
  selected,
  contacts,
  onClear,
  onDone,
}: {
  ids: Ids;
  list: CenterList;
  selected: Map<string, number>;
  contacts: Contact[];
  onClear: () => void;
  onDone: () => void;
}) {
  const id = useId();
  const [action, setAction] = useState<BulkAction | null>(null);
  const [recipient, setRecipient] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("HIGH");
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState<BulkOutcome[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [left, setLeft] = useState<BulkOutcome[]>([]);
  const items = [...selected].map(([itemId, version]) => ({
    id: itemId,
    version,
  }));
  const actions: BulkAction[] = [
    ...(list.canAct
      ? (["ASSIGN", "DUE", "PRIORITY", "SUBMIT"] as BulkAction[])
      : []),
    ...(list.canApprove
      ? (["APPROVE", "APPROVE_SEND", "RETURN"] as BulkAction[])
      : []),
  ];
  const fields = () => ({
    intent: "bulk",
    action,
    recipient,
    due_on: due,
    priority,
    reason,
  });
  const ready =
    action !== null &&
    (action !== "ASSIGN" || recipient !== "") &&
    (action !== "DUE" || due !== "") &&
    (action !== "RETURN" || reason.trim().length >= 3);
  async function check() {
    setBusy(true);
    setResult(null);
    const answer = await post(ids, { ...fields(), items, preview: true });
    setBusy(false);
    const parsed = parseBulkResult(answer.body);
    if (answer.status === 200 && parsed !== null) {
      setChecked(parsed.outcomes);
    } else {
      setResult(reviewProblem(answer.status, answer.detail));
    }
  }
  async function apply() {
    const passing = (checked ?? [])
      .filter((item) => item.ok)
      .map((item) => item.id);
    if (passing.length === 0) return;
    setBusy(true);
    const answer = await post(ids, {
      ...fields(),
      items: items.filter((item) => passing.includes(item.id)),
    });
    setBusy(false);
    const parsed = parseBulkResult(answer.body);
    if (answer.status === 200 && parsed !== null && action !== null) {
      setChecked(null);
      setAction(null);
      setResult(bulkSummary(action, parsed));
      // Each request that did not go all the way, with why: an approval kept unsent too.
      setLeft(parsed.outcomes.filter((item) => !item.ok));
      onDone();
    } else {
      setResult(reviewProblem(answer.status, answer.detail));
    }
  }
  const passing = (checked ?? []).filter((item) => item.ok).length;
  return (
    <section className="ec-bulk" aria-label="Change the selected requests">
      <div className="ec-bulk-row">
        <strong>{selected.size} selected</strong>
        <label className="sr-only" htmlFor={`${id}-action`}>
          Change
        </label>
        <select
          id={`${id}-action`}
          value={action ?? ""}
          onChange={(event) => {
            setAction((event.target.value || null) as BulkAction | null);
            setChecked(null);
            setResult(null);
          }}
        >
          <option value="">Choose an action…</option>
          {actions.map((item) => (
            <option key={item} value={item}>
              {BULK_LABELS[item]}
            </option>
          ))}
        </select>
        {action === "ASSIGN" ? (
          <>
            <label className="sr-only" htmlFor={`${id}-to`}>
              Owner
            </label>
            <select
              id={`${id}-to`}
              value={recipient}
              onChange={(event) => {
                setRecipient(event.target.value);
                setChecked(null);
              }}
            >
              <option value="">Choose an owner…</option>
              {contacts.map((contact) => (
                <option key={contact.email} value={contact.email}>
                  {contact.name} · {contact.email}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {action === "DUE" ? (
          <>
            <label className="sr-only" htmlFor={`${id}-due`}>
              Due date
            </label>
            <input
              id={`${id}-due`}
              type="date"
              value={due}
              onChange={(event) => {
                setDue(event.target.value);
                setChecked(null);
              }}
            />
          </>
        ) : null}
        {action === "PRIORITY" ? (
          <>
            <label className="sr-only" htmlFor={`${id}-priority`}>
              Priority
            </label>
            <select
              id={`${id}-priority`}
              value={priority}
              onChange={(event) => {
                setPriority(event.target.value);
                setChecked(null);
              }}
            >
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </>
        ) : null}
        {action === "APPROVE" ||
        action === "APPROVE_SEND" ||
        action === "RETURN" ? (
          <>
            <label className="sr-only" htmlFor={`${id}-reason`}>
              {action === "RETURN" ? "Changes requested" : "Approval note"}
            </label>
            <input
              id={`${id}-reason`}
              type="text"
              maxLength={500}
              placeholder={
                action === "RETURN"
                  ? "Changes requested (required)"
                  : "Approval note (optional)"
              }
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setChecked(null);
              }}
            />
          </>
        ) : null}
        {checked === null ? (
          <button
            type="button"
            className="btn btn-sm"
            disabled={!ready || busy}
            onClick={check}
          >
            {busy ? "Checking…" : "Check requests"}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || passing === 0}
            onClick={apply}
          >
            {busy
              ? "Applying…"
              : `${action === null ? "Apply" : BULK_LABELS[action]}: ${passing} request${passing === 1 ? "" : "s"}`}
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={onClear}
        >
          Clear selection
        </button>
      </div>
      {checked !== null ? (
        <div className="ec-bulk-review">
          <p>
            {passing} of {checked.length} ready.
            {action === "APPROVE"
              ? " Approved requests are not sent until each is sent."
              : action === "APPROVE_SEND"
                ? " Each is approved, then sent to its recipient. A request that cannot be sent stays approved."
                : ""}
          </p>
          {checked.some((item) => !item.ok) ? (
            <ul aria-label="Requests that cannot change">
              {checked
                .filter((item) => !item.ok)
                .slice(0, 50)
                .map((item) => (
                  <li key={item.id}>
                    <span className="mono">{item.reference}</span> {item.title}
                    <span className="ec-muted"> — {item.detail}</span>
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {result !== null ? (
        <p className="ec-result" role="status">
          {result}
        </p>
      ) : null}
      {result !== null && left.length > 0 ? (
        <ul className="ec-bulk-review" aria-label="Requests not done">
          {left.slice(0, 50).map((item) => (
            <li key={item.id}>
              <span className="mono">{item.reference}</span> {item.title}
              <span className="ec-muted"> — {item.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Drawer({
  ids,
  query,
  row,
  state,
  canAct,
  canApprove,
  delivery,
}: {
  ids: Ids;
  query: CenterQuery;
  row: CenterRow | null;
  state: EvidenceCenterState;
  canAct: boolean;
  canApprove: boolean;
  delivery: ReactNode;
}) {
  const details = state.details;
  const closeHref = centerHref(ids, query, { request: null });
  if (details === null) {
    return (
      <RecordDialog
        eyebrow="Evidence request"
        title="The request could not be loaded"
        closeHref={closeHref}
      >
        <p className="banner banner-warning" role="status">
          It may belong to another engagement, or it was removed.
        </p>
      </RecordDialog>
    );
  }
  const request: ControlRequest = {
    id: details.request.id,
    kind: "EVIDENCE",
    title: details.title,
    status: details.request.status,
    dueAt: details.request.dueAt,
    phase: details.request.testingPhase,
    version: details.request.version,
    recipient: details.request.recipient,
    kickoff: row?.kickoff ?? false,
    approvalId: row?.approvalId ?? null,
    approvalDecision: row?.approvalDecision ?? null,
    approvalReason: row?.approvalReason ?? null,
    approvalDecidedBy: row?.approvalDecidedBy ?? null,
    viewerCanDecide: row?.viewerCanDecide ?? false,
  };
  const stage = row?.held ? "HELD" : requestStage(request);
  const controlId = details.control?.id ?? row?.controlId ?? "";
  const controlHref =
    controlId === ""
      ? undefined
      : `/?organization=${ids.organizationId}&project=${ids.projectId}&section=controls&control=${controlId}&tab=evidence&ev=requests&request=${details.request.id}`;
  const ref = details.control?.ref ?? row?.controlRef ?? "";
  const controlTitle = details.control?.title ?? row?.controlTitle ?? "";
  const systems = row?.systems.join(", ") ?? "";
  return (
    <RecordDialog
      eyebrow={[details.reference, `${ref} ${controlTitle}`.trim(), systems]
        .filter((part) => part !== "")
        .join(" · ")}
      title={details.title || "Evidence request"}
      closeHref={closeHref}
    >
      <div className="ec-dialog-body">
        <RequestReview
          ids={{ ...ids, controlId }}
          request={request}
          details={details}
          stage={stage}
          control={{
            ref: details.control?.ref ?? row?.controlRef ?? "",
            title: details.control?.title ?? row?.controlTitle ?? "",
            system: row?.systems.join(", ") ?? "",
          }}
          plan={null}
          planned
          canAct={canAct}
          canApprove={canApprove && details.request.draftedBy === "AGENT"}
          closeHref={closeHref}
          controlHref={controlHref}
          inDialog
          side={delivery}
        />
      </div>
    </RecordDialog>
  );
}

/** A new request: from the control's planned evidence (the evidence coordinator drafts
 * the wording), or written here. It starts as a draft; nothing is sent. */
function NewRequest({
  ids,
  list,
  query,
  contacts,
}: {
  ids: Ids;
  list: CenterList;
  query: CenterQuery;
  contacts: Contact[];
}) {
  const id = useId();
  const router = useRouter();
  const [key] = useState(() => `manual-${crypto.randomUUID()}`);
  const [control, setControl] = useState("");
  const [phase, setPhase] = useState("INTERIM");
  const [type, setType] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [recipient, setRecipient] = useState("");
  const [due, setDue] = useState(() =>
    new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
  );
  const [days, setDays] = useState(3);
  const [most, setMost] = useState(2);
  const [priority, setPriority] = useState("NORMAL");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [planned, setPlanned] = useState<string | null>(null);
  const chosen = list.controls.find((item) => item.id === control);
  const owner =
    chosen === undefined
      ? undefined
      : contacts.find((item) => item.role.includes(chosen.ref));
  const closeHref = centerHref(ids, query, { creating: false });
  return (
    <RecordDialog
      eyebrow="Evidence request"
      title="New evidence request"
      description="It starts as a draft; nothing is sent until it is approved."
      closeHref={closeHref}
    >
      <div className="ec-new">
        <label htmlFor={`${id}-control`}>
          Control
          <select
            id={`${id}-control`}
            value={control}
            onChange={(event) => {
              setControl(event.target.value);
              setPlanned(null);
              const next = contacts.find((item) =>
                item.role.includes(
                  list.controls.find((c) => c.id === event.target.value)?.ref ??
                    "\u0000",
                ),
              );
              if (recipient === "" && next !== undefined)
                setRecipient(next.email);
            }}
          >
            <option value="">Choose a control…</option>
            {list.controls.map((item) => (
              <option key={item.id} value={item.id}>
                {item.ref} · {item.title}
              </option>
            ))}
          </select>
        </label>
        {chosen !== undefined ? (
          <div className="ec-planned">
            <p>
              The evidence coordinator drafts requests from the control's
              evidence plan.
            </p>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const answer = await post(ids, {
                  intent: "request-planned",
                  control_id: control,
                });
                setBusy(false);
                const body = answer.body as { requested?: unknown } | null;
                if (
                  answer.status === 200 &&
                  typeof body?.requested === "number"
                ) {
                  setPlanned(
                    body.requested === 0
                      ? "All planned evidence for this control is already requested."
                      : `${body.requested} request${body.requested === 1 ? " was" : "s were"} drafted from the plan. Review them in the list.`,
                  );
                  router.refresh();
                } else if (answer.detail === "plan the evidence first") {
                  setPlanned(
                    "This control's evidence is not planned yet. Plan it on the control first.",
                  );
                } else {
                  setPlanned(reviewProblem(answer.status, answer.detail));
                }
              }}
            >
              <UiIcon name="sparkles" size={13} />
              Request planned evidence
            </button>
            {planned !== null ? <p role="status">{planned}</p> : null}
          </div>
        ) : null}
        <fieldset
          className="ec-new-form"
          disabled={busy || chosen === undefined}
        >
          <legend>Or write the request</legend>
          <div className="ec-new-row">
            <label htmlFor={`${id}-phase`}>
              Testing phase
              <select
                id={`${id}-phase`}
                value={phase}
                onChange={(event) => setPhase(event.target.value)}
              >
                <option value="DESIGN">Design</option>
                <option value="INTERIM">Interim</option>
                <option value="ROLLFORWARD">Roll-forward</option>
              </select>
            </label>
            <label htmlFor={`${id}-type`}>
              Evidence type
              <select
                id={`${id}-type`}
                value={type}
                onChange={(event) => setType(event.target.value)}
              >
                <option value="">Classify from the wording</option>
                {list.types.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label htmlFor={`${id}-name`}>
            Title
            <input
              id={`${id}-name`}
              type="text"
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label htmlFor={`${id}-desc`}>
            What the client is asked to provide
            <textarea
              id={`${id}-desc`}
              rows={6}
              maxLength={80_000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className="ec-new-row">
            <label htmlFor={`${id}-to`}>
              Recipient
              <select
                id={`${id}-to`}
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
              >
                <option value="">Assign later</option>
                {contacts.map((contact) => (
                  <option key={contact.email} value={contact.email}>
                    {contact.name} · {contact.email}
                    {owner?.email === contact.email ? " (control owner)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={`${id}-due`}>
              Due date
              <input
                id={`${id}-due`}
                type="date"
                value={due}
                onChange={(event) => setDue(event.target.value)}
              />
            </label>
          </div>
          <div className="ec-new-row">
            <label htmlFor={`${id}-days`}>
              Reminder after (days)
              <input
                id={`${id}-days`}
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
              />
            </label>
            <label htmlFor={`${id}-most`}>
              Reminders at most
              <input
                id={`${id}-most`}
                type="number"
                min={0}
                max={10}
                value={most}
                onChange={(event) => setMost(Number(event.target.value))}
              />
            </label>
            <label htmlFor={`${id}-priority`}>
              Priority
              <select
                id={`${id}-priority`}
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
              >
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </label>
          </div>
          {description.trim().length >= 10 ? (
            <div className="ec-preview">
              <p className="ec-preview-label">What the recipient receives</p>
              {title.trim() !== "" ? <strong>{title.trim()}</strong> : null}
              <p className="ec-preview-text">{description.trim()}</p>
              <p className="ec-muted">
                Due {formatDate(`${due}T23:59:00Z`)}. Files are uploaded through
                the secure link in the email.
              </p>
            </div>
          ) : null}
          <p className="ec-muted">
            Reference materials, such as a prior-year workpaper, are attached
            once the draft is saved.
          </p>
          <div className="rr-actions">
            <button
              type="button"
              className="btn"
              disabled={
                busy || chosen === undefined || description.trim().length < 10
              }
              onClick={async () => {
                if (chosen === undefined) return;
                setBusy(true);
                setProblem(null);
                const answer = await post(ids, {
                  intent: "create",
                  operation_key: key,
                  control_id: chosen.id,
                  control_ref: chosen.ref,
                  phase,
                  request_type: type,
                  title,
                  description,
                  recipient,
                  cc: [],
                  due_on: due,
                  priority,
                  follow_up_after_days: days,
                  max_follow_ups: most,
                });
                setBusy(false);
                const made = answer.body as { id?: unknown } | null;
                if (
                  (answer.status === 200 || answer.status === 201) &&
                  typeof made?.id === "string"
                ) {
                  router.push(
                    centerHref(ids, query, {
                      creating: false,
                      request: made.id,
                    }),
                  );
                } else {
                  setProblem(reviewProblem(answer.status, answer.detail));
                }
              }}
            >
              Save draft
            </button>
            <a className="btn btn-ghost" href={closeHref}>
              Cancel
            </a>
          </div>
          {problem !== null ? <p className="ec-problem">{problem}</p> : null}
        </fieldset>
      </div>
    </RecordDialog>
  );
}
