"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useId, useMemo, useState, useTransition } from "react";

import { formatDate } from "./format";
import type { PlanningPageState } from "./load-planning";
import { CONTROL_CATEGORIES } from "./onboarding-model";
import { PhaseStrip, PhasesView, ViewSwitch } from "./phases-view";
import {
  type Attribute,
  approvalHeldBy,
  BASIS_LABELS,
  type ControlPhases,
  CRITERIA_LABELS,
  decisionLine,
  type Evidence,
  type Fact,
  factTitle,
  filterQueue,
  findingsByCode,
  isAgentWork,
  type MasterPlan,
  METHOD_LABELS,
  METHODS,
  neighbours,
  originLabel,
  PHASE_LABELS,
  PHASE_SHORT,
  PHASES,
  type Phase,
  type PlanningState,
  type Procedure,
  planningHref,
  planningProblem,
  QUEUE_FIGURES,
  type Queue,
  type QueueRow,
  related,
  STATE_LABELS,
  STATE_TONES,
  statementParts,
  TAB_LABELS,
  TABS,
  type Tab,
  tabCounts,
  tabOfCode,
} from "./planning-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string };

const AREAS = new Map<string, string>(
  CONTROL_CATEGORIES.flatMap((category) =>
    category.domains.map(([key, label]) => [key, label] as [string, string]),
  ),
);

const TAB_DESCRIPTIONS: Record<Tab, string> = {
  understanding:
    "Confirm the control objective, risk, ownership, and operating context before reviewing how it will be tested.",
  procedures:
    "Review the work performed in each phase and follow every procedure through to the attributes and evidence it relies on.",
  attributes:
    "Confirm the conditions, pass and fail criteria, and where professional judgment is required.",
  evidence:
    "Review the evidence required for each phase and confirm that every item supports the planned testing.",
};

const TAB_ICONS = {
  understanding: "shield",
  procedures: "activity",
  attributes: "check",
  evidence: "file",
} as const;

/** The control's area as the team reads it: "Logical access", not ACCESS. */
function areaLabel(area: string): string {
  if (area === "IPE") {
    return "Key reports (IPE)";
  }
  return AREAS.get(area) ?? area.replaceAll("_", " ").toLowerCase();
}

/** One call to the planning route; refreshes the page when it succeeds. */
function useAction(ids: Ids) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  async function run(
    label: string,
    fields: Record<string, unknown>,
  ): Promise<{ ok: boolean; body: unknown }> {
    setBusy(label);
    setProblem(null);
    let status = 0;
    let detail = "";
    let body: unknown = null;
    try {
      const response = await fetch("/workspace/planning", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          ...fields,
        }),
      });
      const answer = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
        body?: unknown;
      };
      status = typeof answer.status === "number" ? answer.status : 0;
      detail = typeof answer.detail === "string" ? answer.detail : "";
      body = answer.body ?? null;
    } catch {
      status = 0;
    }
    setBusy("");
    const message = planningProblem(status, detail);
    setProblem(message);
    if (message === null) {
      startTransition(() => router.refresh());
    }
    return { ok: message === null, body };
  }
  return { run, busy, pending: pending || busy !== "", problem };
}

function Problem({ text }: { text: string | null }) {
  return text === null ? null : (
    <p className="pl-problem" role="alert">
      {text}
    </p>
  );
}

function StatePill({ state }: { state: PlanningState }) {
  return (
    <span className={`pill pill-dot ${STATE_TONES[state]}`}>
      {STATE_LABELS[state]}
    </span>
  );
}

export function PlanningPage({
  ids,
  projectName,
  state,
}: {
  ids: Ids;
  projectName: string;
  state: PlanningPageState | null;
}) {
  if (state?.controlId) {
    if (state.plan === null) {
      return (
        <div className="page pl-page">
          <a
            className="text-link is-plain pl-back"
            href={planningHref(ids.organizationId, ids.projectId)}
          >
            ← Test plans
          </a>
          <section className="card pl-empty">
            <h2>This control's test plan could not be loaded</h2>
            <p>It may be out of scope, or no longer available to you.</p>
          </section>
        </div>
      );
    }
    return (
      <PlanReview
        ids={ids}
        plan={state.plan}
        queue={state.queue}
        initialTab={state.tab}
        phases={state.phases?.controls.find(
          (row) => row.controlId === state.controlId,
        )}
        canRelease={state.phases?.viewerCanRelease ?? false}
      />
    );
  }
  if (state?.view === "phases") {
    return (
      <PhasesView
        ids={ids}
        state={state}
        header={<QueueHeader projectName={projectName} />}
      />
    );
  }
  return <PlanQueue ids={ids} projectName={projectName} state={state} />;
}

// The planning review queue

function PlanQueue({
  ids,
  projectName,
  state,
}: {
  ids: Ids;
  projectName: string;
  state: PlanningPageState | null;
}) {
  const action = useAction(ids);
  const queue = state?.queue ?? null;
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const [outcome, setOutcome] = useState<string | null>(null);
  const filter = state?.filter ?? [];
  const rows = useMemo(
    () => filterQueue(queue?.controls ?? [], filter, search),
    [queue, filter, search],
  );
  if (queue === null) {
    return (
      <div className="page pl-page">
        <QueueHeader projectName={projectName} />
        <section className="card pl-empty">
          <h2>The test plans could not be loaded</h2>
          <p>Wait a moment and refresh the page.</p>
        </section>
      </div>
    );
  }
  const approvable = rows.filter(
    (row) => row.approvable && queue.viewerCanDecide,
  );
  const chosen = (queue.controls ?? []).filter((row) =>
    selected.has(row.controlId),
  );
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  };
  const filterHref = (states: readonly PlanningState[]) =>
    planningHref(ids.organizationId, ids.projectId, {
      filter: states.join(","),
    });
  const active = (states: readonly PlanningState[]) =>
    states.length === filter.length &&
    states.every((item) => filter.includes(item));
  const nextHref =
    queue.nextControlId === null
      ? null
      : planningHref(ids.organizationId, ids.projectId, {
          control: queue.nextControlId,
        });
  return (
    <div className="page pl-page">
      <QueueHeader
        projectName={projectName}
        actions={
          <>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={action.pending}
              title="Plan every control whose plan no person has approved again, with the standard planning rules."
              onClick={async () => {
                const done = await action.run("replan", { intent: "replan" });
                if (
                  done.ok &&
                  typeof done.body === "object" &&
                  done.body !== null
                ) {
                  const answer = done.body as {
                    planned?: number;
                    skipped?: number;
                  };
                  setOutcome(
                    `Planned ${answer.planned ?? 0} again; ${answer.skipped ?? 0} approved or in progress left as they are.`,
                  );
                }
              }}
            >
              <UiIcon name="sparkles" size={13} />
              {action.busy === "replan"
                ? "Planning…"
                : "Plan again with the rules"}
            </button>
            {nextHref === null ? null : (
              <a className="btn btn-sm" href={nextHref}>
                Review next plan
                <UiIcon name="arrow" size={13} />
              </a>
            )}
          </>
        }
      />
      <ViewSwitch ids={ids} view="plans" />
      <nav className="kpis pl-figures" aria-label="Plans by state">
        <a
          className={`kpi pl-figure ${filter.length === 0 ? "is-active" : ""}`}
          href={filterHref([])}
          aria-current={filter.length === 0 ? "true" : undefined}
        >
          <span className="kpi-label">Controls in scope</span>
          <strong className="kpi-value">{queue.total}</strong>
          <span className="kpi-detail">Every control is planned</span>
        </a>
        {QUEUE_FIGURES.map((figure) => {
          const count = figure.states.reduce(
            (sum, item) => sum + (queue.counts[item] ?? 0),
            0,
          );
          return (
            <a
              key={figure.label}
              className={`kpi pl-figure ${active(figure.states) ? "is-active" : ""}`}
              href={filterHref(figure.states)}
              aria-current={active(figure.states) ? "true" : undefined}
            >
              <span className="kpi-label">{figure.label}</span>
              <strong className="kpi-value">{count}</strong>
              <span className="kpi-detail">{figure.detail}</span>
            </a>
          );
        })}
      </nav>
      {outcome === null ? null : (
        <p className="banner" role="status">
          <UiIcon name="info" size={16} />
          <span>{outcome}</span>
        </p>
      )}
      <section className="card pl-queue" aria-busy={action.pending}>
        <div className="pl-toolbar">
          <label className="pl-search">
            <UiIcon name="search" size={14} />
            <span className="sr-only">Search controls</span>
            <input
              type="search"
              value={search}
              placeholder="Search by control, title, or system"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <span className="pl-count">
            {rows.length} of {queue.total}
          </span>
        </div>
        {chosen.length > 0 ? (
          <section className="pl-batch" aria-label="Approve selected plans">
            <strong>
              {chosen.length} plan{chosen.length === 1 ? "" : "s"} selected
            </strong>
            <span className="pl-batch-note">
              Each is approved and recorded on its own, at the version shown.
            </span>
            <input
              type="text"
              maxLength={4000}
              value={comment}
              placeholder="Comment for each approval (optional)"
              onChange={(event) => setComment(event.target.value)}
            />
            <button
              type="button"
              className="btn-sm"
              disabled={action.pending}
              onClick={async () => {
                const done = await action.run("batch-approve", {
                  intent: "batch-approve",
                  comment,
                  items: chosen.map((row) => ({
                    control_id: row.controlId,
                    version: row.version,
                  })),
                });
                if (
                  done.ok &&
                  typeof done.body === "object" &&
                  done.body !== null
                ) {
                  const answer = done.body as {
                    approved?: number;
                    outcomes?: Array<{
                      approved: boolean;
                      control_ref: string;
                      detail: string;
                    }>;
                  };
                  const refused = (answer.outcomes ?? []).filter(
                    (item) => !item.approved,
                  );
                  setOutcome(
                    `Approved ${answer.approved ?? 0}.` +
                      (refused.length > 0
                        ? ` Not approved: ${refused.map((item) => `${item.control_ref} (${item.detail})`).join("; ")}`
                        : ""),
                  );
                  setSelected(new Set());
                  setComment("");
                }
              }}
            >
              {action.busy === "batch-approve"
                ? "Approving…"
                : `Approve ${chosen.length}`}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
          </section>
        ) : null}
        <Problem text={action.problem} />
        {rows.length === 0 ? (
          <p className="pl-quiet">No control matches.</p>
        ) : (
          <div className="table-wrap">
            <table className="pl-table">
              <thead>
                <tr>
                  <th scope="col" className="pl-col-check">
                    {queue.viewerCanDecide && approvable.length > 0 ? (
                      <input
                        type="checkbox"
                        aria-label="Select every plan that can be approved"
                        checked={approvable.every((row) =>
                          selected.has(row.controlId),
                        )}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? new Set(approvable.map((row) => row.controlId))
                              : new Set(),
                          )
                        }
                      />
                    ) : null}
                  </th>
                  <th scope="col">Control</th>
                  <th scope="col">State</th>
                  <th scope="col">To resolve</th>
                  <th scope="col">Last decision</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <QueueLine
                    key={row.controlId}
                    ids={ids}
                    row={row}
                    canDecide={queue.viewerCanDecide}
                    selected={selected.has(row.controlId)}
                    onToggle={() => toggle(row.controlId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function QueueHeader({
  projectName,
  actions,
}: {
  projectName: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="page-context">{projectName}</p>
        <div className="page-title">
          <h1>Test plans</h1>
        </div>
        <p className="page-desc">
          Each control's master test plan: its understanding, procedures,
          attributes, and evidence, reviewed and approved by a person before
          anything is requested or tested.
        </p>
      </div>
      {actions === undefined ? null : (
        <div className="page-actions">{actions}</div>
      )}
    </header>
  );
}

function QueueLine({
  ids,
  row,
  canDecide,
  selected,
  onToggle,
}: {
  ids: Ids;
  row: QueueRow;
  canDecide: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const href = planningHref(ids.organizationId, ids.projectId, {
    control: row.controlId,
  });
  const resolve: string[] = [];
  if (row.clarifications > 0) {
    resolve.push(
      `${row.clarifications} question${row.clarifications === 1 ? "" : "s"}`,
    );
  }
  if (row.decisions > 0) {
    resolve.push(
      `${row.decisions} proposal${row.decisions === 1 ? "" : "s"} to decide`,
    );
  }
  if (row.findings > 0) {
    resolve.push(`${row.findings} finding${row.findings === 1 ? "" : "s"}`);
  }
  return (
    <tr className={selected ? "is-selected" : undefined}>
      <td className="pl-col-check">
        {canDecide && row.approvable ? (
          <input
            type="checkbox"
            aria-label={`Select ${row.controlRef} for approval`}
            checked={selected}
            onChange={onToggle}
          />
        ) : null}
      </td>
      <td>
        <a className="pl-control" href={href}>
          <span className="pl-ref">{row.controlRef}</span>
          <span className="pl-title">{row.title}</span>
        </a>
        <span className="pl-sub">{row.application || "No system"}</span>
      </td>
      <td>
        <StatePill state={row.state} />
        {row.revisedSinceApproval ? (
          <span className="pl-sub">Revised since approval</span>
        ) : null}
      </td>
      <td>
        {resolve.length === 0 ? (
          <span className="pl-sub">Nothing open</span>
        ) : (
          <span className="pl-resolve">{resolve.join(" · ")}</span>
        )}
        {row.heldBy !== "" && row.state !== "APPROVED" ? (
          <span className="pl-sub" title={row.heldBy}>
            Held: {row.heldBy}
          </span>
        ) : null}
      </td>
      <td>
        {row.lastDecision === null ? (
          <span className="pl-sub">None yet</span>
        ) : (
          <>
            <span>
              {row.lastDecision === "APPROVED"
                ? "Approved"
                : "Changes requested"}
            </span>
            <span className="pl-sub">
              {row.lastDecisionBy}
              {row.lastDecisionAt ? ` · ${formatDate(row.lastDecisionAt)}` : ""}
            </span>
          </>
        )}
      </td>
      <td className="pl-col-open">
        <a className="text-link" href={href}>
          Review
        </a>
      </td>
    </tr>
  );
}

// The master test plan review

function asSentence(value: string): string {
  const text = value.replaceAll("_", " ").trim();
  if (text === "") {
    return "";
  }
  return text.slice(0, 1).toUpperCase() + text.slice(1).toLowerCase();
}

function PlanReview({
  ids,
  plan,
  queue,
  initialTab,
  phases,
  canRelease,
}: {
  ids: Ids;
  plan: MasterPlan;
  queue: Queue | null;
  initialTab: Tab;
  phases: ControlPhases | undefined;
  canRelease: boolean;
}) {
  const [view, setView] = useState<Tab>(initialTab);
  const [selected, setSelected] = useState<string | null>(null);
  const [sources, setSources] = useState(false);
  const counts = tabCounts(plan);
  const place = neighbours(queue, plan.controlId);
  const href = (control: string | null) =>
    control === null
      ? null
      : planningHref(ids.organizationId, ids.projectId, { control });
  const trace = selected === null ? new Set<string>() : related(plan, selected);
  const select = (code: string) => {
    const owner = tabOfCode(code);
    setSelected(code);
    if (owner !== null) {
      setView(owner);
    }
    // Once the tab holding it has rendered, bring the item into view.
    window.setTimeout(() => {
      document
        .getElementById(`pl-item-${code}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 0);
  };
  const control = plan.control;
  const meta = [
    asSentence(control.nature),
    asSentence(control.frequency),
    control.keyControl ? "Key control" : "",
    areaLabel(control.area),
  ].filter((item) => item !== "");
  return (
    <div className="page pl-page pl-review">
      <article className="card pl-review-shell">
        <div className="pl-shell-bar">
          <nav className="pl-crumbs" aria-label="Breadcrumb">
            <a href={planningHref(ids.organizationId, ids.projectId)}>
              <span aria-hidden="true">←</span> Test plans
            </a>
            <span aria-hidden="true">/</span>
            <span>{control.controlRef}</span>
          </nav>
          <span className="pl-pager">
            {place.index >= 0 && queue !== null ? (
              <span>
                {place.index + 1} of {queue.controls.length}
              </span>
            ) : null}
            {place.previous === null ? (
              <span className="pl-pager-btn is-off" aria-hidden="true">
                ‹
              </span>
            ) : (
              <a
                className="pl-pager-btn"
                href={href(place.previous) ?? undefined}
                aria-label="Previous control"
              >
                ‹
              </a>
            )}
            {place.next === null ? (
              <span className="pl-pager-btn is-off" aria-hidden="true">
                ›
              </span>
            ) : (
              <a
                className="pl-pager-btn"
                href={href(place.next) ?? undefined}
                aria-label="Next control"
              >
                ›
              </a>
            )}
            {place.nextPending === null ? null : (
              <a
                className="pl-pager-next"
                href={href(place.nextPending) ?? undefined}
              >
                Next waiting
              </a>
            )}
          </span>
        </div>
        <header className="pl-shell-head">
          <div className="pl-id">
            <p className="pl-kicker">
              <span className="pl-control-ref">{control.controlRef}</span>
              {control.application !== "" ? (
                <span>{control.application}</span>
              ) : null}
            </p>
            <div className="pl-title-row">
              <h1>{control.title}</h1>
              <StatePill state={plan.state} />
            </div>
            <p className="pl-meta">
              {meta.map((item) => (
                <span key={item}>{item}</span>
              ))}
              <span>
                Revision {plan.revision}
                {plan.approvedRevision !== null && plan.revisedSinceApproval
                  ? `, approved ${plan.approvedRevision}`
                  : ""}
              </span>
              {plan.decisions[0] === undefined ? (
                <span>No decision yet</span>
              ) : (
                <span>
                  {decisionLine(plan.decisions[0])} ·{" "}
                  {formatDate(plan.decisions[0].decidedAt)}
                </span>
              )}
            </p>
          </div>
          <ReviewActions ids={ids} plan={plan} />
        </header>
        <Holding plan={plan} />
        {plan.state === "APPROVED" ? (
          <PhaseStrip ids={ids} row={phases} canRelease={canRelease} />
        ) : null}
        <div className="pl-plan-body">
          <div
            className="pl-tabs"
            role="tablist"
            aria-label="The plan's sections"
          >
            <p className="pl-tabs-label">Review the plan</p>
            {TABS.map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                id={`pl-tab-${item}`}
                aria-selected={view === item}
                aria-controls={`pl-panel-${item}`}
                className={view === item ? "is-active" : undefined}
                onClick={() => {
                  setView(item);
                  if (item === "understanding") {
                    setSelected(null);
                  }
                }}
              >
                <span className="pl-tab-step" aria-hidden="true">
                  <UiIcon name={TAB_ICONS[item]} size={14} />
                </span>
                <span className="pl-tab-name">{TAB_LABELS[item]}</span>
                <span className="pl-tab-count">{counts[item].items}</span>
                {counts[item].attention > 0 ? (
                  <span className="pl-tab-flag" title="Needs a look">
                    {counts[item].attention}
                    <span className="sr-only"> need a look</span>
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="pl-plan-content">
            {selected !== null && view !== "understanding" ? (
              <section className="pl-trace" aria-label="Traceability">
                <span>
                  Tracing <strong>{selected}</strong>:
                </span>
                {[...trace].length === 0 ? (
                  <span className="pl-sub">linked to nothing in the plan</span>
                ) : (
                  [...trace]
                    .sort()
                    .map((code) => (
                      <CodeChip
                        key={code}
                        code={code}
                        onSelect={select}
                        related
                      />
                    ))
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelected(null)}
                >
                  Clear
                </button>
              </section>
            ) : null}
            <section
              className={`pl-panel pl-panel-${view}`}
              role="tabpanel"
              id={`pl-panel-${view}`}
              aria-labelledby={`pl-tab-${view}`}
            >
              <header className="pl-panel-head">
                <div>
                  <p className="pl-section-kicker">
                    Section {TABS.indexOf(view) + 1} / {TABS.length}
                  </p>
                  <h2>{TAB_LABELS[view]}</h2>
                  <p>{TAB_DESCRIPTIONS[view]}</p>
                </div>
                <span className="pl-section-total">
                  <strong>{counts[view].items}</strong>{" "}
                  {counts[view].items === 1 ? "item" : "items"}
                  {counts[view].attention > 0
                    ? ` · ${counts[view].attention} to review`
                    : " · ready"}
                </span>
              </header>
              {view === "understanding" ? (
                <UnderstandingTab
                  plan={plan}
                  sources={sources}
                  onSources={setSources}
                />
              ) : view === "procedures" ? (
                <ProceduresTab
                  ids={ids}
                  plan={plan}
                  selected={selected}
                  trace={trace}
                  onSelect={select}
                />
              ) : view === "attributes" ? (
                <AttributesTab
                  ids={ids}
                  plan={plan}
                  selected={selected}
                  trace={trace}
                  onSelect={select}
                />
              ) : (
                <EvidenceTab
                  ids={ids}
                  plan={plan}
                  selected={selected}
                  trace={trace}
                  onSelect={select}
                />
              )}
            </section>
          </div>
        </div>
      </article>
      <History plan={plan} />
    </div>
  );
}

function ReviewActions({ ids, plan }: { ids: Ids; plan: MasterPlan }) {
  const action = useAction(ids);
  const commentId = useId();
  const [mode, setMode] = useState<"none" | "approve" | "return" | "submit">(
    "none",
  );
  const [text, setText] = useState("");
  const fields = { control_id: plan.controlId, version: plan.version };
  const held = approvalHeldBy(plan);
  const approved = plan.state === "APPROVED" && plan.status === "APPROVED";
  const finish = (done: { ok: boolean }) => {
    if (done.ok) {
      setMode("none");
      setText("");
    }
  };
  return (
    <div className="pl-review-actions" aria-busy={action.pending}>
      <div className="pl-actions-buttons">
        {plan.pendingRevision ? (
          <>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={action.pending}
              onClick={async () =>
                finish(
                  await action.run("revision", {
                    intent: "revision",
                    decision: "ACCEPT",
                    ...fields,
                  }),
                )
              }
            >
              Accept the planner's revision
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={action.pending}
              onClick={async () =>
                finish(
                  await action.run("revision", {
                    intent: "revision",
                    decision: "DISMISS",
                    ...fields,
                  }),
                )
              }
            >
              Dismiss it
            </button>
          </>
        ) : null}
        {!plan.viewerCanDecide && !approved ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={action.pending || plan.planId === null}
            onClick={() => setMode(mode === "submit" ? "none" : "submit")}
          >
            Submit for review
          </button>
        ) : null}
        {plan.viewerCanDecide && plan.state !== "CHANGES_REQUESTED" ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={action.pending || plan.planId === null}
            onClick={() => setMode(mode === "return" ? "none" : "return")}
          >
            Request changes
          </button>
        ) : null}
        {plan.viewerCanDecide && !approved ? (
          <button
            type="button"
            className="btn"
            disabled={action.pending || held !== null}
            title={held ?? undefined}
            onClick={() => setMode(mode === "approve" ? "none" : "approve")}
          >
            <UiIcon name="check" size={13} />
            Approve plan
          </button>
        ) : null}
      </div>
      {mode !== "none" ||
      plan.submitted !== null ||
      (plan.decisions[0]?.decision === "CHANGES_REQUESTED" &&
        plan.state === "CHANGES_REQUESTED") ||
      action.problem !== null ? (
        <div className="pl-review-compose">
          {mode === "none" ? null : (
            <div className="pl-decide">
              <label htmlFor={commentId}>
                {mode === "approve"
                  ? "Reviewer comment (optional), kept with the approval"
                  : mode === "return"
                    ? "What should change"
                    : plan.state === "CHANGES_REQUESTED"
                      ? "How the requested changes were addressed"
                      : "Note for the reviewer (optional)"}
              </label>
              <textarea
                id={commentId}
                rows={3}
                maxLength={4000}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
              <div className="pl-decide-buttons">
                <button
                  type="button"
                  className={
                    mode === "approve" ? "btn-sm" : "btn btn-secondary btn-sm"
                  }
                  disabled={
                    action.pending ||
                    (mode === "return" && text.trim().length < 10) ||
                    (mode === "submit" &&
                      plan.state === "CHANGES_REQUESTED" &&
                      text.trim().length < 10)
                  }
                  onClick={async () =>
                    finish(
                      await action.run(mode, {
                        intent:
                          mode === "approve"
                            ? "approve"
                            : mode === "return"
                              ? "request-changes"
                              : "submit",
                        ...fields,
                        comment: text,
                        note: text,
                      }),
                    )
                  }
                >
                  {mode === "approve"
                    ? `Approve revision ${plan.revision}`
                    : mode === "return"
                      ? "Return the plan"
                      : "Submit for review"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setMode("none")}
                >
                  Cancel
                </button>
              </div>
              {mode === "approve" && plan.findings.length > 0 ? (
                <p className="pl-sub">
                  {plan.findings.length} finding
                  {plan.findings.length === 1 ? "" : "s"} will be kept with the
                  approval.
                </p>
              ) : null}
            </div>
          )}
          {plan.submitted !== null ? (
            <p className="pl-sub">
              Submitted by {plan.submitted.by} · {formatDate(plan.submitted.at)}
              {plan.submitted.note ? `: ${plan.submitted.note}` : ""}
            </p>
          ) : null}
          {plan.decisions[0]?.decision === "CHANGES_REQUESTED" &&
          plan.state === "CHANGES_REQUESTED" ? (
            <p className="pl-returned">
              <strong>
                Changes requested by {plan.decisions[0].decidedBy}:
              </strong>{" "}
              {plan.decisions[0].comment}
            </p>
          ) : null}
          <Problem text={action.problem} />
        </div>
      ) : null}
    </div>
  );
}

/** What holds approval, and the questions that do not, kept short. */
function Holding({ plan }: { plan: MasterPlan }) {
  const holds = plan.blockers.filter((item) => item.blocks);
  const questions = plan.blockers.filter((item) => !item.blocks);
  if (holds.length === 0 && questions.length === 0) {
    return null;
  }
  return (
    <aside
      className={`pl-readiness ${holds.length > 0 ? "has-blockers" : ""}`}
      aria-label="Review readiness"
    >
      <div className="pl-readiness-head">
        <span className="pl-readiness-icon" aria-hidden="true">
          <UiIcon name={holds.length > 0 ? "risk" : "info"} size={16} />
        </span>
        <div>
          <strong>
            {holds.length > 0
              ? `${holds.length} ${holds.length === 1 ? "item needs" : "items need"} attention`
              : `${questions.length} open ${questions.length === 1 ? "question" : "questions"}`}
          </strong>
          <span>
            {holds.length > 0
              ? "Resolve these before this revision can be approved."
              : "These questions do not prevent approval."}
          </span>
        </div>
      </div>
      {holds.length > 0 ? (
        <ul className="pl-readiness-list">
          {holds.map((item) => (
            <li key={item.detail}>{item.detail}</li>
          ))}
        </ul>
      ) : null}
      {questions.length > 0 ? (
        <details className="pl-questions" open={holds.length === 0}>
          <summary>
            Review {questions.length} non-blocking question
            {questions.length === 1 ? "" : "s"}
          </summary>
          <ul>
            {questions.map((item) => (
              <li key={item.detail}>{item.detail}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </aside>
  );
}

function CodeChip({
  code,
  onSelect,
  related: isRelated = false,
  flagged = false,
}: {
  code: string;
  onSelect: (code: string) => void;
  related?: boolean;
  flagged?: boolean;
}) {
  return (
    <button
      type="button"
      className={`pl-chip ${isRelated ? "is-related" : ""} ${flagged ? "is-flagged" : ""}`}
      onClick={() => onSelect(code)}
      aria-label={`Show ${code}`}
    >
      {code}
    </button>
  );
}

function Chips({
  label,
  codes,
  onSelect,
}: {
  label: string;
  codes: string[];
  onSelect: (code: string) => void;
}) {
  return (
    <span className="pl-links">
      <span className="pl-links-label">{label}</span>
      {codes.length === 0 ? (
        <span className="pl-none">none</span>
      ) : (
        codes.map((code) => (
          <CodeChip key={code} code={code} onSelect={onSelect} />
        ))
      )}
    </span>
  );
}

function Mark({
  origin,
  personEdited = false,
}: {
  origin: string;
  personEdited?: boolean;
}) {
  const agent = isAgentWork(origin, personEdited);
  return (
    <span
      className={`ai-mark ${agent && origin !== "AGENT" ? "is-rules" : ""} ${agent ? "" : "pl-person"}`}
    >
      {agent && origin === "AGENT" ? (
        <UiIcon name="sparkles" size={11} />
      ) : null}
      {originLabel(origin, personEdited)}
    </span>
  );
}

function Flags({
  findings,
}: {
  findings: Array<{ detail: string }> | undefined;
}) {
  if (findings === undefined || findings.length === 0) {
    return null;
  }
  return (
    <ul className="pl-flags">
      {findings.map((item) => (
        <li key={item.detail}>
          <UiIcon name="risk" size={12} />
          {item.detail}
        </li>
      ))}
    </ul>
  );
}

function rowClass(
  code: string,
  selected: string | null,
  trace: Set<string>,
): string {
  return `pl-item ${selected === code ? "is-selected" : ""} ${trace.has(code) ? "is-related" : ""}`;
}

// Control understanding

const LEAD_FACTS = ["OBJECTIVE", "RISK", "DESCRIPTION", "DEPENDENCIES"];

function factOf(plan: MasterPlan, field: string): Fact | undefined {
  return plan.facts.find((item) => item.field === field);
}

function procedureLead(text: string): { title: string; body: string } {
  const clean = text.replace(/\s+/g, " ").trim();
  const mark = clean.indexOf(". ");
  if (mark > 24 && mark < 180) {
    return { title: clean.slice(0, mark + 1), body: clean.slice(mark + 2) };
  }
  return { title: clean, body: "" };
}

function defaultProcedurePhase(plan: MasterPlan): Phase {
  for (const phase of PHASES) {
    if (plan.procedures.some((item) => item.phase === phase)) {
      return phase;
    }
  }
  return "DESIGN";
}

function UnderstandingTab({
  plan,
  sources,
  onSources,
}: {
  plan: MasterPlan;
  sources: boolean;
  onSources: (value: boolean) => void;
}) {
  const lead = LEAD_FACTS.map((field) => factOf(plan, field)).filter(
    (item): item is Fact => item !== undefined,
  );
  const paired = lead.filter(
    (item) => item.field === "OBJECTIVE" || item.field === "RISK",
  );
  const narrative = lead.filter(
    (item) => item.field !== "OBJECTIVE" && item.field !== "RISK",
  );
  const rest = plan.facts.filter((item) => !LEAD_FACTS.includes(item.field));
  const notes = [...plan.assumptions, ...plan.exceptions];
  return (
    <div className="pl-understanding">
      <dl className="pl-lead-facts">
        <div className="pl-lead-pair">
          {paired.map((fact) => (
            <FactLine
              key={fact.field}
              fact={fact}
              sources={false}
              title={factTitle(fact.field, fact.label)}
            />
          ))}
        </div>
        {narrative.map((fact) => (
          <FactLine
            key={fact.field}
            fact={fact}
            sources={false}
            title={factTitle(fact.field, fact.label)}
          />
        ))}
      </dl>
      <details className="pl-fold">
        <summary>More about this control</summary>
        <label className="pl-sources">
          <input
            type="checkbox"
            checked={sources}
            onChange={(event) => onSources(event.target.checked)}
          />
          Show supporting sources
        </label>
        <dl className="pl-fact-grid">
          {rest.map((fact) => (
            <FactLine
              key={fact.field}
              fact={fact}
              sources={sources}
              title={factTitle(fact.field, fact.label)}
            />
          ))}
        </dl>
        {notes.length > 0 ? (
          <ul className="pl-notes">
            {notes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
      </details>
    </div>
  );
}

function Statement({ text }: { text: string }) {
  return (
    <>
      {statementParts(text).map((part) =>
        part.placeholder ? (
          <span key={part.at} className="pl-placeholder">
            {part.text.slice(1, -1)}
          </span>
        ) : (
          <span key={part.at}>{part.text}</span>
        ),
      )}
    </>
  );
}

function FactLine({
  fact,
  sources,
  title,
}: {
  fact: Fact;
  sources: boolean;
  title?: string;
}) {
  const marked = fact.basis !== "" && fact.basis !== "SOURCE";
  return (
    <div className={fact.basis === "MISSING" ? "is-missing" : undefined}>
      <dt>{title ?? fact.label}</dt>
      <dd>
        {fact.value === "" ? (
          <span className="pl-none">Not stated</span>
        ) : (
          <Statement text={fact.value} />
        )}
        {marked ? (
          <span className="pl-basis">
            {BASIS_LABELS[fact.basis] ?? fact.basis}
          </span>
        ) : null}
        {fact.question ? (
          <span className="pl-question">{fact.question}</span>
        ) : null}
        {sources && fact.source !== "" ? (
          <span className="pl-source-line">{fact.source}</span>
        ) : null}
        {sources && fact.quote !== "" ? <q>{fact.quote}</q> : null}
      </dd>
    </div>
  );
}

// Test procedures

type TabProps = {
  ids: Ids;
  plan: MasterPlan;
  selected: string | null;
  trace: Set<string>;
  onSelect: (code: string) => void;
};

function ProceduresTab({ ids, plan, selected, trace, onSelect }: TabProps) {
  const flagged = findingsByCode(plan);
  const [phase, setPhase] = useState<Phase>(() => defaultProcedurePhase(plan));
  const mine = plan.procedures.filter((item) => item.phase === phase);
  const phaseRow = plan.phases.find((item) => item.phase === phase);
  return (
    <div className="pl-sections">
      <div className="pl-phase-nav" role="tablist" aria-label="Test phase">
        {PHASES.map((key) => {
          const count = plan.procedures.filter(
            (item) => item.phase === key,
          ).length;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={phase === key}
              className={phase === key ? "is-active" : undefined}
              onClick={() => setPhase(key)}
            >
              {PHASE_SHORT[key]}
              <span className="pl-tab-count">{count}</span>
            </button>
          );
        })}
      </div>
      <section className="pl-phase">
        <p className="pl-phase-note">
          {phaseRow
            ? asSentence(phaseRow.applicability)
            : "Not planned for this phase"}
          {phase === "DESIGN"
            ? " · Design procedures assess the risk and are not linked to attributes."
            : null}
        </p>
        {mine.length === 0 ? (
          <p className="pl-quiet">No procedure in this phase.</p>
        ) : (
          <ol className="pl-list">
            {mine.map((item) => (
              <ProcedureItem
                key={item.id}
                ids={ids}
                plan={plan}
                item={item}
                className={rowClass(item.code, selected, trace)}
                findings={flagged.get(item.code)}
                onSelect={onSelect}
              />
            ))}
          </ol>
        )}
        <AddProcedure ids={ids} plan={plan} phase={phase} />
      </section>
    </div>
  );
}

function ProcedureItem({
  ids,
  plan,
  item,
  className,
  findings,
  onSelect,
}: {
  ids: Ids;
  plan: MasterPlan;
  item: Procedure;
  className: string;
  findings: Array<{ detail: string }> | undefined;
  onSelect: (code: string) => void;
}) {
  const action = useAction(ids);
  const [mode, setMode] = useState<"none" | "edit" | "links" | "remove">(
    "none",
  );
  const [text, setText] = useState(item.text);
  const [method, setMethod] = useState(item.method ?? "");
  const [reason, setReason] = useState("");
  const [links, setLinks] = useState<Set<string>>(new Set(item.attributeIds));
  const fields = { control_id: plan.controlId, procedure_id: item.id };
  const lead = procedureLead(item.text);
  const done = (result: { ok: boolean }) => {
    if (result.ok) {
      setMode("none");
    }
  };
  return (
    <li id={`pl-item-${item.code}`} className={className}>
      <div className="pl-item-head">
        <button
          type="button"
          className="pl-code"
          onClick={() => onSelect(item.code)}
        >
          {item.code}
        </button>
        <div className="pl-item-text">
          <strong>{lead.title}</strong>
          {lead.body !== "" ? <p>{lead.body}</p> : null}
          {item.method ? (
            <span className="pl-sub">{METHOD_LABELS[item.method]}</span>
          ) : null}
        </div>
        <div className="pl-item-tools">
          <Mark origin={item.origin} personEdited={item.personEdited} />
        </div>
      </div>
      <div className="pl-item-links">
        {item.phase === "DESIGN" ? null : (
          <Chips
            label="Tests"
            codes={item.attributeCodes}
            onSelect={onSelect}
          />
        )}
        <Chips
          label="Evidence"
          codes={item.evidenceCodes}
          onSelect={onSelect}
        />
        <span className="pl-item-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setMode(mode === "edit" ? "none" : "edit")}
          >
            Edit
          </button>
          {item.phase === "DESIGN" ? null : (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setMode(mode === "links" ? "none" : "links")}
            >
              Attributes
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setMode(mode === "remove" ? "none" : "remove")}
          >
            Remove
          </button>
        </span>
      </div>
      <Flags findings={findings} />
      {mode === "edit" ? (
        <div className="pl-edit" aria-busy={action.pending}>
          <label>
            What is done
            <textarea
              rows={3}
              maxLength={1000}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <label>
            Method
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            >
              <option value="">Not stated</option>
              {METHODS.map((value) => (
                <option key={value} value={value}>
                  {METHOD_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <EditButtons
            busy={action.pending}
            disabled={text.trim().length < 10}
            save="Save procedure"
            onCancel={() => setMode("none")}
            onSave={async () =>
              done(
                await action.run("edit", {
                  intent: "procedure-edit",
                  ...fields,
                  version: item.version,
                  text,
                  method,
                }),
              )
            }
          />
        </div>
      ) : null}
      {mode === "links" ? (
        <div className="pl-edit" aria-busy={action.pending}>
          <fieldset>
            <legend>Attributes this procedure tests</legend>
            {plan.attributes.map((attribute) => (
              <label key={attribute.id} className="pl-check">
                <input
                  type="checkbox"
                  checked={links.has(attribute.id)}
                  onChange={(event) => {
                    const next = new Set(links);
                    if (event.target.checked) {
                      next.add(attribute.id);
                    } else {
                      next.delete(attribute.id);
                    }
                    setLinks(next);
                  }}
                />
                <span className="pl-ref">{attribute.code}</span>{" "}
                {attribute.text}
              </label>
            ))}
          </fieldset>
          <EditButtons
            busy={action.pending}
            save="Save links"
            onCancel={() => setMode("none")}
            onSave={async () =>
              done(
                await action.run("links", {
                  intent: "procedure-links",
                  ...fields,
                  attribute_ids: [...links],
                }),
              )
            }
          />
        </div>
      ) : null}
      {mode === "remove" ? (
        <div className="pl-edit" aria-busy={action.pending}>
          <label>
            Why it is removed
            <textarea
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <EditButtons
            busy={action.pending}
            disabled={reason.trim().length < 10}
            save="Remove procedure"
            onCancel={() => setMode("none")}
            onSave={async () =>
              done(
                await action.run("remove", {
                  intent: "procedure-remove",
                  ...fields,
                  version: item.version,
                  reason,
                }),
              )
            }
          />
        </div>
      ) : null}
      <Problem text={action.problem} />
    </li>
  );
}

function AddProcedure({
  ids,
  plan,
  phase,
}: {
  ids: Ids;
  plan: MasterPlan;
  phase: Phase;
}) {
  const action = useAction(ids);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [method, setMethod] = useState("");
  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-sm pl-add"
        onClick={() => setOpen(true)}
      >
        <UiIcon name="plus" size={13} />
        Add a procedure
      </button>
    );
  }
  return (
    <div className="pl-edit" aria-busy={action.pending}>
      <label>
        What is done, specifically: what is inspected, compared, or reperformed
        <textarea
          rows={3}
          maxLength={1000}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <label>
        Method
        <select
          value={method}
          onChange={(event) => setMethod(event.target.value)}
        >
          <option value="">Not stated</option>
          {METHODS.map((value) => (
            <option key={value} value={value}>
              {METHOD_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <EditButtons
        busy={action.pending}
        disabled={text.trim().length < 10}
        save="Add procedure"
        onCancel={() => setOpen(false)}
        onSave={async () => {
          const result = await action.run("add", {
            intent: "procedure-add",
            control_id: plan.controlId,
            phase,
            text,
            method,
            attribute_ids: [],
          });
          if (result.ok) {
            setOpen(false);
            setText("");
          }
        }}
      />
      <Problem text={action.problem} />
    </div>
  );
}

function EditButtons({
  busy,
  disabled = false,
  save,
  onSave,
  onCancel,
}: {
  busy: boolean;
  disabled?: boolean;
  save: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="pl-edit-buttons">
      <button
        type="button"
        className="btn-sm"
        disabled={busy || disabled}
        onClick={onSave}
      >
        {save}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
        Cancel
      </button>
      <span className="pl-sub">
        Saving revises the plan; an approved plan goes back for review.
      </span>
    </div>
  );
}

// Test attributes

function AttributesTab({ ids, plan, selected, trace, onSelect }: TabProps) {
  const flagged = findingsByCode(plan);
  if (plan.attributes.length === 0) {
    return (
      <p className="pl-quiet">The control has no approved attributes yet.</p>
    );
  }
  return (
    <ol className="pl-list">
      {plan.attributes.map((item) => (
        <AttributeItem
          key={item.id}
          ids={ids}
          plan={plan}
          item={item}
          className={rowClass(item.code, selected, trace)}
          findings={flagged.get(item.code)}
          onSelect={onSelect}
        />
      ))}
    </ol>
  );
}

function yesNo(value: boolean | null, yes: string, no: string): string {
  return value === null ? "Not determined" : value ? yes : no;
}

function AttributeItem({
  ids,
  plan,
  item,
  className,
  findings,
  onSelect,
}: {
  ids: Ids;
  plan: MasterPlan;
  item: Attribute;
  className: string;
  findings: Array<{ detail: string }> | undefined;
  onSelect: (code: string) => void;
}) {
  const action = useAction(ids);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    objective: item.objective,
    condition: item.condition,
    pass_criteria: item.passCriteria,
    fail_criteria: item.failCriteria,
  });
  const [judgment, setJudgment] = useState<boolean | null>(
    item.judgmentRequired,
  );
  const [automatable, setAutomatable] = useState<boolean | null>(
    item.automatable,
  );
  return (
    <li id={`pl-item-${item.code}`} className={className}>
      <div className="pl-item-head">
        <button
          type="button"
          className="pl-code"
          onClick={() => onSelect(item.code)}
        >
          {item.code}
        </button>
        <p className="pl-item-text">{item.text}</p>
        <div className="pl-item-tools">
          <span
            className={`pill ${item.basis === "DOCUMENTED" ? "tone-success" : "tone-warning"}`}
          >
            {item.basis === "DOCUMENTED" ? "Documented" : "Inferred"}
          </span>
        </div>
      </div>
      {item.criteriaSource === "NONE" &&
      item.judgmentRequired === null &&
      item.automatable === null ? (
        <p className="pl-sub pl-nocriteria">No criteria stated yet.</p>
      ) : (
        <dl className="pl-criteria">
          <div>
            <dt>Passes when</dt>
            <dd>
              {item.passCriteria || <span className="pl-none">Not stated</span>}
            </dd>
          </div>
          <div>
            <dt>Fails when</dt>
            <dd>
              {item.failCriteria || <span className="pl-none">Not stated</span>}
            </dd>
          </div>
        </dl>
      )}
      <details className="pl-fold">
        <summary>How it is judged</summary>
        <dl className="pl-criteria">
          <div>
            <dt>Condition tested</dt>
            <dd>
              {item.condition || <span className="pl-none">Not stated</span>}
            </dd>
          </div>
          <div>
            <dt>Judgment</dt>
            <dd>
              {yesNo(
                item.judgmentRequired,
                "Professional judgment required",
                "Objectively testable",
              )}
            </dd>
          </div>
          <div>
            <dt>Automated testing</dt>
            <dd>{yesNo(item.automatable, "Suitable", "Not suitable")}</dd>
          </div>
          <div>
            <dt>Criteria</dt>
            <dd>
              <span
                className={
                  item.criteriaSource === "AGENT"
                    ? "ai-mark"
                    : item.criteriaSource === "PLAN"
                      ? "pl-person"
                      : "pl-sub"
                }
              >
                {item.criteriaSource === "AGENT" ? (
                  <UiIcon name="sparkles" size={11} />
                ) : null}
                {CRITERIA_LABELS[item.criteriaSource]}
              </span>
            </dd>
          </div>
        </dl>
      </details>
      {item.objective ? (
        <p className="pl-sub">Addresses: {item.objective}</p>
      ) : null}
      <div className="pl-item-links">
        <Chips
          label="Tested by"
          codes={item.procedureCodes}
          onSelect={onSelect}
        />
        <Chips
          label="Evidence"
          codes={item.evidenceCodes}
          onSelect={onSelect}
        />
        <span className="pl-item-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setEditing(!editing)}
          >
            Edit criteria
          </button>
        </span>
      </div>
      <Flags findings={findings} />
      {editing ? (
        <div className="pl-edit" aria-busy={action.pending}>
          {(
            [
              ["objective", "The control objective or risk it addresses", 500],
              ["condition", "The exact condition tested", 1000],
              ["pass_criteria", "Passes when", 1000],
              ["fail_criteria", "Fails when", 1000],
            ] as const
          ).map(([name, label, limit]) => (
            <label key={name}>
              {label}
              <textarea
                rows={2}
                maxLength={limit}
                value={form[name]}
                onChange={(event) =>
                  setForm({ ...form, [name]: event.target.value })
                }
              />
            </label>
          ))}
          <div className="pl-edit-row">
            <label>
              Judgment
              <select
                value={judgment === null ? "" : judgment ? "yes" : "no"}
                onChange={(event) =>
                  setJudgment(
                    event.target.value === ""
                      ? null
                      : event.target.value === "yes",
                  )
                }
              >
                <option value="">Not determined</option>
                <option value="no">Objectively testable</option>
                <option value="yes">Professional judgment required</option>
              </select>
            </label>
            <label>
              Automated testing
              <select
                value={automatable === null ? "" : automatable ? "yes" : "no"}
                onChange={(event) =>
                  setAutomatable(
                    event.target.value === ""
                      ? null
                      : event.target.value === "yes",
                  )
                }
              >
                <option value="">Not determined</option>
                <option value="yes">Suitable</option>
                <option value="no">Not suitable</option>
              </select>
            </label>
          </div>
          <EditButtons
            busy={action.pending}
            save="Save criteria"
            onCancel={() => setEditing(false)}
            onSave={async () => {
              const result = await action.run("criteria", {
                intent: "criteria",
                control_id: plan.controlId,
                attribute_id: item.id,
                version: item.version,
                ...form,
                judgment_required: judgment,
                automatable,
                phases: item.phases,
              });
              if (result.ok) {
                setEditing(false);
              }
            }}
          />
          <Problem text={action.problem} />
        </div>
      ) : null}
    </li>
  );
}

// Required evidence

function EvidenceTab({ ids, plan, selected, trace, onSelect }: TabProps) {
  const flagged = findingsByCode(plan);
  return (
    <div className="pl-sections">
      {PHASES.map((phase) => {
        const mine = plan.evidence.filter((item) => item.phase === phase);
        if (mine.length === 0) {
          return null;
        }
        return (
          <section key={phase} className="pl-phase">
            <h3>
              {PHASE_LABELS[phase]}{" "}
              <span className="pl-sub">{mine.length}</span>
            </h3>
            <ol className="pl-list">
              {mine.map((item) => (
                <EvidenceItem
                  key={item.id}
                  ids={ids}
                  plan={plan}
                  item={item}
                  className={rowClass(item.code, selected, trace)}
                  findings={flagged.get(item.code)}
                  onSelect={onSelect}
                />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function EvidenceItem({
  ids,
  plan,
  item,
  className,
  findings,
  onSelect,
}: {
  ids: Ids;
  plan: MasterPlan;
  item: Evidence;
  className: string;
  findings: Array<{ detail: string }> | undefined;
  onSelect: (code: string) => void;
}) {
  const action = useAction(ids);
  const [mode, setMode] = useState<"none" | "edit" | "links">("none");
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [attributes, setAttributes] = useState<Set<string>>(
    new Set(item.attributeIds),
  );
  const [procedures, setProcedures] = useState<Set<string>>(
    new Set(item.procedureIds),
  );
  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) {
      next.add(id);
    } else {
      next.delete(id);
    }
    return next;
  };
  return (
    <li id={`pl-item-${item.code}`} className={className}>
      <div className="pl-item-head">
        <button
          type="button"
          className="pl-code"
          onClick={() => onSelect(item.code)}
        >
          {item.code}
        </button>
        <div className="pl-item-text">
          <strong>{item.title}</strong>
          {item.description !== "" ? <p>{item.description}</p> : null}
          <span className="pl-sub">
            {PHASE_SHORT[item.phase]}
            {item.categories.length > 0
              ? ` · ${item.categories.join(", ").toLowerCase()}`
              : ""}
            {item.necessity ? ` · ${item.necessity.toLowerCase()}` : ""}
            {item.status
              ? ` · ${item.status.replaceAll("_", " ").toLowerCase()}`
              : ""}
            {item.periodLabel ? ` · ${item.periodLabel}` : ""}
          </span>
        </div>
        <div className="pl-item-tools">
          {item.status === "WAIVED" ? (
            <span className="pill">Not applicable</span>
          ) : null}
          <Mark origin={item.origin} personEdited={item.personEdited} />
        </div>
      </div>
      {item.objective ? (
        <p className="pl-sub">Objective: {item.objective}</p>
      ) : null}
      <div className="pl-item-links">
        <Chips
          label="Supports"
          codes={item.attributeCodes}
          onSelect={onSelect}
        />
        <Chips label="For" codes={item.procedureCodes} onSelect={onSelect} />
        <span className="pl-item-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setMode(mode === "edit" ? "none" : "edit")}
          >
            Edit
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setMode(mode === "links" ? "none" : "links")}
          >
            Links
          </button>
        </span>
      </div>
      {item.unmatched.length > 0 ? (
        <ul className="pl-flags">
          {item.unmatched.map((name) => (
            <li key={name}>
              <UiIcon name="risk" size={12} />
              Names an attribute the control does not have: {name}
            </li>
          ))}
        </ul>
      ) : null}
      <Flags
        findings={findings?.filter(
          (entry) => !entry.detail.startsWith(`${item.code} names`),
        )}
      />
      {mode === "edit" ? (
        <div className="pl-edit" aria-busy={action.pending}>
          <label>
            What to request
            <input
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            What it must show
            <textarea
              rows={4}
              maxLength={1500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <EditButtons
            busy={action.pending}
            disabled={title.trim().length < 3 || description.trim().length < 10}
            save="Save evidence"
            onCancel={() => setMode("none")}
            onSave={async () => {
              const result = await action.run("edit", {
                intent: "evidence-edit",
                control_id: plan.controlId,
                requirement_id: item.id,
                version: item.version,
                title,
                description,
              });
              if (result.ok) {
                setMode("none");
              }
            }}
          />
          <Problem text={action.problem} />
        </div>
      ) : null}
      {mode === "links" ? (
        <div className="pl-edit" aria-busy={action.pending}>
          <fieldset>
            <legend>Attributes it supports</legend>
            {plan.attributes.map((attribute) => (
              <label key={attribute.id} className="pl-check">
                <input
                  type="checkbox"
                  checked={attributes.has(attribute.id)}
                  onChange={(event) =>
                    setAttributes(
                      toggle(attributes, attribute.id, event.target.checked),
                    )
                  }
                />
                <span className="pl-ref">{attribute.code}</span>{" "}
                {attribute.text}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Procedures it serves</legend>
            {plan.procedures
              .filter((procedure) => procedure.phase === item.phase)
              .map((procedure) => (
                <label key={procedure.id} className="pl-check">
                  <input
                    type="checkbox"
                    checked={procedures.has(procedure.id)}
                    onChange={(event) =>
                      setProcedures(
                        toggle(procedures, procedure.id, event.target.checked),
                      )
                    }
                  />
                  <span className="pl-ref">{procedure.code}</span>{" "}
                  {procedure.text}
                </label>
              ))}
          </fieldset>
          <EditButtons
            busy={action.pending}
            save="Save links"
            onCancel={() => setMode("none")}
            onSave={async () => {
              const result = await action.run("links", {
                intent: "evidence-links",
                control_id: plan.controlId,
                requirement_id: item.id,
                attribute_ids: [...attributes],
                procedure_ids: [...procedures],
              });
              if (result.ok) {
                setMode("none");
              }
            }}
          />
          <Problem text={action.problem} />
        </div>
      ) : null}
    </li>
  );
}

// History

function History({ plan }: { plan: MasterPlan }) {
  if (plan.decisions.length === 0) {
    return null;
  }
  return (
    <details className="card pl-history">
      <summary>
        Decision history <span className="pl-sub">{plan.decisions.length}</span>
      </summary>
      <ol>
        {plan.decisions.map((item) => (
          <li key={`${item.decidedAt}-${item.revision}`}>
            <strong>{decisionLine(item)}</strong>
            <span className="pl-sub">
              {formatDate(item.decidedAt)} · version hash{" "}
              {item.contentHash.slice(0, 12)}
              {item.findings > 0
                ? ` · ${item.findings} finding${item.findings === 1 ? "" : "s"} kept`
                : ""}
            </span>
            {item.comment ? <p>{item.comment}</p> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}
