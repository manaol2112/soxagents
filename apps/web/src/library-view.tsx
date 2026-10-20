"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useId, useRef, useState, useTransition } from "react";

import { FREQUENCY_LABELS, NATURE_LABELS } from "./control-context-model";
import { formatDate } from "./format";
import {
  type Attribute,
  approvable,
  CATEGORY_LABELS,
  type ChangeRequest,
  CONFIDENCE_LABELS,
  canGovern,
  FORM_LABELS,
  filterEntries,
  groupByDomain,
  LIBRARY_STATUSES,
  LIBRARY_TABS,
  type LibraryEntry,
  type LibraryFilter,
  type LibraryIndex,
  type LibraryStatus,
  type LibraryTab,
  libraryHref,
  libraryProblem,
  PURPOSE_LABELS,
  proceduresByPhase,
  REQUEST_KIND_LABELS,
  type References,
  referencesFor,
  STATUS_LABELS,
  STATUS_SHORT,
  STATUS_TONES,
  type StatusAction,
  statusActions,
  stepEvidence,
  suiteByPhase,
  TAB_LABELS,
} from "./library-model";
import type { LibraryPageState } from "./load-library";
import type { ShellModel } from "./shell-model";
import { UiIcon } from "./ui-icon";

type Ready = Extract<ShellModel, { status: "ready" }>;

const TYPE_LABELS: Record<string, string> = {
  PREVENTIVE: "Preventive",
  DETECTIVE: "Detective",
  UNCONFIRMED: "Type to confirm",
};

const sentence = (text: string) =>
  text === "" ? "" : text.charAt(0).toUpperCase() + text.slice(1);

function natureWord(nature: string): string {
  return (
    NATURE_LABELS[nature] ?? sentence(nature.replaceAll("_", " ").toLowerCase())
  );
}

function frequencyWord(frequency: string): string {
  return (
    FREQUENCY_LABELS[frequency] ??
    sentence(frequency.replaceAll("_", " ").toLowerCase())
  );
}

/** One call to the library route; refreshes the page when it succeeds. */
function useAction(organizationId: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // The last successful call's answer, for a caller that reports what was done.
  const answer = useRef<unknown>(null);
  async function run(
    label: string,
    fields: Record<string, unknown>,
  ): Promise<boolean> {
    setBusy(label);
    setProblem(null);
    answer.current = null;
    let status = 0;
    let detail = "";
    try {
      const response = await fetch("/workspace/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organization_id: organizationId, ...fields }),
      });
      const reply = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
        body?: unknown;
      };
      status = typeof reply.status === "number" ? reply.status : 0;
      detail = typeof reply.detail === "string" ? reply.detail : "";
      answer.current = reply.body ?? null;
    } catch {
      status = 0;
    }
    setBusy("");
    const message = libraryProblem(status, detail);
    setProblem(message);
    if (message === null) {
      startTransition(() => router.refresh());
    }
    return message === null;
  }
  return {
    run,
    busy,
    pending: pending || busy !== "",
    problem,
    answer: () => answer.current,
  };
}

function Problem({ text }: { text: string | null }) {
  return text === null ? null : (
    <p className="lb-problem" role="alert">
      {text}
    </p>
  );
}

function StatusPill({ status }: { status: LibraryStatus }) {
  return (
    <span className={`pill pill-dot ${STATUS_TONES[status]}`}>
      {STATUS_SHORT[status]}
    </span>
  );
}

function Header({
  title,
  context,
  description,
  badge,
  actions,
}: {
  title: string;
  context: string;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="page-context">{context}</p>
        <div className="page-title">
          <h1>{title}</h1>
          {badge}
        </div>
        {description === undefined ? null : (
          <p className="page-desc">{description}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="page-actions">{actions}</div>
      )}
    </header>
  );
}

/** The firm's standard library: the index of standard controls, or one of them. */
export function LibraryPage({
  model,
  library,
}: {
  model: Ready;
  library: LibraryPageState | null;
}) {
  const projectId = model.selectedProject?.id ?? null;
  if (library === null || library.index === null) {
    return (
      <div className="page lb-page">
        <Header title="Standard library" context="Methodology" />
        <section className="card lb-empty">
          <h2>The library could not be loaded</h2>
          <p>Wait a moment and refresh the page.</p>
        </section>
      </div>
    );
  }
  if (library.controlKey !== null) {
    if (library.entry === null) {
      return (
        <div className="page lb-page">
          <Header title="Standard library" context="Methodology" />
          <section className="card lb-empty">
            <h2>That standard control is not in the library</h2>
            <p>
              <a href={libraryHref(model.organization.id, projectId)}>
                Back to the library
              </a>
            </p>
          </section>
        </div>
      );
    }
    return (
      <EntryView
        organizationId={model.organization.id}
        projectId={projectId}
        entry={library.entry}
        tab={library.tab}
      />
    );
  }
  return (
    <IndexView
      organizationId={model.organization.id}
      projectId={projectId}
      role={model.organization.role}
      index={library.index}
      filter={{
        category: library.category,
        status: library.status,
        query: library.query,
      }}
    />
  );
}

// The index

function IndexView({
  organizationId,
  projectId,
  role,
  index,
  filter: initial,
}: {
  organizationId: string;
  projectId: string | null;
  role: string;
  index: LibraryIndex;
  filter: LibraryFilter;
}) {
  const [query, setQuery] = useState(initial.query);
  const [proposing, setProposing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<string | null>(null);
  const action = useAction(organizationId);
  const decides = canGovern(role);
  const filter = { ...initial, query };
  const rows = filterEntries(index.entries, filter);
  const groups = groupByDomain(rows);
  const open = rows.filter(approvable);
  const chosen = index.entries.filter(
    (entry) => selected.has(entry.libraryKey) && approvable(entry),
  );
  const choose = (keys: string[], on: boolean) => {
    const next = new Set(selected);
    for (const key of keys) {
      if (on) {
        next.add(key);
      } else {
        next.delete(key);
      }
    }
    setSelected(next);
    setOutcome(null);
  };
  async function approveChosen() {
    const keys = chosen.map((entry) => entry.libraryKey);
    const done = await action.run("approve-many", {
      intent: "status-many",
      library_keys: keys,
      status: "APPROVED",
      note,
    });
    if (!done) {
      return;
    }
    const answer = action.answer() as { decided?: unknown } | null;
    const decided = Array.isArray(answer?.decided)
      ? answer.decided.length
      : keys.length;
    setOutcome(
      `Approved ${decided} standard ${decided === 1 ? "control" : "controls"} at version ${index.libraryVersion}.`,
    );
    setSelected(new Set());
    setNote("");
  }
  const href = (patch: Partial<LibraryFilter>) =>
    libraryHref(organizationId, projectId, {
      category: patch.category === undefined ? filter.category : patch.category,
      status: patch.status === undefined ? filter.status : patch.status,
      query,
    });
  const total = index.entries.length;
  const figures: Array<[LibraryStatus | null, string, number]> = [
    [null, "Standard controls", total],
    ...LIBRARY_STATUSES.map((status): [LibraryStatus, string, number] => [
      status,
      STATUS_LABELS[status],
      index.counts[status] ?? 0,
    ]).filter(([status, , count]) => count > 0 || status === "APPROVED"),
  ];
  return (
    <div className="page lb-page">
      <Header
        title="Standard library"
        context="Methodology"
        badge={<span className="pill">Version {index.libraryVersion}</span>}
        description="The standard controls, how each is tested, and the firm's methodology review of each. An engagement plans from the library; a person approves every plan."
        actions={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setProposing(!proposing)}
          >
            Propose a new standard control
          </button>
        }
      />
      {proposing ? (
        <section className="card lb-card">
          <h2>Propose a new standard control</h2>
          <RequestForm
            organizationId={organizationId}
            libraryKey={null}
            onDone={() => setProposing(false)}
          />
        </section>
      ) : null}
      <ul className="lb-figures" aria-label="Where the library stands">
        {figures.map(([status, label, count]) => (
          <li key={status ?? "all"}>
            <a
              href={href({ status })}
              aria-current={filter.status === status ? "page" : undefined}
            >
              <strong>{count}</strong>
              <span>{label}</span>
            </a>
          </li>
        ))}
      </ul>
      <section className="card lb-card lb-index">
        <div className="lb-filters">
          <nav className="lb-categories" aria-label="Category">
            <a
              href={href({ category: null })}
              aria-current={filter.category === null ? "page" : undefined}
            >
              All
            </a>
            {index.categories.map((category) => (
              <a
                key={category.key}
                href={href({ category: category.key })}
                aria-current={
                  filter.category === category.key ? "page" : undefined
                }
              >
                {category.label}
                <span>{category.entries}</span>
              </a>
            ))}
          </nav>
          <label className="lb-search">
            <UiIcon name="search" size={14} />
            <span className="sr-only">Search the library</span>
            <input
              type="search"
              value={query}
              placeholder="Search by ID, title, area, or objective"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        {filter.status !== null ? (
          <p className="lb-filter-line">
            Showing {STATUS_LABELS[filter.status].toLowerCase()} ·{" "}
            <a href={href({ status: null })}>Show all</a>
          </p>
        ) : null}
        {decides && chosen.length > 0 ? (
          <section
            className="lb-batch"
            aria-label="Approve selected standard controls"
            aria-busy={action.pending}
          >
            <strong>{chosen.length} selected</strong>
            <span className="lb-batch-note">
              Each is approved and recorded on its own, at version{" "}
              {index.libraryVersion}.
            </span>
            <input
              type="text"
              maxLength={1000}
              value={note}
              aria-label="Note for each approval"
              placeholder="Note for each approval (optional)"
              onChange={(event) => setNote(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-sm"
              disabled={action.pending}
              onClick={approveChosen}
            >
              <UiIcon name="check" size={14} />
              {action.busy === "approve-many"
                ? "Approving…"
                : `Approve ${chosen.length}`}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={action.pending}
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
          </section>
        ) : decides && open.length > 0 ? (
          <p className="lb-select-line">
            <button
              type="button"
              className="lb-link"
              onClick={() =>
                choose(
                  open.map((entry) => entry.libraryKey),
                  true,
                )
              }
            >
              Select all {open.length} awaiting approval
            </button>
          </p>
        ) : null}
        <Problem text={action.problem} />
        {outcome === null ? null : (
          <p className="lb-outcome" role="status">
            <UiIcon name="check" size={14} />
            {outcome}
          </p>
        )}
        {groups.length === 0 ? (
          <p className="lb-quiet">No standard control matches.</p>
        ) : (
          groups.map((group) => (
            <section key={group.domain} className="lb-group">
              <GroupHeading
                label={group.label}
                count={group.entries.length}
                keys={
                  decides
                    ? group.entries
                        .filter(approvable)
                        .map((entry) => entry.libraryKey)
                    : []
                }
                selected={selected}
                onChoose={choose}
              />
              <ul className={`lb-list${decides ? " is-selectable" : ""}`}>
                {group.entries.map((entry) => (
                  <li
                    key={entry.libraryKey}
                    className={
                      selected.has(entry.libraryKey) ? "is-selected" : undefined
                    }
                  >
                    {decides ? (
                      approvable(entry) ? (
                        <label className="lb-check">
                          <input
                            type="checkbox"
                            checked={selected.has(entry.libraryKey)}
                            onChange={(event) =>
                              choose([entry.libraryKey], event.target.checked)
                            }
                          />
                          <span className="sr-only">
                            Select {entry.controlRef} {entry.title}
                          </span>
                        </label>
                      ) : (
                        <span className="lb-check" aria-hidden="true" />
                      )
                    ) : null}
                    <a
                      href={libraryHref(organizationId, projectId, {
                        control: entry.libraryKey,
                      })}
                    >
                      <span className="lb-ref">{entry.controlRef}</span>
                      <span className="lb-row-main">
                        <strong>{entry.title}</strong>
                        <small>
                          {[
                            natureWord(entry.nature),
                            frequencyWord(entry.frequency),
                            TYPE_LABELS[entry.controlType] ?? "",
                          ]
                            .filter((part) => part !== "")
                            .join(" · ")}
                        </small>
                      </span>
                      <span className="lb-row-counts">
                        {entry.procedures}{" "}
                        {entry.procedures === 1 ? "procedure" : "procedures"} ·{" "}
                        {entry.attributesTested}{" "}
                        {entry.attributesTested === 1
                          ? "attribute"
                          : "attributes"}
                        {entry.attributesProposed > 0
                          ? ` · ${entry.attributesProposed} client-dependent`
                          : ""}
                        {entry.usageEngagements > 0
                          ? ` · in ${entry.usageEngagements} ${entry.usageEngagements === 1 ? "engagement" : "engagements"}`
                          : ""}
                      </span>
                      {entry.openRequests > 0 ? (
                        <span
                          className="lb-flag"
                          title="A change to this control awaits a decision"
                        >
                          {entry.openRequests}
                        </span>
                      ) : null}
                      <StatusPill status={entry.status} />
                      <UiIcon name="chevron" size={14} />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </section>
      {index.newRequests.length > 0 ? (
        <section className="card lb-card">
          <h2>Proposed new standard controls</h2>
          <Requests
            organizationId={organizationId}
            requests={index.newRequests}
            canDecide={canGovern(role)}
          />
        </section>
      ) : null}
    </div>
  );
}

/** An area's heading; for a decider, with a box that selects the area's controls awaiting
 * approval (checked when all are, mixed when some are). */
function GroupHeading({
  label,
  count,
  keys,
  selected,
  onChoose,
}: {
  label: string;
  count: number;
  keys: string[];
  selected: Set<string>;
  onChoose: (keys: string[], on: boolean) => void;
}) {
  const picked = keys.filter((key) => selected.has(key)).length;
  return (
    <div className="lb-group-head">
      <h3>
        {label} <span>{count}</span>
      </h3>
      {keys.length > 0 ? (
        <label className="lb-group-select">
          <input
            type="checkbox"
            checked={picked === keys.length}
            ref={(box) => {
              if (box !== null) {
                box.indeterminate = picked > 0 && picked < keys.length;
              }
            }}
            onChange={(event) => onChoose(keys, event.target.checked)}
          />
          Select {keys.length} awaiting approval
        </label>
      ) : null}
    </div>
  );
}

// One standard control

function EntryView({
  organizationId,
  projectId,
  entry,
  tab,
}: {
  organizationId: string;
  projectId: string | null;
  entry: LibraryEntry;
  tab: LibraryTab;
}) {
  const { row, governance } = entry;
  const tabHref = (key: LibraryTab) =>
    libraryHref(organizationId, projectId, {
      control: row.libraryKey,
      tab: key,
    });
  const counts: Record<LibraryTab, string> = {
    procedures: String(entry.procedures.length),
    attributes:
      row.attributesProposed > 0
        ? `${row.attributesTested} + ${row.attributesProposed}`
        : String(row.attributesTested),
    evidence: String(
      entry.evidenceSuite.length > 0
        ? entry.evidenceSuite.length
        : entry.evidence.length,
    ),
    design: "",
    usage: String(entry.usage.length),
  };
  const [proposing, setProposing] = useState(false);
  const refs = referencesFor(entry);
  return (
    <div className="page lb-page lb-entry">
      <nav className="lb-crumbs" aria-label="Breadcrumb">
        <a
          href={libraryHref(organizationId, projectId, {
            category: row.category,
          })}
        >
          <span aria-hidden="true">←</span> Standard library
        </a>
        <span aria-hidden="true">/</span>
        <span>{CATEGORY_LABELS[row.category]}</span>
        <span aria-hidden="true">/</span>
        <span>{row.controlRef}</span>
      </nav>
      <header className="lb-head">
        <div className="lb-head-main">
          <p className="lb-kicker">
            <span className="lb-ref">{row.controlRef}</span>
            <span>{row.domainLabel}</span>
          </p>
          <div className="lb-title-row">
            <h1>{row.title}</h1>
            <StatusPill status={governance.status} />
          </div>
          <p className="lb-meta">
            {[
              natureWord(row.nature),
              frequencyWord(row.frequency),
              TYPE_LABELS[row.controlType] ?? "",
              `Version ${entry.definitionVersion}`,
            ]
              .filter((part) => part !== "")
              .map((part) => (
                <span key={part}>{part}</span>
              ))}
          </p>
        </div>
        <GovernancePanel
          organizationId={organizationId}
          libraryKey={row.libraryKey}
          governance={governance}
        />
      </header>
      <section className="lb-lead" aria-label="Objective and risk">
        <div>
          <h2>Objective</h2>
          <p>{row.objective || entry.activity}</p>
        </div>
        <div>
          <h2>Risk</h2>
          <p>{entry.statement?.risk || entry.risk}</p>
        </div>
      </section>
      <section className="card lb-body">
        <nav className="lb-tabs" aria-label="The standard control">
          {LIBRARY_TABS.map((key) => (
            <a
              key={key}
              href={tabHref(key)}
              aria-current={tab === key ? "page" : undefined}
            >
              {TAB_LABELS[key]}
              {counts[key] !== "" ? <span>{counts[key]}</span> : null}
            </a>
          ))}
        </nav>
        <div className="lb-panel">
          {tab === "procedures" ? (
            <ProceduresTab
              entry={entry}
              refs={refs}
              attributesHref={tabHref("attributes")}
              evidenceHref={tabHref("evidence")}
            />
          ) : tab === "attributes" ? (
            <AttributesTab entry={entry} refs={refs} />
          ) : tab === "evidence" ? (
            <EvidenceTab entry={entry} refs={refs} />
          ) : tab === "design" ? (
            <DesignTab entry={entry} />
          ) : (
            <UsageTab entry={entry} organizationId={organizationId} />
          )}
        </div>
      </section>
      <Applicability entry={entry} />
      <section className="card lb-card">
        <div className="lb-card-head">
          <h2>
            Changes proposed{" "}
            {entry.changeRequests.length > 0 ? (
              <span>{entry.changeRequests.length}</span>
            ) : null}
          </h2>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setProposing(!proposing)}
          >
            Propose a change
          </button>
        </div>
        {proposing ? (
          <RequestForm
            organizationId={organizationId}
            libraryKey={row.libraryKey}
            onDone={() => setProposing(false)}
          />
        ) : null}
        {entry.changeRequests.length === 0 && !proposing ? (
          <p className="lb-quiet">
            No change has been proposed. A proposal goes to a methodology
            reviewer; an accepted one is applied in the next library version.
          </p>
        ) : (
          <Requests
            organizationId={organizationId}
            requests={entry.changeRequests}
            canDecide={governance.canDecide}
          />
        )}
      </section>
    </div>
  );
}

function GovernancePanel({
  organizationId,
  libraryKey,
  governance,
}: {
  organizationId: string;
  libraryKey: string;
  governance: LibraryEntry["governance"];
}) {
  const action = useAction(organizationId);
  const noteId = useId();
  const [chosen, setChosen] = useState<StatusAction | null>(null);
  const [note, setNote] = useState("");
  const actions = statusActions(governance.status);
  const primary = actions.find((item) => item.primary);
  const rest = actions.filter((item) => !item.primary);
  const line =
    governance.status === "APPROVED" && governance.approvedBy
      ? `Approved by ${governance.approvedBy}${governance.approvedAt ? ` on ${formatDate(governance.approvedAt)}` : ""}, library version ${governance.approvedVersion ?? governance.libraryVersion}.`
      : governance.status === "SUPERSEDED"
        ? `Approved at library version ${governance.approvedVersion ?? "?"}${governance.approvedBy ? ` by ${governance.approvedBy}` : ""}; version ${governance.libraryVersion} awaits approval.`
        : governance.decidedBy && governance.decidedAt
          ? `${STATUS_LABELS[governance.status]} · ${governance.decidedBy}, ${formatDate(governance.decidedAt)}.`
          : "No methodology decision recorded: the published definition is a reviewer's draft.";
  return (
    <div className="lb-govern" aria-busy={action.pending}>
      <p className="lb-govern-line">{line}</p>
      {governance.note !== "" ? (
        <p className="lb-govern-note">{governance.note}</p>
      ) : null}
      {governance.canDecide && chosen === null ? (
        <div className="lb-govern-actions">
          {primary !== undefined ? (
            <button
              type="button"
              className="btn btn-sm"
              disabled={action.pending}
              title={
                primary.status === "APPROVED"
                  ? "Records this version as the firm's methodology for new plans. It changes nothing in engagements already planned."
                  : undefined
              }
              onClick={async () => {
                // A decision that needs no reason is made in one click; a note, when
                // wanted, is added through its own control.
                if (primary.needsNote) {
                  setChosen(primary);
                  setNote("");
                  return;
                }
                await action.run("status", {
                  intent: "status",
                  library_key: libraryKey,
                  status: primary.status,
                  note: "",
                });
              }}
            >
              {primary.status === "APPROVED" ? (
                <UiIcon name="check" size={13} />
              ) : null}
              {primary.label}
            </button>
          ) : null}
          {primary !== undefined && !primary.needsNote ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={action.pending}
              onClick={() => {
                setChosen(primary);
                setNote("");
              }}
            >
              {primary.status === "APPROVED"
                ? "Approve with a note"
                : "Add a note"}
            </button>
          ) : null}
          {rest.map((item) => (
            <button
              key={item.status}
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={action.pending}
              onClick={() => {
                setChosen(item);
                setNote("");
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      {chosen !== null ? (
        <div className="lb-decide">
          <label htmlFor={noteId}>
            {chosen.status === "APPROVED"
              ? "Note kept with the approval"
              : chosen.needsNote
                ? "Why (required), kept with the decision"
                : "Note (optional)"}
          </label>
          <textarea
            id={noteId}
            rows={2}
            maxLength={1000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="lb-decide-buttons">
            <button
              type="button"
              className="btn btn-sm"
              disabled={
                action.pending ||
                (chosen.needsNote && note.trim().length < 10) ||
                (chosen.primary && !chosen.needsNote && note.trim() === "")
              }
              onClick={async () => {
                const done = await action.run("status", {
                  intent: "status",
                  library_key: libraryKey,
                  status: chosen.status,
                  note,
                });
                if (done) {
                  setChosen(null);
                }
              }}
            >
              {chosen.label}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setChosen(null)}
            >
              Cancel
            </button>
          </div>
          {chosen.status === "APPROVED" ? (
            <p className="lb-sub">
              Approving records this version as the firm's methodology for new
              plans. It changes nothing in engagements already planned.
            </p>
          ) : null}
        </div>
      ) : null}
      <Problem text={action.problem} />
    </div>
  );
}

function Row({
  code,
  title,
  aside,
  children,
  id,
}: {
  code: string;
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <li id={id}>
      <details className="lb-row">
        <summary>
          <span className="lb-code">{code}</span>
          <span className="lb-row-title">{title}</span>
          {aside}
          <UiIcon name="chevron" size={14} />
        </summary>
        <div className="lb-row-body">{children}</div>
      </details>
    </li>
  );
}

function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  const shown = items.filter(
    ([, value]) => value !== "" && value !== null && value !== undefined,
  );
  return shown.length === 0 ? null : (
    <dl className="lb-facts">
      {shown.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A list as a fact: nothing when it is empty, so the fact is left out. */
const listOr = (items: string[]): ReactNode =>
  items.length === 0 ? "" : <List items={items} />;

function List({ items }: { items: string[] }) {
  return items.length === 0 ? null : (
    <ul className="lb-bullets">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function ProceduresTab({
  entry,
  refs,
  attributesHref,
  evidenceHref,
}: {
  entry: LibraryEntry;
  refs: References;
  attributesHref: string;
  evidenceHref: string;
}) {
  const wording = new Map(
    entry.attributes.map((item) => [item.key, item.text]),
  );
  const groups = proceduresByPhase(entry.procedures);
  if (groups.length === 0) {
    return <p className="lb-quiet">No procedure is defined yet.</p>;
  }
  const stepped = entry.procedures.some((item) => item.steps.length > 0);
  return (
    <div className="lb-sections">
      {stepped ? (
        <p className="lb-section-note">
          Each procedure is written as numbered steps: what the tester does, the
          evidence it uses from the standard evidence suite, what the workpaper
          records, and what to do when it does not hold.
        </p>
      ) : null}
      {groups.map((group) => (
        <section key={group.phase} className="lb-section">
          <h3>
            {group.label} <span>{group.items.length}</span>
          </h3>
          <ul className="lb-rows">
            {group.items.map((item) => (
              <Row
                key={item.key}
                id={`lb-proc-${item.key}`}
                code={refs.procedure(item.key)}
                title={item.objective}
                aside={
                  item.attributes.length > 0 ? (
                    <span className="lb-chips">
                      <span>Tests</span>
                      {item.attributes.map((key) => (
                        <a
                          key={key}
                          className="lb-chip"
                          href={`${attributesHref}#lb-attr-${key}`}
                          title={wording.get(key) ?? ""}
                        >
                          {refs.attribute(key)}
                        </a>
                      ))}
                    </span>
                  ) : undefined
                }
              >
                <p className="lb-text">{item.action}</p>
                {item.steps.length > 0 ? (
                  <ol className="lb-steps">
                    {item.steps.map((step) => (
                      <li key={step.action}>
                        <p className="lb-step-action">{step.action}</p>
                        {step.evidence.length > 0 ? (
                          <p className="lb-step-evidence">
                            <span>Evidence</span>
                            {stepEvidence(step, entry.evidenceSuite).map(
                              (used) => (
                                <a
                                  key={used.key}
                                  className="lb-chip"
                                  href={`${evidenceHref}#lb-ev-${used.key}`}
                                  title={used.name}
                                >
                                  {refs.evidence(used.key)}
                                </a>
                              ),
                            )}
                          </p>
                        ) : null}
                        <dl className="lb-step-notes">
                          {step.record !== "" ? (
                            <div>
                              <dt>Record</dt>
                              <dd>{step.record}</dd>
                            </div>
                          ) : null}
                          {step.exception !== "" ? (
                            <div>
                              <dt>If it does not hold</dt>
                              <dd>{step.exception}</dd>
                            </div>
                          ) : null}
                        </dl>
                      </li>
                    ))}
                  </ol>
                ) : null}
                <Facts
                  items={[
                    ["Evidence", listOr(item.evidence)],
                    ["Limitation", item.limitation],
                  ]}
                />
              </Row>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AttributeRow({ item, refs }: { item: Attribute; refs: References }) {
  return (
    <Row
      id={`lb-attr-${item.key}`}
      code={refs.attribute(item.key)}
      title={item.text}
      aside={
        item.confidence !== "HIGH" ? (
          <span
            className={`pill ${item.tested ? "" : "tone-warning"}`}
            title="How well the sources support this attribute"
          >
            {CONFIDENCE_LABELS[item.confidence] ?? item.confidence}
          </span>
        ) : undefined
      }
    >
      {item.question !== "" ? (
        <p className="lb-question">
          <UiIcon name="info" size={13} />
          {item.question}
        </p>
      ) : null}
      <Facts
        items={[
          ["Condition tested", item.condition],
          ["Why", item.why],
          ["Passes when", item.passes],
          ["Exception when", item.fails],
          ["Insufficient evidence when", item.insufficient],
          ["A person decides when", item.review],
          ["Never inferred", item.notInfer],
          ["Compare", item.compare],
          ["Evidence", listOr(item.evidence)],
          ["Data to extract", listOr(item.extract)],
          ["Assumptions", listOr(item.assumptions)],
          ["Source", item.basis.join("; ")],
        ]}
      />
    </Row>
  );
}

function AttributesTab({
  entry,
  refs,
}: {
  entry: LibraryEntry;
  refs: References;
}) {
  const tested = entry.attributes.filter((item) => item.tested);
  const proposed = entry.attributes.filter((item) => !item.tested);
  if (entry.attributes.length === 0) {
    return <p className="lb-quiet">No attribute is defined yet.</p>;
  }
  return (
    <div className="lb-sections">
      <section className="lb-section">
        <h3>
          Tested <span>{tested.length}</span>
        </h3>
        <p className="lb-section-note">
          The attributes an engagement tests, supported by the control as
          described or a source that applies.
        </p>
        <ul className="lb-rows">
          {tested.map((item) => (
            <AttributeRow key={item.key} item={item} refs={refs} />
          ))}
        </ul>
      </section>
      {proposed.length > 0 ? (
        <section className="lb-section">
          <h3>
            Depends on the client <span>{proposed.length}</span>
          </h3>
          <p className="lb-section-note">
            Each depends on something the sources do not establish and is
            decided here, with the standard. An engagement receives it approved,
            with its question; testing waits for any client value it shows in
            brackets.
          </p>
          <ul className="lb-rows">
            {proposed.map((item) => (
              <AttributeRow key={item.key} item={item} refs={refs} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** The attributes an evidence item supports, each by its reference and wording. */
function supported(
  keys: readonly string[],
  refs: References,
  wording: ReadonlyMap<string, string>,
): ReactNode {
  return (
    <ul className="lb-bullets lb-refs">
      {keys.map((key) => (
        <li key={key}>
          <span className="lb-chip">{refs.attribute(key)}</span>
          {wording.get(key) ?? key}
        </li>
      ))}
    </ul>
  );
}

function EvidenceTab({
  entry,
  refs,
}: {
  entry: LibraryEntry;
  refs: References;
}) {
  const byProcedure = entry.procedures.filter(
    (item) => item.evidence.length > 0,
  );
  const suite = suiteByPhase(entry.evidenceSuite);
  const wording = new Map(
    entry.attributes.map((item) => [item.key, item.text]),
  );
  return (
    <div className="lb-sections">
      {suite.length > 0 ? (
        <section className="lb-section">
          <h3>
            Standard evidence suite <span>{entry.evidenceSuite.length}</span>
          </h3>
          <p className="lb-section-note">
            What an engagement asks the client for, in the form that can show
            what the test needs. The planner builds the evidence requests of a
            control that follows this standard from these items; what does not
            serve in their place is stated so it is not accepted.
          </p>
          {suite.map((group) => (
            <div key={group.phase} className="lb-suite-phase">
              <h4>
                {group.label} <span>{group.items.length}</span>
              </h4>
              <ul className="lb-rows">
                {group.items.map((item) => (
                  <Row
                    key={`${group.phase}-${item.key}`}
                    {...(group.phase === item.phases[0]
                      ? { id: `lb-ev-${item.key}` }
                      : {})}
                    code={refs.evidence(item.key)}
                    title={item.name}
                    aside={
                      <span className="lb-chips">
                        <span className="pill">
                          {FORM_LABELS[item.form] ?? sentence(item.form)}
                        </span>
                        <span className="pill">
                          {PURPOSE_LABELS[item.purpose] ??
                            sentence(item.purpose)}
                        </span>
                      </span>
                    }
                  >
                    <Facts
                      items={[
                        ["Provided by", item.provider],
                        ["Covers", item.period],
                        ["Shows", listOr(item.contents)],
                        ["Complete when", item.completeness],
                        ["Not acceptable", item.notAcceptable],
                        ["Alternatives", listOr(item.alternatives)],
                        [
                          "Supports",
                          item.attributes.length === 0
                            ? ""
                            : supported(item.attributes, refs, wording),
                        ],
                      ]}
                    />
                  </Row>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}
      {suite.length > 0 ? null : (
        <section className="lb-section">
          <h3>
            What an engagement requests <span>{entry.evidence.length}</span>
          </h3>
          {entry.evidence.length === 0 ? (
            <p className="lb-quiet">No evidence item is named.</p>
          ) : (
            <ul className="lb-plain">
              {entry.evidence.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      {suite.length === 0 && byProcedure.length > 0 ? (
        <section className="lb-section">
          <h3>By procedure</h3>
          <ul className="lb-rows">
            {byProcedure.map((item) => (
              <Row
                key={item.key}
                code={refs.procedure(item.key)}
                title={item.objective}
              >
                <List items={item.evidence} />
              </Row>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function DesignTab({ entry }: { entry: LibraryEntry }) {
  const statement = entry.statement;
  if (statement === null) {
    return <p className="lb-quiet">No design statement is defined yet.</p>;
  }
  return (
    <div className="lb-sections">
      <section className="lb-section">
        <h3>The control as its documentation should state it</h3>
        <p className="lb-statement">{statement.text}</p>
        <p className="lb-section-note">
          A value in brackets is the client's: an engagement records it at
          setup, and testing waits for the ones that define a population or a
          precision.
        </p>
      </section>
      <section className="lb-section">
        <h3>Design</h3>
        <Facts
          items={[
            ["Performed by", statement.operator],
            ["Reviewed by", statement.reviewer],
            ["Owner", statement.owner],
            ["Authority and competence", statement.authority],
            [
              "Judgment",
              `${sentence(statement.judgment.toLowerCase())}${statement.judgmentNote ? `: ${statement.judgmentNote}` : ""}`,
            ],
            ["Precision", statement.precision],
            ["Investigation", statement.investigation],
            ["Evidence left", statement.evidence],
            ["Applies when", statement.appliesWhen],
            [
              "Assertions",
              statement.assertions
                .map((item) =>
                  sentence(item.replaceAll("_", " ").toLowerCase()),
                )
                .join(", "),
            ],
            ["IT risk", statement.itRisk],
            ["COSO principle", statement.principle],
          ]}
        />
      </section>
      {statement.information.length > 0 ? (
        <section className="lb-section">
          <h3>Information the control uses</h3>
          <ul className="lb-plain">
            {statement.information.map((item) => (
              <li key={item.name}>
                <strong>{item.name}</strong>
                {" · "}
                {sentence(item.kind.replaceAll("_", " ").toLowerCase())}
                {item.elements.length > 0
                  ? ` · ${item.elements.join(", ")}`
                  : ""}
                {item.ipe !== ""
                  ? ` · completeness and accuracy: ${item.ipe}`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {statement.itgcs.length > 0 ? (
        <section className="lb-section">
          <h3>IT general controls relied on</h3>
          <List items={statement.itgcs} />
        </section>
      ) : null}
      {statement.slots.length > 0 ? (
        <section className="lb-section">
          <h3>
            Client values <span>{statement.slots.length}</span>
          </h3>
          <ul className="lb-rows">
            {statement.slots.map((slot) => (
              <Row
                key={slot.key}
                code={sentence(slot.kind.toLowerCase())}
                title={slot.label}
                aside={
                  slot.blocks ? (
                    <span className="pill tone-warning">Holds testing</span>
                  ) : undefined
                }
              >
                <Facts
                  items={[
                    ["Why", slot.why],
                    ["Example", slot.example],
                  ]}
                />
              </Row>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function UsageTab({
  entry,
  organizationId,
}: {
  entry: LibraryEntry;
  organizationId: string;
}) {
  if (entry.usage.length === 0) {
    return (
      <p className="lb-quiet">
        No engagement in the firm has this control in scope.
      </p>
    );
  }
  return (
    <ul className="lb-usage">
      {entry.usage.map((item) => (
        <li key={item.projectId}>
          <a
            href={`/?organization=${organizationId}&project=${item.projectId}&section=controls`}
          >
            <strong>{item.projectName}</strong>
            <span>{sentence(item.projectStatus.toLowerCase())}</span>
            <span>
              {item.controls} {item.controls === 1 ? "control" : "controls"}
            </span>
            <UiIcon name="arrow" size={13} />
          </a>
        </li>
      ))}
    </ul>
  );
}

function Applicability({ entry }: { entry: LibraryEntry }) {
  const parts = [
    entry.notApplicable.length,
    entry.designConfirmation === "" ? 0 : 1,
    entry.assumptions.length,
    entry.questions.length,
    entry.retired.length,
  ].reduce((sum, count) => sum + count, 0);
  if (parts === 0) {
    return null;
  }
  return (
    <details className="card lb-card lb-fold">
      <summary>
        <span>
          <strong>Applicability and judgment</strong>
          <small>
            {[
              entry.notApplicable.length > 0
                ? `${entry.notApplicable.length} ${entry.notApplicable.length === 1 ? "exclusion" : "exclusions"}`
                : "",
              entry.designConfirmation !== "" ? "design to confirm" : "",
              entry.questions.length > 0
                ? `${entry.questions.length} ${entry.questions.length === 1 ? "question" : "questions"}`
                : "",
              entry.assumptions.length > 0
                ? `${entry.assumptions.length} ${entry.assumptions.length === 1 ? "assumption" : "assumptions"}`
                : "",
              entry.retired.length > 0
                ? `${entry.retired.length} retired ${entry.retired.length === 1 ? "attribute" : "attributes"}`
                : "",
            ]
              .filter((part) => part !== "")
              .join(" · ")}
          </small>
        </span>
        <UiIcon name="chevron" size={14} />
      </summary>
      <div className="lb-fold-body">
        <Facts
          items={[
            ["Does not apply when", listOr(entry.notApplicable)],
            ["Design to confirm first", entry.designConfirmation],
            ["Open questions", listOr(entry.questions)],
            ["Assumptions", listOr(entry.assumptions)],
            ["Population", entry.population],
            ["Sampling", entry.sampling],
            ["Trigger", entry.trigger],
            [
              "Retired attributes",
              entry.retired.length === 0 ? (
                ""
              ) : (
                <ul key="r" className="lb-bullets">
                  {entry.retired.map((item) => (
                    <li key={item.text}>
                      {item.text}
                      <small>
                        {" "}
                        · {item.reason}
                        {item.replacedBy !== ""
                          ? ` · replaced by ${item.replacedBy}`
                          : ""}
                      </small>
                    </li>
                  ))}
                </ul>
              ),
            ],
          ]}
        />
      </div>
    </details>
  );
}

// Change requests

function RequestForm({
  organizationId,
  libraryKey,
  onDone,
}: {
  organizationId: string;
  /** Null proposes a new standard control. */
  libraryKey: string | null;
  onDone: () => void;
}) {
  const action = useAction(organizationId);
  const id = useId();
  const [kind, setKind] = useState<"CHANGE" | "RETIRE">("CHANGE");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  return (
    <form
      autoComplete="off"
      className="lb-form"
      aria-busy={action.pending}
      onSubmit={async (event) => {
        event.preventDefault();
        const done = await action.run("request", {
          intent: "request",
          kind: libraryKey === null ? "NEW" : kind,
          library_key: libraryKey ?? "",
          title,
          detail,
        });
        if (done) {
          setTitle("");
          setDetail("");
          onDone();
        }
      }}
    >
      {libraryKey !== null ? (
        <label htmlFor={`${id}-kind`}>
          What is proposed
          <select
            id={`${id}-kind`}
            value={kind}
            onChange={(event) =>
              setKind(event.target.value === "RETIRE" ? "RETIRE" : "CHANGE")
            }
          >
            <option value="CHANGE">A change to this standard control</option>
            <option value="RETIRE">Retire this standard control</option>
          </select>
        </label>
      ) : null}
      <label htmlFor={`${id}-title`}>
        {libraryKey === null ? "The control, in a few words" : "Title"}
        <input
          id={`${id}-title`}
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label htmlFor={`${id}-detail`}>
        {libraryKey === null
          ? "What it does, the risk it addresses, and how it would be tested"
          : "What should change, and why"}
        <textarea
          id={`${id}-detail`}
          rows={4}
          maxLength={4000}
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
        />
      </label>
      <div className="lb-decide-buttons">
        <button
          type="submit"
          className="btn btn-sm"
          disabled={
            action.pending ||
            title.trim().length < 3 ||
            detail.trim().length < 20
          }
        >
          Submit for methodology review
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
        <span className="lb-sub">
          A reviewer decides it. Nothing in the library changes until the next
          version.
        </span>
      </div>
      <Problem text={action.problem} />
    </form>
  );
}

function Requests({
  organizationId,
  requests,
  canDecide,
}: {
  organizationId: string;
  requests: ChangeRequest[];
  canDecide: boolean;
}) {
  const action = useAction(organizationId);
  const noteId = useId();
  const [deciding, setDeciding] = useState<{
    id: string;
    decision: "ACCEPTED" | "DECLINED";
  } | null>(null);
  const [note, setNote] = useState("");
  const tones: Record<ChangeRequest["status"], string> = {
    OPEN: "tone-warning",
    ACCEPTED: "tone-success",
    DECLINED: "tone-neutral",
  };
  return (
    <ul className="lb-requests" aria-busy={action.pending}>
      {requests.map((request) => (
        <li key={request.id}>
          <div className="lb-request-head">
            <span className={`pill pill-dot ${tones[request.status]}`}>
              {sentence(request.status.toLowerCase())}
            </span>
            <strong>{request.title}</strong>
            <span className="lb-sub">
              {REQUEST_KIND_LABELS[request.kind]} · {request.submittedBy},{" "}
              {formatDate(request.submittedAt)}
            </span>
          </div>
          <p className="lb-text">{request.detail}</p>
          {request.decidedBy !== null && request.decidedAt !== null ? (
            <p className="lb-sub">
              {sentence(request.status.toLowerCase())} by {request.decidedBy},{" "}
              {formatDate(request.decidedAt)}
              {request.decisionNote !== "" ? `: ${request.decisionNote}` : ""}
            </p>
          ) : null}
          {canDecide && request.status === "OPEN" && deciding === null ? (
            <div className="lb-decide-buttons">
              <button
                type="button"
                className="btn btn-sm"
                disabled={action.pending}
                onClick={() => {
                  setDeciding({ id: request.id, decision: "ACCEPTED" });
                  setNote("");
                }}
              >
                Accept
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={action.pending}
                onClick={() => {
                  setDeciding({ id: request.id, decision: "DECLINED" });
                  setNote("");
                }}
              >
                Decline
              </button>
            </div>
          ) : null}
          {deciding !== null && deciding.id === request.id ? (
            <div className="lb-decide">
              <label htmlFor={noteId}>
                {deciding.decision === "ACCEPTED"
                  ? "Note (optional): how it will be applied"
                  : "Why it is declined (required)"}
              </label>
              <textarea
                id={noteId}
                rows={2}
                maxLength={1000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <div className="lb-decide-buttons">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={
                    action.pending ||
                    (deciding.decision === "DECLINED" &&
                      note.trim().length < 10)
                  }
                  onClick={async () => {
                    const done = await action.run("decide", {
                      intent: "decide",
                      request_id: deciding.id,
                      decision: deciding.decision,
                      note,
                    });
                    if (done) {
                      setDeciding(null);
                    }
                  }}
                >
                  {deciding.decision === "ACCEPTED"
                    ? "Accept the change"
                    : "Decline"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setDeciding(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </li>
      ))}
      <Problem text={action.problem} />
    </ul>
  );
}
