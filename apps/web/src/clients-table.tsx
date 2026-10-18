"use client";

import { useMemo, useState } from "react";

import type { Client } from "./client-model";
import { ConfirmAction } from "./confirm-action";
import { statusLabel } from "./engagement-lifecycle";
import { clientRows } from "./engagements-model";
import { formatDate } from "./format";
import { UiIcon } from "./ui-icon";

/**
 * The firm's clients (Milestone 8.18) as a table: each with its latest engagement, a way
 * to start its next one, and, for an owner or admin, a rename that reaches all of its
 * engagements.
 */
export function ClientsTable({
  clients,
  organizationId,
  canRename,
  newHref,
}: {
  clients: readonly Client[];
  organizationId: string;
  canRename: boolean;
  /** The New engagement form; a client's link adds `&client=`. */
  newHref: string;
}) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => clientRows(clients, query), [clients, query]);
  const engagementHref = (projectId: string) =>
    `/?${new URLSearchParams({ organization: organizationId, section: "projects", project: projectId })}`;
  return (
    <section className="eg-board" aria-labelledby="clients-title">
      <h2 id="clients-title" className="sr-only">
        Clients
      </h2>
      <div className="eg-toolbar">
        <label className="eg-search">
          <span className="sr-only">Search clients</span>
          <UiIcon name="search" size={15} />
          <input
            autoComplete="off"
            type="search"
            value={query}
            placeholder="Search clients or engagements"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="eg-empty">No clients match.</p>
      ) : (
        <div className="eg-list eg-clients">
          <div className="eg-list-head" aria-hidden="true">
            <span>Client</span>
            <span>Latest engagement</span>
            <span>Status</span>
            <span>Period end</span>
            <span />
          </div>
          <ul>
            {rows.map((row) => (
              <li key={row.id} className="eg-client-row">
                <span className="eg-client-name">
                  <strong>{row.name}</strong>
                  <small>
                    {row.count === 0
                      ? "No engagements yet"
                      : `${row.count} engagement${row.count === 1 ? "" : "s"}`}
                  </small>
                </span>
                <span className="eg-row-cell" data-label="Latest">
                  {row.latest !== null ? (
                    <a href={engagementHref(row.latest.id)}>
                      {row.latest.name}
                    </a>
                  ) : (
                    <Dash />
                  )}
                </span>
                <span className="eg-row-cell" data-label="Status">
                  {row.latest !== null ? (
                    <span
                      className={`eg-status is-${row.latest.status.toLowerCase()}`}
                    >
                      {statusLabel(row.latest.status)}
                    </span>
                  ) : (
                    <Dash />
                  )}
                </span>
                <span className="eg-row-cell" data-label="Period end">
                  {row.latest === null ? (
                    <Dash />
                  ) : row.latest.periodEnd !== null ? (
                    formatDate(row.latest.periodEnd)
                  ) : (
                    "Not set"
                  )}
                </span>
                <span className="eg-client-actions">
                  <a
                    className="btn btn-secondary btn-sm"
                    href={`${newHref}&client=${row.id}`}
                  >
                    <UiIcon name="plus" size={13} />
                    New engagement
                  </a>
                  {canRename ? (
                    <form
                      autoComplete="off"
                      method="post"
                      action="/workspace/clients"
                    >
                      <input
                        type="hidden"
                        name="organization_id"
                        value={organizationId}
                      />
                      <input type="hidden" name="client_id" value={row.id} />
                      <input type="hidden" name="version" value={row.version} />
                      <ConfirmAction
                        label="Rename"
                        intent="rename"
                        className="btn-ghost btn-sm"
                        tone="neutral"
                        title={`Rename ${row.name}`}
                        consequence="The new name shows on every engagement for this client, including launched and archived ones."
                        confirmLabel="Rename client"
                        field={{
                          name: "name",
                          label: "Client name",
                          kind: "text",
                          initial: row.name,
                          maxLength: 200,
                        }}
                      />
                    </form>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** An empty cell: a dash to the eye, "None" to a screen reader. */
function Dash() {
  return (
    <span className="eg-none">
      <span aria-hidden="true">&mdash;</span>
      <span className="sr-only">None</span>
    </span>
  );
}
