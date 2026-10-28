"use client";

import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import type { ActivityItem } from "./control-workspace-model";
import { centerHref, DEFAULT_QUERY } from "./evidence-center-model";
import { RequestUpload } from "./evidence-intake";
import type { EvidencePlan } from "./evidence-plan-model";
import { PHASE_SHORT } from "./evidence-plan-model";
import { Problem, RequirementRow, usePlanAction } from "./evidence-plan-view";
import {
  assignees,
  attributeCoverage,
  type EvidenceRequest,
  evidenceRequests,
  filterRequests,
  ITEM_STATUS,
  itemSummary,
  mappingLine,
  NO_FILTER,
  procedureCoverage,
  progressOf,
  REQUEST_PHASE_LABELS,
  REQUEST_PHASES,
  REQUEST_STATUS,
  type RequestFilter,
  type RequestItem,
  requestActivity,
  STATUS_FILTERS,
  type StatusFilter,
  UNASSIGNED,
  wordingOf,
} from "./evidence-requests-model";
import type { HeldFile, RequestRow } from "./evidence-workspace-model";
import { linkableFiles } from "./evidence-workspace-model";
import { fileLine, NO_UPLOAD } from "./evidence-workspace-view";
import type { MasterPlan } from "./planning-model";
import { AddEvidence } from "./planning-view";
import { RowMenu } from "./row-menu";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

type View = "list" | "groups" | "attributes" | "procedures";
type PanelTab = "items" | "attributes" | "procedures" | "guidance" | "activity";

/**
 * The Request step (product owner, 27 October 2026): the control's evidence as the
 * requests it travels in. A numbered list with each request's phase, where it stands, its
 * items and attributes, and how much has been provided, filtered by phase, status, and
 * assignee, with a search; the request picked opens beside the list with its items (each
 * with its own status, files, upload, and review actions), the attributes and procedures it
 * serves, the guidance for what each item must show, and its activity. The requests as
 * sent, and the coverage by attribute and by procedure, are the other views.
 */
export function EvidenceRequests({
  ids,
  plan,
  master,
  rows,
  canAct,
  files,
  applications,
  system,
  activity,
  sentRequests,
  controlRef,
  focusRequest,
}: {
  ids: Ids;
  plan: EvidencePlan;
  master: MasterPlan | null;
  rows: RequestRow[];
  canAct: boolean;
  files: HeldFile[];
  applications: Array<{ id: string; name: string }>;
  system: string | null;
  activity: ActivityItem[] | null;
  /** The requests as sent, with their review and approval (rendered on the server). */
  sentRequests: ReactNode;
  controlRef: string;
  /** The request a link names (?request=), opened on arrival. */
  focusRequest: string | null;
}) {
  const id = useId();
  const requests = useMemo(
    () => evidenceRequests(plan, rows, master),
    [plan, rows, master],
  );
  const [view, setView] = useState<View>("list");
  const [filter, setFilter] = useState<RequestFilter>(NO_FILTER);
  const [typed, setTyped] = useState("");
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(
    () =>
      requests.find((r) => r.request?.id === focusRequest)?.key ??
      requests[0]?.key ??
      null,
  );
  // The search settles 150 ms after the last key, so typing never refilters each letter.
  useEffect(() => {
    const timer = window.setTimeout(
      () => setFilter((current) => ({ ...current, search: typed })),
      150,
    );
    return () => window.clearTimeout(timer);
  }, [typed]);
  const shown = filterRequests(requests, filter);
  const open = requests.find((r) => r.key === selected) ?? null;
  const people = assignees(requests);
  const sent = rows.length;
  const coverage = attributeCoverage(requests, master);
  const uncovered = coverage.filter((a) => !a.covered).length;
  const tabs: Array<[View, string, ReactNode]> = [
    ["list", "Evidence list", null],
    [
      "groups",
      "Request groups",
      <span key="n" className="er-count">
        {sent}
      </span>,
    ],
    [
      "attributes",
      "Coverage by attribute",
      uncovered > 0 ? (
        <span
          key="n"
          className="er-count is-warn"
          title="Attributes without evidence"
        >
          {uncovered}
        </span>
      ) : null,
    ],
    ["procedures", "Coverage by procedure", null],
  ];
  const pick = (key: string) => {
    setSelected(key);
    setView("list");
  };
  return (
    <section className="er" aria-label="Evidence requests">
      <header className="er-head">
        <div className="er-tabs" role="tablist" aria-label="Evidence views">
          {tabs.map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`${id}-tab-${key}`}
              aria-selected={view === key}
              aria-controls={`${id}-view`}
              className={view === key ? "is-on" : undefined}
              onClick={() => setView(key)}
            >
              {label}
              {count}
            </button>
          ))}
        </div>
        <div className="er-head-actions">
          <RowMenu
            label="Bulk actions"
            trigger={{ label: "Bulk actions", icon: "more" }}
            items={[
              {
                label: "Approve and send in the Evidence center",
                icon: "mail",
                href: centerHref(ids, DEFAULT_QUERY, { q: controlRef }),
              },
              {
                label: "Assign owners",
                icon: "user",
                href: centerHref(ids, DEFAULT_QUERY, { assigning: true }),
              },
              {
                label: "Open in the Evidence center",
                icon: "inbox",
                href: centerHref(ids, DEFAULT_QUERY, { q: controlRef }),
              },
            ]}
          />
          {canAct && master !== null ? (
            <button
              type="button"
              className="btn btn-sm"
              aria-expanded={adding}
              onClick={() => setAdding((value) => !value)}
            >
              <UiIcon name="plus" size={14} />
              Add evidence
            </button>
          ) : null}
        </div>
      </header>
      {adding && master !== null ? (
        <div className="er-add">
          <AddEvidence
            ids={{
              organizationId: ids.organizationId,
              projectId: ids.projectId,
            }}
            plan={master}
            onDone={() => setAdding(false)}
          />
        </div>
      ) : null}
      <div
        id={`${id}-view`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${view}`}
      >
        {view === "list" ? (
          <div className={`er-layout${open !== null ? " has-panel" : ""}`}>
            <div className="er-main">
              <div className="er-filters">
                <Select
                  label="Phase"
                  value={filter.phase}
                  options={[
                    ["all", "All phases"],
                    ...REQUEST_PHASES.map(
                      (p) => [p, REQUEST_PHASE_LABELS[p]] as [string, string],
                    ),
                  ]}
                  onChange={(value) =>
                    setFilter((f) => ({
                      ...f,
                      phase: value as RequestFilter["phase"],
                    }))
                  }
                />
                <Select
                  label="Status"
                  value={filter.status}
                  options={STATUS_FILTERS.map(
                    ([key, label]) => [key, label] as [string, string],
                  )}
                  onChange={(value) =>
                    setFilter((f) => ({ ...f, status: value as StatusFilter }))
                  }
                />
                <Select
                  label="Assignee"
                  value={filter.assignee}
                  options={[
                    ["all", "All assignees"],
                    ...people.map((p) => [p, p] as [string, string]),
                    [UNASSIGNED, "Not assigned"],
                  ]}
                  onChange={(value) =>
                    setFilter((f) => ({ ...f, assignee: value }))
                  }
                />
                <label className="er-search">
                  <UiIcon name="search" size={14} />
                  <span className="sr-only">Search evidence requests</span>
                  <input
                    type="search"
                    value={typed}
                    placeholder="Search evidence requests…"
                    onChange={(event) => setTyped(event.target.value)}
                  />
                </label>
              </div>
              {shown.length === 0 ? (
                <p className="er-empty">
                  {requests.length === 0
                    ? "No evidence is planned for this control yet."
                    : "No request matches these filters."}
                </p>
              ) : (
                <ol className="er-list">
                  {shown.map((request) => (
                    <RequestCard
                      key={request.key}
                      request={request}
                      selected={request.key === selected}
                      onSelect={() => setSelected(request.key)}
                    />
                  ))}
                </ol>
              )}
            </div>
            {open !== null ? (
              <RequestPanel
                key={open.key}
                ids={ids}
                request={open}
                master={master}
                canAct={canAct}
                files={files}
                applications={applications}
                system={system}
                activity={activity}
                onClose={() => setSelected(null)}
                onMapping={() => setView("attributes")}
              />
            ) : null}
          </div>
        ) : null}
        {view === "groups" ? (
          <div className="er-sheet">
            <p className="er-lead">
              The requests as they go to the client, each with its review,
              approval, and what came back. A phase's list and its selected
              samples go out as separate requests.
            </p>
            {sent === 0 ? (
              <p className="er-empty">
                Nothing has been drafted yet. The requests are drafted once the
                test plan is approved.
              </p>
            ) : (
              sentRequests
            )}
          </div>
        ) : null}
        {view === "attributes" ? (
          <AttributeTable
            requests={requests}
            master={master}
            highlight={open}
            onPick={pick}
          />
        ) : null}
        {view === "procedures" ? (
          <ProcedureTable requests={requests} master={master} onPick={pick} />
        ) : null}
      </div>
    </section>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="er-select">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
      <UiIcon name="chevron" size={13} />
    </label>
  );
}

function StatusChip({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={`er-status ${tone}`}>
      <span aria-hidden="true" />
      {label}
    </span>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function RequestCard({
  request,
  selected,
  onSelect,
}: {
  request: EvidenceRequest;
  selected: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const progress = progressOf(request);
  const status = REQUEST_STATUS[request.status];
  return (
    <li className={`er-card${selected ? " is-selected" : ""}`}>
      <button
        type="button"
        className="er-card-main"
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className="er-num" aria-hidden="true">
          {request.number}
        </span>
        <span className="er-card-body">
          <span className="er-card-top">
            <strong>{request.title}</strong>
            <span className="er-phase">
              {REQUEST_PHASE_LABELS[request.phase]}
            </span>
          </span>
          <span className="er-card-desc">{request.description}</span>
          <span className="er-card-meta">
            <span>
              <UiIcon name="file" size={14} />
              {plural(request.items.length, "item")}
            </span>
            <span>
              <UiIcon name="tag" size={14} />
              {plural(request.attributeCodes.length, "attribute")}
            </span>
            <span className="er-progress">
              <span className="er-meter" aria-hidden="true">
                <span style={{ width: `${progress.share}%` }} />
              </span>
              {progress.line}
            </span>
          </span>
        </span>
        <StatusChip label={status.label} tone={status.tone} />
      </button>
      <button
        type="button"
        className="er-expand"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Hide" : "Show"} the items of ${request.title}`}
        onClick={() => setExpanded((value) => !value)}
      >
        <UiIcon name="chevron" size={14} />
      </button>
      {expanded ? (
        <ul className="er-card-items">
          {request.items.map((entry) => {
            const s = ITEM_STATUS[entry.status];
            return (
              <li key={entry.item.id}>
                <span>{entry.code || "·"}</span>
                {entry.item.title}
                <StatusChip label={s.label} tone={s.tone} />
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

function RequestPanel({
  ids,
  request,
  master,
  canAct,
  files,
  applications,
  system,
  activity,
  onClose,
  onMapping,
}: {
  ids: Ids;
  request: EvidenceRequest;
  master: MasterPlan | null;
  canAct: boolean;
  files: HeldFile[];
  applications: Array<{ id: string; name: string }>;
  system: string | null;
  activity: ActivityItem[] | null;
  onClose: () => void;
  onMapping: () => void;
}) {
  const id = useId();
  const [tab, setTab] = useState<PanelTab>("items");
  const action = usePlanAction(ids);
  const status = REQUEST_STATUS[request.status];
  const attributes = (master?.attributes ?? []).filter((a) =>
    request.attributeCodes.includes(a.code),
  );
  const procedures = (master?.procedures ?? []).filter((p) =>
    request.procedureCodes.includes(p.code),
  );
  const events = requestActivity(request, activity);
  const tabs: Array<[PanelTab, string, number | null]> = [
    ["items", "Items", request.items.length],
    ["attributes", "Attributes", attributes.length],
    ["procedures", "Procedures", procedures.length],
    ["guidance", "Guidance", null],
    ["activity", "Activity", null],
  ];
  return (
    <aside
      className="er-panel"
      aria-labelledby={`${id}-title`}
      aria-busy={action.pending}
    >
      <header className="er-panel-head">
        <h3 id={`${id}-title`}>{request.title}</h3>
        <StatusChip label={status.label} tone={status.tone} />
        <span className="er-panel-tools">
          {request.request !== null ? (
            <RowMenu
              label={request.title}
              items={[
                {
                  label: "Review the request as sent",
                  icon: "mail",
                  href: `?${new URLSearchParams({
                    organization: ids.organizationId,
                    project: ids.projectId,
                    section: "controls",
                    control: ids.controlId,
                    step: "request",
                    request: request.request.id,
                  }).toString()}`,
                },
              ]}
            />
          ) : null}
          <button
            type="button"
            className="er-close"
            aria-label="Close the request"
            onClick={onClose}
          >
            <UiIcon name="x" size={16} />
          </button>
        </span>
      </header>
      <p className="er-panel-desc">{request.description}</p>
      <div className="er-ptabs" role="tablist" aria-label="Request detail">
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`${id}-${key}`}
            aria-selected={tab === key}
            aria-controls={`${id}-body`}
            className={tab === key ? "is-on" : undefined}
            onClick={() => setTab(key)}
          >
            {label}
            {count !== null ? <span className="er-count">{count}</span> : null}
          </button>
        ))}
      </div>
      <div
        id={`${id}-body`}
        role="tabpanel"
        aria-labelledby={`${id}-${tab}`}
        className="er-panel-body"
      >
        {tab === "items" ? (
          <>
            <div className="er-map">
              <span className="er-map-icon" aria-hidden="true">
                <UiIcon name="table" size={16} />
              </span>
              <div>
                <strong>How this request maps to the test plan</strong>
                <p>{mappingLine(request)}</p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onMapping}
              >
                View mapping
              </button>
            </div>
            <ol className="er-items">
              {request.items.map((entry, index) => (
                <ItemCard
                  key={entry.item.id}
                  ids={ids}
                  number={index + 1}
                  entry={entry}
                  recipient={request.recipient}
                  canAct={canAct}
                  action={action}
                  files={files}
                  applications={applications}
                  system={system}
                />
              ))}
            </ol>
            {action.note ? <p className="cc-note">{action.note}</p> : null}
            <Problem text={action.problem} />
          </>
        ) : null}
        {tab === "attributes" ? (
          attributes.length === 0 ? (
            <p className="er-empty">
              No attribute of the test plan is linked to these items yet.
            </p>
          ) : (
            <ul className="er-rows">
              {attributes.map((attribute) => (
                <li key={attribute.code}>
                  <span className="er-code">{attribute.code}</span>
                  <div>
                    <p>{attribute.text}</p>
                    {attribute.passCriteria ? (
                      <p className="er-sub">
                        Passes when: {attribute.passCriteria}
                      </p>
                    ) : null}
                    <p className="er-sub">
                      Supported by{" "}
                      {request.items
                        .filter((i) =>
                          i.attributeCodes.includes(attribute.code),
                        )
                        .map((i) => i.code || i.item.title)
                        .join(", ")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : null}
        {tab === "procedures" ? (
          procedures.length === 0 ? (
            <p className="er-empty">
              No procedure of the test plan is performed on these items yet.
            </p>
          ) : (
            <ul className="er-rows">
              {procedures.map((procedure) => (
                <li key={procedure.code}>
                  <span className="er-code">{procedure.code}</span>
                  <div>
                    <p>{procedure.text}</p>
                    <p className="er-sub">{PHASE_SHORT[procedure.phase]}</p>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : null}
        {tab === "guidance" ? <Guidance request={request} /> : null}
        {tab === "activity" ? (
          events.length === 0 ? (
            <p className="er-empty">No activity on this request yet.</p>
          ) : (
            <ol className="er-activity">
              {events.map((event) => (
                <li key={event.id}>
                  <time dateTime={event.at}>
                    {new Date(event.at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                  <div>
                    <strong>{event.title}</strong>
                    <p className="er-sub">
                      {event.actor}
                      {event.detail ? ` · ${event.detail}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )
        ) : null}
      </div>
    </aside>
  );
}

function ItemCard({
  ids,
  number,
  entry,
  recipient,
  canAct,
  action,
  files,
  applications,
  system,
}: {
  ids: Ids;
  number: number;
  entry: RequestItem;
  recipient: string;
  canAct: boolean;
  action: ReturnType<typeof usePlanAction>;
  files: HeldFile[];
  applications: Array<{ id: string; name: string }>;
  system: string | null;
}) {
  const { item } = entry;
  const status = ITEM_STATUS[entry.status];
  const count = item.files.length;
  return (
    <li className="er-item">
      <div className="er-item-head">
        <span className="er-num is-small" aria-hidden="true">
          {number}
        </span>
        <div className="er-item-text">
          <strong>{item.title}</strong>
          <p>{itemSummary(item.description)}</p>
        </div>
        <div className="er-item-side">
          <StatusChip label={status.label} tone={status.tone} />
          {count > 0 ? (
            <span className="er-files">
              <UiIcon name="file" size={13} />
              {plural(count, "file")}
            </span>
          ) : null}
        </div>
      </div>
      <dl className="er-facts">
        <dt>Phase</dt>
        <dd>{REQUEST_PHASE_LABELS[item.phase]}</dd>
        <dt>Owner/Recipient</dt>
        <dd>{recipient || item.requestRecipient || "Not assigned"}</dd>
        <dt>Format</dt>
        <dd>{entry.format}</dd>
        <dt>Population</dt>
        <dd>{entry.population || "Not stated"}</dd>
      </dl>
      <p className="er-supports">
        <span>Supports</span>
        {entry.attributeCodes.length > 0 ? (
          entry.attributeCodes.map((code) => (
            <span key={code} className="er-chip">
              Attribute {code}
            </span>
          ))
        ) : (
          <span className="er-sub">No attribute linked</span>
        )}
      </p>
      <ul className="cc-list er-review">
        <RequirementRow
          item={item}
          canAct={canAct}
          action={action}
          linkable={linkableFiles(item, files)}
          compact
          bare
          upload={
            canAct &&
            item.requestId !== null &&
            !NO_UPLOAD.includes(item.state) ? (
              <RequestUpload
                organizationId={ids.organizationId}
                projectId={ids.projectId}
                requestId={item.requestId}
                requirementId={item.id}
                label={item.title}
                systems={
                  item.categories.includes("PROCESS_DOCUMENTATION")
                    ? applications
                    : []
                }
                system={system}
              />
            ) : null
          }
          fileLine={(file, form, setForm) =>
            fileLine(
              ids,
              file,
              files.find((held) => held.id === file.fileId),
              canAct,
              applications,
              form,
              setForm,
            )
          }
        />
      </ul>
    </li>
  );
}

function Guidance({ request }: { request: EvidenceRequest }) {
  return (
    <ol className="er-guide">
      {request.items.map(({ item }) => {
        const wording = wordingOf(item.description);
        return (
          <li key={item.id}>
            <strong>{item.title}</strong>
            {wording === null ? (
              <p>{item.description}</p>
            ) : (
              <>
                <p>{wording.lead}.</p>
                <h4>It must show</h4>
                <ul>
                  {wording.include.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {wording.completeness ? (
                  <p>
                    <b>Complete when</b> {wording.completeness}
                  </p>
                ) : null}
                {wording.notSufficient ? (
                  <p>
                    <b>Not sufficient</b> {wording.notSufficient}
                  </p>
                ) : null}
                {wording.alternatives.length > 0 ? (
                  <p>
                    <b>If not available</b> {wording.alternatives.join("; ")}
                  </p>
                ) : null}
              </>
            )}
            {item.sampleSelection ? (
              <p>
                <b>Samples</b> {item.sampleSelection}
              </p>
            ) : null}
            <p className="er-sub">
              <b>Why</b> {item.rationale}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function CodeChip({
  entry,
  onPick,
  requestKey,
}: {
  entry: RequestItem;
  onPick: (key: string) => void;
  requestKey: string;
}) {
  const s = ITEM_STATUS[entry.status];
  return (
    <button
      type="button"
      className={`er-code-chip ${s.tone}`}
      title={`${entry.item.title}: ${s.label}`}
      onClick={() => onPick(requestKey)}
    >
      {entry.code || entry.item.title.slice(0, 18)}
    </button>
  );
}

function AttributeTable({
  requests,
  master,
  highlight,
  onPick,
}: {
  requests: EvidenceRequest[];
  master: MasterPlan | null;
  highlight: EvidenceRequest | null;
  onPick: (key: string) => void;
}) {
  const rows = attributeCoverage(requests, master);
  const requestOf = (entry: RequestItem) =>
    requests.find((r) => r.items.includes(entry))?.key ?? "";
  if (rows.length === 0) {
    return (
      <p className="er-empty">
        The test plan has no attributes yet; coverage shows once it does.
      </p>
    );
  }
  return (
    <div className="er-sheet">
      <p className="er-lead">
        Each attribute of the test plan and the evidence items that support it,
        by phase. An attribute is covered when every operating phase requested
        has an item for it.
      </p>
      <table className="er-table">
        <thead>
          <tr>
            <th scope="col">Attribute</th>
            {REQUEST_PHASES.map((phase) => (
              <th key={phase} scope="col">
                {REQUEST_PHASE_LABELS[phase]}
              </th>
            ))}
            <th scope="col">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.code}
              className={
                highlight?.attributeCodes.includes(row.code)
                  ? "is-highlight"
                  : undefined
              }
            >
              <th scope="row">
                <span className="er-code">{row.code}</span>
                {row.text}
              </th>
              {REQUEST_PHASES.map((phase) => (
                <td key={phase}>
                  {row.byPhase[phase].length === 0 ? (
                    <span className="er-sub">—</span>
                  ) : (
                    row.byPhase[phase].map((entry) => (
                      <CodeChip
                        key={entry.item.id}
                        entry={entry}
                        requestKey={requestOf(entry)}
                        onPick={onPick}
                      />
                    ))
                  )}
                </td>
              ))}
              <td>
                <StatusChip
                  label={row.covered ? "Covered" : "Not covered"}
                  tone={row.covered ? "is-done" : "is-warn"}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProcedureTable({
  requests,
  master,
  onPick,
}: {
  requests: EvidenceRequest[];
  master: MasterPlan | null;
  onPick: (key: string) => void;
}) {
  const rows = procedureCoverage(requests, master);
  const requestOf = (entry: RequestItem) =>
    requests.find((r) => r.items.includes(entry))?.key ?? "";
  if (rows.length === 0) {
    return (
      <p className="er-empty">
        The test plan has no procedures yet; coverage shows once it does.
      </p>
    );
  }
  return (
    <div className="er-sheet">
      <p className="er-lead">
        Each procedure of the test plan and the evidence items it is performed
        on.
      </p>
      <table className="er-table">
        <thead>
          <tr>
            <th scope="col">Procedure</th>
            <th scope="col">Phase</th>
            <th scope="col">Evidence items</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.code}>
              <th scope="row">
                <span className="er-code">{row.code}</span>
                {row.text}
              </th>
              <td>{REQUEST_PHASE_LABELS[row.phase]}</td>
              <td>
                {row.items.length === 0 ? (
                  <span className="er-sub">No item linked</span>
                ) : (
                  row.items.map((entry) => (
                    <CodeChip
                      key={entry.item.id}
                      entry={entry}
                      requestKey={requestOf(entry)}
                      onPick={onPick}
                    />
                  ))
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
