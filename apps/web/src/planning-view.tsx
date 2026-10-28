"use client";

import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { AnswerProgress } from "./answer-progress";
import type { Confidence } from "./control-context-model";
import { useAction as useContextAction } from "./control-context-view";
import { PLAN_TAB_EVENT, PLAN_VIEW_EVENT } from "./control-rail-model";
import { DescribeDialog } from "./describe-dialog";
import { formatDate } from "./format";
import type { PlanningPageState } from "./load-planning";
import { CONTROL_CATEGORIES } from "./onboarding-model";
import { PhaseStrip, PhasesView, ViewSwitch } from "./phases-view";
import {
  ADDABLE_TYPES,
  type Attribute,
  type AttributeRow,
  activeFilters,
  answeredValues,
  answerPlaceholder,
  approvalHeldBy,
  approvalHolds,
  attributeReadiness,
  attributeRows,
  BASIS_LABELS,
  basisWords,
  type ControlPhases,
  CRITERIA_LABELS,
  changesSummary,
  criteriaToAccept,
  decisionLine,
  decisionWords,
  describeQuestions,
  EVIDENCE_PURPOSE,
  EVIDENCE_STATUS_LABELS,
  EVIDENCE_TYPE_LABELS,
  type Evidence,
  type EvidenceRow,
  type EvidenceStatus,
  evidenceCoverage,
  evidenceRows,
  evidenceSummary,
  type Fact,
  FILTER_LABELS,
  type Finding,
  type FindingFix,
  factTitle,
  filledLine,
  filterOptionLabel,
  filterOptions,
  filterQueue,
  findingFix,
  findingsByCode,
  groupChanges,
  type HoldGroup,
  holdHref,
  isAgentWork,
  type MasterPlan,
  METHOD_LABELS,
  METHODS,
  missingValueOf,
  NO_FILTERS,
  neighbours,
  nextStepOf,
  type OpenValue,
  openValueFor,
  originLabel,
  otherSystems,
  PHASE_LABELS,
  PHASE_PURPOSE,
  PHASES,
  type Phase,
  type PlanningState,
  type Procedure,
  type ProcedureRow,
  planningHref,
  planningProblem,
  planQuestions,
  planVersions,
  procedureCoverage,
  procedureReadiness,
  procedureRows,
  QUEUE_FIGURES,
  QUEUE_FILTERS,
  type Queue,
  type QueueFilter,
  type QueueFilters,
  type QueueRow,
  questionsToSave,
  questionText,
  related,
  STATE_LABELS,
  STATE_TONES,
  standardStepsHref,
  statementParts,
  TAB_LABELS,
  TABS,
  type Tab,
  tabCounts,
  tabOfCode,
  type ValueQuestion,
  valueQuestions,
  valuesItems,
} from "./planning-model";
import { implementationName } from "./shared-plans-model";
import { ControlsView } from "./shared-plans-view";
import { controlStepHref } from "./testing-hub-model";
import { type IconName, UiIcon } from "./ui-icon";
import { SuggestedAnswer } from "./value-options";
import { joinAnswers } from "./value-suggestions";

type Ids = {
  organizationId: string;
  projectId: string;
  /** The destination the page's links stay in (M2b); the Test plans page by default. */
  section?: "planning" | "testing";
};

const AREAS = new Map<string, string>(
  CONTROL_CATEGORIES.flatMap((category) =>
    category.domains.map(([key, label]) => [key, label] as [string, string]),
  ),
);

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
  // The action whose result is still being brought onto the page: its label stays (for
  // example "Approving…") until the refreshed plan shows, not only until it is saved.
  const [settling, setSettling] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  async function run(
    label: string,
    fields: Record<string, unknown>,
  ): Promise<{ ok: boolean; body: unknown }> {
    setBusy(label);
    setSettling(label);
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
    } else {
      setSettling("");
    }
    return { ok: message === null, body };
  }
  return {
    run,
    busy: busy !== "" ? busy : pending ? settling : "",
    pending: pending || busy !== "",
    problem,
  };
}

/** A plan approved before and changed since: what differs from the revision approved,
 * one line per part of the plan, so the reviewer approves the changes knowingly. Each
 * item's code opens it. */
function SinceApproval({
  plan,
  onSelect,
}: {
  plan: MasterPlan;
  onSelect: (code: string) => void;
}) {
  const approval = plan.decisions.find((item) => item.decision === "APPROVED");
  const groups = groupChanges(plan.changesSinceApproval);
  return (
    <section className="pl-since" aria-label="Changed since approval">
      <h2>
        <UiIcon name="info" size={15} />
        Changed since you approved revision {plan.approvedRevision}
      </h2>
      <p className="pl-since-lead">
        {approval !== undefined
          ? `Approved by ${approval.decidedBy} on ${formatDate(approval.decidedAt)}. `
          : ""}
        Approving now approves revision {plan.revision}, with these changes.
      </p>
      {groups.length > 0 ? (
        <dl className="pl-since-groups">
          {groups.map((group) => (
            <div key={group.label}>
              <dt>{group.label}</dt>
              <dd>
                {group.parts.map((part, at) => (
                  <span key={part.what} className="pl-since-part">
                    {at > 0 ? (
                      <span className="pl-since-dot" aria-hidden="true">
                        ·
                      </span>
                    ) : null}
                    {part.what}
                    {part.codes.map((code) => (
                      <button
                        key={code}
                        type="button"
                        className="pl-since-code"
                        onClick={() => onSelect(code)}
                      >
                        {code}
                      </button>
                    ))}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="pl-since-lead">
          Nothing in the plan changed but client values filled in.
        </p>
      )}
      {plan.filledSinceApproval.length > 0 ? (
        <p className="pl-filled">{filledLine(plan.filledSinceApproval)}</p>
      ) : null}
    </section>
  );
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
  header,
}: {
  ids: Ids;
  projectName: string;
  state: PlanningPageState | null;
  /** The page header to show instead of the Test plans header (the Testing
   * destination's, M2b). */
  header?: ReactNode;
}) {
  if (state?.controlId) {
    if (state.plan === null) {
      return (
        <div className="page pl-page">
          <a
            className="text-link is-plain pl-back"
            href={planningHref(ids.organizationId, ids.projectId, {
              section: ids.section,
            })}
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
  if (state?.view === "controls") {
    return (
      <ControlsView
        ids={ids}
        state={state}
        header={header ?? <QueueHeader projectName={projectName} />}
      />
    );
  }
  if (state?.view === "phases") {
    return (
      <PhasesView
        ids={ids}
        state={state}
        header={header ?? <QueueHeader projectName={projectName} />}
      />
    );
  }
  return (
    <PlanQueue
      ids={ids}
      projectName={projectName}
      state={state}
      header={header}
    />
  );
}

// The planning review queue

function PlanQueue({
  ids,
  projectName,
  state,
  header,
}: {
  ids: Ids;
  projectName: string;
  state: PlanningPageState | null;
  header?: ReactNode;
}) {
  const action = useAction(ids);
  const router = useRouter();
  const queue = state?.queue ?? null;
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<QueueFilters>(NO_FILTERS);
  // On a narrow screen the filters fold behind a button; on a wide one they always show.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const [outcome, setOutcome] = useState<string | null>(null);
  // Answering the client values the plans ask for: every plan shown, or one control.
  const [answering, setAnswering] = useState<"shown" | string | null>(null);
  const filter = state?.filter ?? [];
  // The filters last used on this engagement's queue, for this browser session: opening a
  // plan and coming back keeps them.
  const storageKey = `pl-queue-filters:${ids.projectId}`;
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      if (saved !== null) {
        const parsed = JSON.parse(saved) as Record<string, unknown>;
        setFilters(
          Object.fromEntries(
            QUEUE_FILTERS.map((key) => [
              key,
              typeof parsed[key] === "string" ? parsed[key] : "",
            ]),
          ) as QueueFilters,
        );
      }
    } catch {
      // Session storage is a convenience; the queue works without it.
    }
  }, [storageKey]);
  const setFilter = (key: QueueFilter, value: string) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    setSelected(new Set());
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // As above.
    }
  };
  const clearFilters = () => {
    setFilters(NO_FILTERS);
    setSelected(new Set());
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      // As above.
    }
  };
  const rows = useMemo(
    () => filterQueue(queue?.controls ?? [], filter, search, filters),
    [queue, filter, search, filters],
  );
  const questions = useMemo(() => valueQuestions(rows), [rows]);
  // Every open question, whatever the filters show: the same question on another system
  // is offered the answer given here.
  const allQuestions = useMemo(
    () => valueQuestions(queue?.controls ?? []),
    [queue],
  );
  const answeringRows =
    answering === null || answering === "shown"
      ? rows
      : rows.filter((row) => row.controlId === answering);
  const answeringQuestions =
    answering === null || answering === "shown"
      ? questions
      : valueQuestions(answeringRows);
  const options = useMemo(
    () => filterOptions(queue?.controls ?? [], filters),
    [queue, filters],
  );
  if (queue === null) {
    return (
      <div className="page pl-page">
        {header ?? <QueueHeader projectName={projectName} />}
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
      section: ids.section,
      filter: states.join(","),
      view: "each",
    });
  const active = (states: readonly PlanningState[]) =>
    states.length === filter.length &&
    states.every((item) => filter.includes(item));
  const nextHref =
    queue.nextControlId === null
      ? null
      : planningHref(ids.organizationId, ids.projectId, {
          section: ids.section,
          control: queue.nextControlId,
        });
  return (
    <div className="page pl-page">
      <QueueHeader
        projectName={projectName}
        header={header}
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
      {queue.viewerCanAnswer ? (
        <AnswerValuesDialog
          questions={answeringQuestions}
          related={allQuestions}
          scope={
            answering === null || answering === "shown"
              ? activeFilters(filters).length > 0 || search.trim() !== ""
                ? "the plans shown"
                : "this engagement's plans"
              : (answeringRows[0]?.controlRef ?? "this control")
          }
          open={answering !== null && answeringQuestions.length > 0}
          busy={action.pending}
          problem={answering !== null ? action.problem : null}
          onClose={() => setAnswering(null)}
          onSave={async (items) => {
            const done = await action.run("values-many", {
              intent: "values-many",
              items,
            });
            if (done.ok) {
              const answer = (done.body ?? {}) as { controls?: number };
              setAnswering(null);
              setOutcome(
                `Saved. ${answer.controls ?? items.length} control${(answer.controls ?? items.length) === 1 ? "" : "s"} updated with the client's values.`,
              );
            }
          }}
        />
      ) : null}
      <section className="card pl-queue" aria-busy={action.pending}>
        <div className="pl-toolbar">
          <label className="pl-search">
            <UiIcon name="search" size={14} />
            <span className="sr-only">Search controls</span>
            <input
              type="search"
              value={search}
              placeholder="Search by control, title, system, or process"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <span className="pl-count">
            {rows.length} of {queue.total}
          </span>
          {queue.viewerCanAnswer && questions.length > 0 ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm pl-answer-open"
              aria-haspopup="dialog"
              onClick={() => setAnswering("shown")}
            >
              <UiIcon name="compose" size={13} />
              Answer open questions
              <span className="pl-answer-count">{questions.length}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary btn-sm pl-filter-toggle"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <UiIcon name="filter" size={13} />
            Filters
            {activeFilters(filters).length + (filter.length > 0 ? 1 : 0) > 0
              ? ` (${activeFilters(filters).length + (filter.length > 0 ? 1 : 0)})`
              : ""}
          </button>
        </div>
        <fieldset className={`pl-filters ${filtersOpen ? "is-open" : ""}`}>
          <legend className="sr-only">Filter the plans</legend>
          <label className={`pl-filter ${filter.length > 0 ? "is-set" : ""}`}>
            <span>Status</span>
            <select
              value={
                QUEUE_FIGURES.find(
                  (figure) =>
                    figure.states.length === filter.length &&
                    figure.states.every((item) => filter.includes(item)),
                )?.label ?? ""
              }
              onChange={(event) => {
                const figure = QUEUE_FIGURES.find(
                  (item) => item.label === event.target.value,
                );
                router.push(filterHref(figure?.states ?? []));
              }}
            >
              <option value="">All</option>
              {QUEUE_FIGURES.map((figure) => (
                <option key={figure.label} value={figure.label}>
                  {figure.label} (
                  {figure.states.reduce(
                    (sum, item) => sum + (queue.counts[item] ?? 0),
                    0,
                  )}
                  )
                </option>
              ))}
            </select>
          </label>
          {options.map((group) => (
            <label
              key={group.filter}
              className={`pl-filter ${filters[group.filter] !== "" ? "is-set" : ""}`}
            >
              <span>{FILTER_LABELS[group.filter]}</span>
              <select
                value={filters[group.filter]}
                onChange={(event) =>
                  setFilter(group.filter, event.target.value)
                }
              >
                <option value="">All</option>
                {group.options.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={
                      option.count === 0 &&
                      filters[group.filter] !== option.value
                    }
                  >
                    {option.label} ({option.count})
                  </option>
                ))}
              </select>
            </label>
          ))}
          {activeFilters(filters).length > 0 || filter.length > 0 ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm pl-filter-clear"
              onClick={() => {
                clearFilters();
                if (filter.length > 0) {
                  router.push(filterHref([]));
                }
              }}
            >
              Clear filters
            </button>
          ) : null}
        </fieldset>
        {activeFilters(filters).length > 0 ? (
          <ul className="pl-filter-chips" aria-label="Filters applied">
            {activeFilters(filters).map((key) => (
              <li key={key}>
                <span>
                  {FILTER_LABELS[key]}:{" "}
                  <strong>{filterOptionLabel(key, filters[key])}</strong>
                </span>
                <button
                  type="button"
                  aria-label={`Remove the ${FILTER_LABELS[key].toLowerCase()} filter`}
                  onClick={() => setFilter(key, "")}
                >
                  <UiIcon name="x" size={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
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
          <p className="pl-quiet">
            No control matches these filters.{" "}
            {activeFilters(filters).length > 0 ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={clearFilters}
              >
                Clear filters
              </button>
            ) : null}
          </p>
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
                  <th scope="col">Next step</th>
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
                    onAnswer={
                      queue.viewerCanAnswer && row.openValues.length > 0
                        ? () => setAnswering(row.controlId)
                        : null
                    }
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
  header,
}: {
  projectName: string;
  actions?: ReactNode;
  /** Another page's header in place of this one; the actions follow it. */
  header?: ReactNode;
}) {
  if (header !== undefined) {
    return (
      <>
        {header}
        {actions === undefined ? null : (
          <div className="pl-toolbar">{actions}</div>
        )}
      </>
    );
  }
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

/** A question's identity in the dialog: its system and value. */
const questionId = (question: ValueQuestion): string =>
  `${question.system}::${question.key}`;

/**
 * The client values the plans shown ask for, answered ahead of review: each value asked
 * once per system, with the controls it fills. Saving records them all at once; values
 * left blank stay open.
 */
function AnswerValuesDialog({
  questions,
  related,
  scope,
  focus,
  open,
  busy,
  problem,
  onClose,
  onSave,
}: {
  questions: ValueQuestion[];
  /** Every open question of the engagement: where the same one is asked of another
   * system, an answer here can be used for it too. */
  related: ValueQuestion[];
  /** What the dialog covers, in words: the plans shown, or one control. */
  scope: string;
  /** The value the person opened it for (its key): its answer is focused. */
  focus?: string | undefined;
  open: boolean;
  busy: boolean;
  problem: string | null;
  onClose: () => void;
  onSave: (
    items: Array<{ control_id: string; values: Record<string, string> }>,
  ) => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [session, setSession] = useState(0);
  const saving = questionsToSave(questions, related, answers, questionId);
  const items = valuesItems(saving, answers, questionId);
  const answered = saving.filter(
    (question) => (answers[questionId(question)] ?? "").trim() !== "",
  ).length;
  const shownAnswered = questions.filter(
    (question) => (answers[questionId(question)] ?? "").trim() !== "",
  ).length;
  // Give the same question on the systems named this answer, or take it back.
  const applyTo = (
    question: ValueQuestion,
    systems: readonly string[],
    on: boolean,
  ) => {
    const answer = answers[questionId(question)] ?? "";
    const copied = { ...answers };
    for (const other of otherSystems(question, related)) {
      if (systems.includes(other.system)) {
        copied[questionId(other)] = on ? answer : "";
      }
    }
    setAnswers(copied);
  };
  const filled = items.length;
  useEffect(() => {
    const element = dialog.current;
    if (element === null) {
      return;
    }
    if (open && !element.open) {
      setAnswers({});
      // Each opening starts afresh: no suggestions left open from the last time.
      setSession((current) => current + 1);
      element.showModal();
      const index = questions.findIndex((question) => question.key === focus);
      if (index >= 0) {
        // Once the fresh cards have rendered, go to the value the person chose.
        window.setTimeout(() => {
          const input = document.getElementById(`${id}-${index}`);
          input?.focus();
          input?.scrollIntoView({ block: "center" });
        }, 0);
      }
    } else if (!open && element.open) {
      element.close();
    }
  }, [open, focus, questions, id]);
  const systems = [...new Set(questions.map((question) => question.system))];
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a click on the backdrop cancels; Escape and Cancel do too, through the dialog itself.
    <dialog
      ref={dialog}
      className="confirm-dialog pl-values-dialog pl-answer-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        className="confirm-dialog-body"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          if (items.length > 0) {
            onSave(items);
          }
        }}
      >
        <h2 id={`${id}-title`}>Open client values</h2>
        <p id={`${id}-body`}>
          {questions.length === 1
            ? "One value is"
            : `${questions.length} values are`}{" "}
          asked for {scope}. Each answer is used in the controls listed under
          it: their description and the attributes that refer to it. Values left
          blank stay open.
        </p>
        <AnswerProgress answered={shownAnswered} total={questions.length} />
        <div className="pl-values" key={session}>
          {systems.map((system) => (
            <section key={system || "none"} className="pl-values-system">
              {systems.length > 1 || system !== "" ? (
                <h3>
                  <UiIcon name="server" size={12} />
                  {system || "No system"}
                </h3>
              ) : null}
              <ol className="pl-qs">
                {questions
                  .filter((question) => question.system === system)
                  .map((question) => (
                    <QuestionCard
                      key={questionId(question)}
                      number={questions.indexOf(question) + 1}
                      inputId={`${id}-${questions.indexOf(question)}`}
                      value={question}
                      controls={question.controls}
                      answer={answers[questionId(question)] ?? ""}
                      onAnswer={(text) =>
                        setAnswers({ ...answers, [questionId(question)]: text })
                      }
                      others={otherSystems(question, related).map((other) => ({
                        system: other.system,
                        answer: answers[questionId(other)] ?? "",
                      }))}
                      onApply={(systems, on) => applyTo(question, systems, on)}
                    />
                  ))}
              </ol>
            </section>
          ))}
        </div>
        {problem !== null ? (
          <p className="pl-values-problem" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="confirm-dialog-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy || answered === 0}>
            {busy
              ? "Saving…"
              : answered === 0
                ? "Save answers"
                : `Save ${answered} answer${answered === 1 ? "" : "s"} for ${filled} control${filled === 1 ? "" : "s"}`}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function QueueLine({
  ids,
  row,
  canDecide,
  selected,
  onToggle,
  onAnswer,
}: {
  ids: Ids;
  row: QueueRow;
  canDecide: boolean;
  selected: boolean;
  onToggle: () => void;
  /** Answer the client values this plan asks for, when it asks for any. */
  onAnswer: (() => void) | null;
}) {
  const href = planningHref(ids.organizationId, ids.projectId, {
    section: ids.section,
    control: row.controlId,
  });
  const step = nextStepOf(row);
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
        <span className="pl-sub">
          {implementationName(row.application, row.units) || "No system"}
        </span>
      </td>
      <td>
        <StatePill state={row.state} />
        {row.revisedSinceApproval ? (
          <span
            className="pl-sub pl-changed"
            title={row.changesSinceApproval.join("\n") || undefined}
          >
            Changed since approval: {changesSummary(row.changesSinceApproval)}
          </span>
        ) : null}
      </td>
      <td>
        {step.kind === "answer" && onAnswer !== null ? (
          <button
            type="button"
            className="pl-step is-answer"
            aria-haspopup="dialog"
            onClick={onAnswer}
          >
            <UiIcon name="compose" size={13} />
            {step.label}
          </button>
        ) : step.kind === "held" ? (
          <a className="pl-step is-held" href={href} title={step.detail}>
            <UiIcon name="risk" size={13} />
            {step.label}
          </a>
        ) : step.kind === "decide" || step.kind === "review" ? (
          <a className="pl-step" href={href}>
            {step.label}
            <UiIcon name="chevron" size={12} />
          </a>
        ) : step.kind === "ready" ? (
          <span className="pl-step is-ready">
            <UiIcon name="check" size={13} />
            {step.label}
          </span>
        ) : (
          <span className="pl-sub">{step.label}</span>
        )}
      </td>
      <td>
        {row.lastDecision === null ? (
          <span className="pl-sub">
            <span aria-hidden="true">—</span>
            <span className="sr-only">No decision yet</span>
          </span>
        ) : (
          <>
            <span className={row.revisedSinceApproval ? "pl-sub" : undefined}>
              {decisionWords(row)}
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

export function PlanReview({
  ids,
  plan,
  queue,
  initialTab,
  phases,
  canRelease,
  embedded = false,
  workspace = null,
  clientQuestions = null,
  confidence = null,
}: {
  ids: Ids;
  plan: MasterPlan;
  queue: Queue | null;
  initialTab: Tab;
  phases: ControlPhases | undefined;
  canRelease: boolean;
  /** Inside the control's Plan step (M2d): no breadcrumb, pager or repeated title; the
   * state, the decisions and the review actions stay. */
  embedded?: boolean;
  /** In the control's Plan step (decided by the product owner): the control's own
   * editors inside the plan, so each fact is shown once and edited where it is read. */
  workspace?: PlanWorkspace | null;
  /** The client-specific questions the plan asks, and how many testing waits on: the
   * planning agent's banner in the control's Plan step (decided by the product owner). */
  clientQuestions?: { total: number; attention: number; open: number } | null;
  /** The lowest confidence among the attribute definitions the plan tests against, for
   * the Plan review's figures; null where none is stated. */
  confidence?: Confidence | null;
}) {
  const [view, setView] = useState<Tab | "history">(initialTab);
  // The control's assistant opens a section of the plan (its suggested next actions).
  useEffect(() => {
    const open = (event: Event) => {
      const tab = (event as CustomEvent<string>).detail;
      if (tab === "history" || TABS.includes(tab as Tab)) {
        setView(tab as Tab | "history");
        setSelected(null);
        requestAnimationFrame(() =>
          document
            .getElementById("pl-plan-tabs")
            ?.scrollIntoView({ block: "start", behavior: "smooth" }),
        );
      }
    };
    document.addEventListener(PLAN_TAB_EVENT, open);
    return () => document.removeEventListener(PLAN_TAB_EVENT, open);
  }, []);
  useEffect(() => {
    if (embedded) {
      document.dispatchEvent(
        new CustomEvent(PLAN_VIEW_EVENT, { detail: view }),
      );
    }
  }, [embedded, view]);
  const [selected, setSelected] = useState<string | null>(null);
  const [sources, setSources] = useState(false);
  // A client value answered from where the plan shows it missing (its key), in the same
  // dialog the queue uses.
  const [answering, setAnswering] = useState<string | null>(null);
  const answer = useAction(ids);
  const questions =
    plan.viewerCanAnswer && plan.openValues.length > 0
      ? planQuestions(plan)
      : [];
  const onAnswer = questions.length > 0 ? setAnswering : undefined;
  // A client's own control described by the team (master_plans.state_facts): the fact
  // opened for, or "" for the dialog as a whole.
  const [describing, setDescribing] = useState<string | null>(null);
  const described = plan.viewerCanAnswer ? describeQuestions(plan) : [];
  const describe =
    described.length > 0
      ? {
          fields: new Map(
            described.map((item) => [
              item.field as string,
              item.proposal === "" ? "missing" : "proposed",
            ]),
          ),
          open: (field: string) => setDescribing(field),
        }
      : undefined;
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
    basisWords(control),
  ].filter((item) => item !== "");
  return (
    <div className={`page pl-page pl-review${embedded ? " is-embedded" : ""}`}>
      {questions.length > 0 ? (
        <AnswerValuesDialog
          questions={questions}
          related={questions}
          scope={control.controlRef}
          focus={answering ?? undefined}
          open={answering !== null}
          busy={answer.pending}
          problem={answering !== null ? answer.problem : null}
          onClose={() => setAnswering(null)}
          onSave={async (items) => {
            const done = await answer.run("values-many", {
              intent: "values-many",
              items,
            });
            if (done.ok) {
              setAnswering(null);
            }
          }}
        />
      ) : null}
      {described.length > 0 ? (
        <DescribeDialog
          controlRef={control.controlRef}
          questions={described}
          focus={describing || undefined}
          open={describing !== null}
          busy={answer.pending}
          problem={describing !== null ? answer.problem : null}
          onClose={() => setDescribing(null)}
          onSave={async (facts) => {
            const done = await answer.run("facts", {
              intent: "facts",
              control_id: plan.controlId,
              facts,
            });
            if (done.ok) {
              setDescribing(null);
            }
          }}
        />
      ) : null}
      <article className="card pl-review-shell">
        {embedded ? null : (
          <div className="pl-shell-bar">
            <nav className="pl-crumbs" aria-label="Breadcrumb">
              <a
                href={planningHref(ids.organizationId, ids.projectId, {
                  section: ids.section,
                })}
              >
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
        )}
        {clientQuestions !== null ? (
          <PlanSummary
            ids={ids}
            plan={plan}
            questions={clientQuestions}
            confidence={confidence}
            view={view}
            activityToday={workspace?.activityToday ?? null}
            onOpen={(tab) => {
              setView(tab);
              setSelected(null);
            }}
            onQuestions={() => {
              setView("understanding");
              setSelected(null);
              // The questions are in the Understanding tab, once it is drawn.
              requestAnimationFrame(() =>
                document.getElementById("client-info")?.scrollIntoView({
                  block: "start",
                  behavior: "smooth",
                }),
              );
            }}
          />
        ) : (
          <header className="pl-shell-head">
            <div className="pl-id">
              {embedded ? null : (
                <p className="pl-kicker">
                  <span className="pl-control-ref">{control.controlRef}</span>
                  {control.application !== "" || control.units !== "" ? (
                    <span>
                      {implementationName(control.application, control.units)}
                    </span>
                  ) : null}
                </p>
              )}
              <div className="pl-title-row">
                {embedded ? (
                  <h2 className="pl-embedded-title">Test plan</h2>
                ) : (
                  <h1>{control.title}</h1>
                )}
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
              {plan.filledSinceApproval.length > 0 &&
              !plan.revisedSinceApproval ? (
                <p className="pl-filled">
                  <UiIcon name="info" size={13} />
                  {filledLine(plan.filledSinceApproval)}
                </p>
              ) : null}
            </div>
            <ReviewActions ids={ids} plan={plan} />
          </header>
        )}
        {plan.revisedSinceApproval && plan.approvedRevision !== null ? (
          <SinceApproval plan={plan} onSelect={select} />
        ) : null}
        <Holding
          ids={ids}
          plan={plan}
          onOpen={
            workspace === null
              ? undefined
              : (tab) => {
                  setView(tab);
                  setSelected(null);
                }
          }
          onDescribe={
            describe === undefined ? undefined : () => setDescribing("")
          }
          onUnderstanding={() => {
            setView("understanding");
            setSelected(null);
          }}
        />
        {plan.state === "APPROVED" ? (
          <PhaseStrip ids={ids} row={phases} canRelease={canRelease} />
        ) : null}
        <div className="pl-plan-body">
          <div
            className="pl-tabs"
            id="pl-plan-tabs"
            role="tablist"
            aria-label="The plan's sections"
          >
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
            {embedded ? (
              // In the control's Plan step the plan's decisions are a section of it.
              <button
                type="button"
                role="tab"
                id="pl-tab-history"
                aria-selected={view === "history"}
                aria-controls="pl-panel-history"
                className={view === "history" ? "is-active" : undefined}
                onClick={() => setView("history")}
              >
                <span className="pl-tab-name">History</span>
              </button>
            ) : null}
          </div>
          <div className="pl-plan-content">
            {selected !== null &&
            view !== "understanding" &&
            view !== "history" ? (
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
              <h2 className="sr-only">
                {view === "history" ? "History" : TAB_LABELS[view]}
              </h2>
              {view === "history" ? (
                workspace?.history != null ? (
                  <>
                    {workspace.history}
                    <section
                      className="ph-decisions"
                      id="ph-decisions"
                      aria-label="The plan's decisions"
                    >
                      <h3>The plan's decisions</h3>
                      <History plan={plan} inline />
                    </section>
                  </>
                ) : (
                  <History plan={plan} inline />
                )
              ) : view === "understanding" ? (
                <UnderstandingTab
                  plan={plan}
                  sources={sources}
                  onSources={setSources}
                  onAnswer={onAnswer}
                  describe={describe}
                  workspace={workspace}
                />
              ) : view === "procedures" ? (
                workspace !== null ? (
                  <ProceduresTab
                    ids={ids}
                    plan={plan}
                    selected={selected}
                    trace={trace}
                    onSelect={select}
                    table
                    guidance={workspace.basis}
                  />
                ) : (
                  <ProceduresTab
                    ids={ids}
                    plan={plan}
                    selected={selected}
                    trace={trace}
                    onSelect={select}
                  />
                )
              ) : view === "attributes" ? (
                <>
                  {plan.suggestedStandard !== null && plan.viewerCanAnswer ? (
                    <StandardSuggestion ids={ids} plan={plan} />
                  ) : null}
                  {workspace !== null ? (
                    <AttributesTable
                      ids={ids}
                      plan={plan}
                      selected={selected}
                      trace={trace}
                      onSelect={select}
                      guidance={workspace.basis}
                      editor={workspace.attributes}
                      editorOpen={workspace.attributesOpen === true}
                      editorLabel={
                        workspace.attributesLabel ??
                        "Agent proposals and attribute history"
                      }
                    />
                  ) : (
                    <AttributesTab
                      ids={ids}
                      plan={plan}
                      selected={selected}
                      trace={trace}
                      onSelect={select}
                    />
                  )}
                </>
              ) : workspace !== null ? (
                <EvidenceBoard
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
      {embedded ? null : <History plan={plan} />}
    </div>
  );
}

const CONFIDENCE_WORD: Record<Confidence, string> = {
  HIGH: "High",
  MODERATE: "Moderate",
  LOW: "Low",
  NOT_ESTABLISHED: "Not established",
};
const CONFIDENCE_FILL: Record<Confidence, number> = {
  HIGH: 100,
  MODERATE: 66,
  LOW: 33,
  NOT_ESTABLISHED: 0,
};

/**
 * The control's Plan review (decided by the product owner on 26 October 2026): what the
 * planning agent prepared, the decision, and the plan in figures, each opening its section;
 * how the agent drafted it folds away below. Every figure is a count of the plan's own
 * records; the confidence is the lowest its attribute definitions state.
 */
function PlanSummary({
  ids,
  plan,
  questions,
  confidence,
  view,
  activityToday,
  onOpen,
  onQuestions,
}: {
  ids: Ids;
  plan: MasterPlan;
  questions: { total: number; attention: number; open: number };
  confidence: Confidence | null;
  /** The section open below: on the other tabs, the figures are four cards. */
  view: Tab | "history";
  /** The control's activities today, for the History figures. */
  activityToday: number | null;
  onOpen: (tab: Tab) => void;
  onQuestions: () => void;
}) {
  const counts = tabCounts(plan);
  // The reference shows the Overview's figures in one panel and the other tabs' as
  // four cards, the last one the tab's own readiness.
  const tabView = view !== "understanding";
  const drafted = plan.state === "APPROVED" ? "Approved" : "Drafted by agent";
  const procedures = procedureReadiness(plan);
  const attributes = attributeReadiness(plan);
  const evidence = evidenceSummary(plan);
  const requested =
    evidence.REQUESTED + evidence.IN_PROGRESS + evidence.ACCEPTED;
  const versions = planVersions(plan).length;
  const today = activityToday ?? 0;
  const plural = (count: number, one: string, many: string) =>
    count === 1 ? one : many;
  const readiness: {
    good: string;
    zero: boolean;
    warn: string;
    label: string;
  } =
    view === "procedures"
      ? {
          good: `${procedures.ready} ready`,
          zero: procedures.ready === 0,
          // The same pair on every tab, as the reference shows, zero included.
          warn: `${procedures.review} need review`,
          label: "Procedure readiness",
        }
      : view === "attributes"
        ? {
            good: `${attributes.confirmed} confirmed`,
            zero: attributes.confirmed === 0,
            warn: `${attributes.review} ${plural(attributes.review, "needs review", "need review")}`,
            label: "Attribute readiness",
          }
        : view === "evidence"
          ? {
              good: `${requested} requested`,
              zero: requested === 0,
              warn: `${evidence.NEEDS_REVIEW} pending review`,
              label: "Evidence readiness",
            }
          : {
              good: `${today} ${plural(today, "activity", "activities")} today`,
              zero: today === 0,
              warn: `${versions} plan ${plural(versions, "version", "versions")}`,
              label: "Recent activity",
            };
  const figures: Array<{
    key: string;
    icon: IconName;
    tone: string;
    value: string;
    label: string;
    note: string;
    attention: boolean;
    open: () => void;
  }> = [
    {
      key: "questions",
      icon: "help",
      tone: "is-orange",
      value: String(questions.total),
      label: questions.total === 1 ? "Client question" : "Client questions",
      note:
        questions.total === 0
          ? "None asked"
          : questions.open > 0
            ? "Need your review"
            : "All answered",
      attention: questions.attention > 0 || questions.open > 0,
      open: onQuestions,
    },
    {
      key: "procedures",
      icon: "layers",
      tone: "is-purple",
      value: String(counts.procedures.items),
      label: counts.procedures.items === 1 ? "Procedure" : "Procedures",
      note: drafted,
      attention: counts.procedures.attention > 0,
      open: () => onOpen("procedures"),
    },
    {
      key: "attributes",
      icon: "message",
      tone: "is-green",
      value: String(counts.attributes.items),
      label: counts.attributes.items === 1 ? "Attribute" : "Attributes",
      note: drafted,
      attention: counts.attributes.attention > 0,
      open: () => onOpen("attributes"),
    },
    {
      key: "evidence",
      icon: "file",
      tone: "is-blue",
      value: String(counts.evidence.items),
      label: counts.evidence.items === 1 ? "Evidence item" : "Evidence items",
      note: drafted,
      attention: counts.evidence.attention > 0,
      open: () => onOpen("evidence"),
    },
  ];
  const cards: Array<{
    key: Tab;
    icon: IconName;
    tone: string;
    value: number;
    label: string;
  }> = [
    {
      key: "procedures",
      icon: "file",
      tone: "is-blue",
      value: counts.procedures.items,
      label: plural(counts.procedures.items, "Procedure", "Procedures"),
    },
    {
      key: "attributes",
      icon: "tag",
      tone: "is-purple",
      value: counts.attributes.items,
      label: plural(counts.attributes.items, "Attribute", "Attributes"),
    },
    {
      key: "evidence",
      icon: "database",
      tone: "is-green",
      value: counts.evidence.items,
      label: plural(counts.evidence.items, "Evidence item", "Evidence items"),
    },
  ];
  const meta = [
    `Revision ${plan.revision}${
      plan.approvedRevision !== null && plan.revisedSinceApproval
        ? `, approved ${plan.approvedRevision}`
        : ""
    }`,
    plan.decisions[0] === undefined
      ? "No decision yet"
      : `${decisionLine(plan.decisions[0])} · ${formatDate(plan.decisions[0].decidedAt)}`,
  ];
  return (
    <>
      <header className={`pl-shell-head pr-head${tabView ? " is-tab" : ""}`}>
        <div className="pl-id">
          <div className="pl-title-row">
            <h2 className="pl-embedded-title">Plan review</h2>
            <StatePill state={plan.state} />
          </div>
          <p className="pr-lead">
            {tabView
              ? "The planning agent has prepared the control understanding, procedures, attributes, and evidence based on the control context and relevant guidance. Review and approve to proceed."
              : "The planning agent has prepared the control understanding, procedures, attributes, and evidence based on the system and process context."}
          </p>
          {tabView ? null : <p className="pr-meta">{meta.join(" · ")}</p>}
          {plan.filledSinceApproval.length > 0 && !plan.revisedSinceApproval ? (
            <p className="pl-filled">
              <UiIcon name="info" size={13} />
              {filledLine(plan.filledSinceApproval)}
            </p>
          ) : null}
        </div>
        <ReviewActions ids={ids} plan={plan} />
      </header>
      {tabView ? (
        <div className="pr-box is-cards">
          <ul className="pr-cards" aria-label="The plan in figures">
            {cards.map((card) => (
              <li key={card.key}>
                <button type="button" onClick={() => onOpen(card.key)}>
                  <span className={`pr-tile ${card.tone}`} aria-hidden="true">
                    <UiIcon name={card.icon} size={22} />
                  </span>
                  <span className="pr-text">
                    <strong>{card.value}</strong>
                    <span>{card.label}</span>
                  </span>
                </button>
              </li>
            ))}
            <li className="pr-ready-card">
              <span className="pr-tile is-amber" aria-hidden="true">
                <UiIcon name="check" size={22} />
              </span>
              <span className="pr-text">
                <strong>
                  <span
                    className={`pr-ready${readiness.zero ? " is-none" : ""}`}
                  >
                    {readiness.good}
                  </span>
                  {" / "}
                  <span className="pr-review">{readiness.warn}</span>
                </strong>
                <span>{readiness.label}</span>
              </span>
            </li>
          </ul>
        </div>
      ) : (
        <div className="pr-box">
          <ul
            className="pr-figures"
            aria-label="The plan in figures"
            style={
              {
                "--pr-count": figures.length + (confidence !== null ? 1 : 0),
              } as CSSProperties
            }
          >
            {figures.map((item) => (
              <li key={item.key}>
                <button type="button" onClick={item.open}>
                  <span className={`pr-icon ${item.tone}`} aria-hidden="true">
                    <UiIcon name={item.icon} size={18} />
                  </span>
                  <span className="pr-text">
                    <strong>{item.value}</strong>
                    <span>{item.label}</span>
                    <small
                      className={item.attention ? "is-attention" : undefined}
                    >
                      {item.note}
                    </small>
                  </span>
                </button>
              </li>
            ))}
            {confidence !== null ? (
              <li className="pr-confidence">
                <span className="pr-icon is-teal" aria-hidden="true">
                  <UiIcon name="shield" size={18} />
                </span>
                <span className="pr-text">
                  <strong>{CONFIDENCE_WORD[confidence]}</strong>
                  <span>
                    Agent confidence{" "}
                    <span
                      className="pr-info"
                      title="The lowest confidence stated among the attribute definitions the plan tests against."
                    >
                      <UiIcon name="info" size={12} />
                      <span className="sr-only">
                        The lowest confidence stated among the attribute
                        definitions the plan tests against.
                      </span>
                    </span>
                  </span>
                  <span
                    className={`pr-meter is-${confidence.toLowerCase()}`}
                    aria-hidden="true"
                  >
                    <span
                      style={{ width: `${CONFIDENCE_FILL[confidence]}%` }}
                    />
                  </span>
                </span>
              </li>
            ) : null}
          </ul>
        </div>
      )}
    </>
  );
}

/**
 * Approving a plan that still asks for client values: the values asked by name, each
 * with why it matters, answered in place and recorded with the approval in one decision.
 * None of them holds approval, so the plan can also be approved with them left open.
 */
/** One client value, asked: its number (a tick once answered), the question and how to
 * answer it, the field with its suggestions, and the controls the answer fills. */
function QuestionCard({
  number,
  inputId,
  value,
  controls,
  answer,
  onAnswer,
  others = [],
  onApply,
}: {
  number: number;
  inputId: string;
  value: OpenValue;
  /** The controls the answer is used in, by reference and name. */
  controls: Array<{ ref: string; title: string }>;
  answer: string;
  onAnswer: (text: string) => void;
  /** The same question open for other systems, with the answer each has now. */
  others?: Array<{ system: string; answer: string }>;
  /** Give the systems named this answer (on), or take it back. */
  onApply?: (systems: string[], on: boolean) => void;
}) {
  const done = answer.trim() !== "";
  const name = (system: string) => system || "No system";
  const same = (other: { answer: string }) =>
    done && other.answer.trim() === answer.trim();
  const allSame = others.length > 0 && others.every(same);
  return (
    <li className={`pl-q${done ? " is-done" : ""}`}>
      <span className="pl-q-mark" aria-hidden="true">
        {done ? <UiIcon name="check" size={13} /> : number}
      </span>
      <div className="pl-q-body">
        <label className="pl-q-title" htmlFor={inputId}>
          {questionText(value)}
          <span className="sr-only">
            {done ? " (answered)" : " (not answered)"}
          </span>
        </label>
        {value.blocks ? (
          <span className="pl-q-flag">Testing waits for this answer</span>
        ) : null}
        {value.hint !== "" ? <p className="pl-q-hint">{value.hint}</p> : null}
        <SuggestedAnswer
          id={inputId}
          options={value.options}
          placeholder={answerPlaceholder(value)}
          value={answer}
          onChange={onAnswer}
        />
        {controls.length > 0 || others.length > 0 ? (
          <div className="pl-q-foot">
            {controls.length > 0 ? (
              <div className="pl-q-controls">
                <span>Used in</span>
                {controls.map((control) => (
                  <span
                    key={control.ref}
                    className="pl-q-control"
                    title={`${control.ref} ${control.title}`}
                  >
                    <span className="pl-q-control-ref">{control.ref}</span>
                    <span className="pl-q-control-name">{control.title}</span>
                  </span>
                ))}
              </div>
            ) : null}
            {others.length > 0 && done && onApply !== undefined ? (
              <fieldset className="pl-q-apply">
                <legend className="sr-only">
                  Apply this answer to other systems
                </legend>
                <span className="pl-q-apply-label" aria-hidden="true">
                  Apply to
                </span>
                {others.map((other) => (
                  <button
                    key={name(other.system)}
                    type="button"
                    className="pl-q-system"
                    aria-pressed={same(other)}
                    onClick={() => onApply([other.system], !same(other))}
                  >
                    <UiIcon name={same(other) ? "check" : "plus"} size={11} />
                    {name(other.system)}
                  </button>
                ))}
                {others.length > 1 ? (
                  <button
                    type="button"
                    className="pl-q-system is-all"
                    aria-pressed={allSame}
                    onClick={() =>
                      onApply(
                        others.map((other) => other.system),
                        !allSame,
                      )
                    }
                  >
                    {allSame ? "Clear all" : "All systems"}
                  </button>
                ) : null}
              </fieldset>
            ) : others.length > 0 ? (
              <p className="pl-q-others">
                <UiIcon name="layers" size={12} />
                Also asked for{" "}
                {joinAnswers(others.map((other) => name(other.system)))}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ValuesDialog({
  plan,
  open,
  busy,
  problem,
  onClose,
  onApprove,
}: {
  plan: MasterPlan;
  open: boolean;
  busy: boolean;
  problem: string | null;
  onClose: () => void;
  onApprove: (values: Record<string, string>, everywhere: boolean) => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [session, setSession] = useState(0);
  const [everywhere, setEverywhere] = useState(true);
  const answered = answeredValues(plan.openValues, answers);
  const count = Object.keys(answered).length;
  useEffect(() => {
    const element = dialog.current;
    if (element === null) {
      return;
    }
    if (open && !element.open) {
      setAnswers({});
      // Each opening starts afresh: no suggestions left open from the last time.
      setSession((current) => current + 1);
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);
  const asked = plan.openValues.length;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a click on the backdrop cancels; Escape and Cancel do too, through the dialog itself.
    <dialog
      ref={dialog}
      className="confirm-dialog pl-values-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        className="confirm-dialog-body"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          if (count > 0) {
            onApprove(answered, everywhere);
          }
        }}
      >
        <h2 id={`${id}-title`}>Before you approve</h2>
        <p id={`${id}-body`}>
          The plan asks for{" "}
          {asked === 1 ? "one client value" : `${asked} client values`}. Each
          answer fills the control's description and the attributes that refer
          to it. Values left blank stay open; they do not prevent approval.
        </p>
        <AnswerProgress answered={count} total={asked} />
        <div className="pl-values" key={session}>
          <ol className="pl-qs">
            {plan.openValues.map((item, index) => (
              <QuestionCard
                key={item.key}
                number={index + 1}
                inputId={`${id}-${item.key}`}
                value={item}
                controls={[]}
                answer={answers[item.key] ?? ""}
                onAnswer={(text) =>
                  setAnswers({ ...answers, [item.key]: text })
                }
              />
            ))}
          </ol>
        </div>
        <label className="pl-values-everywhere">
          <input
            type="checkbox"
            checked={everywhere}
            onChange={(event) => setEverywhere(event.target.checked)}
          />
          Also use these answers for other controls that ask for them and have
          none yet
        </label>
        {problem !== null ? (
          <p className="pl-values-problem" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="confirm-dialog-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => onApprove({}, false)}
          >
            Approve without answering
          </button>
          <button type="submit" disabled={busy || count === 0}>
            {busy
              ? "Approving…"
              : count > 1
                ? `Save ${count} answers and approve`
                : "Save and approve"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function ReviewActions({ ids, plan }: { ids: Ids; plan: MasterPlan }) {
  const action = useAction(ids);
  const commentId = useId();
  const [mode, setMode] = useState<"none" | "approve" | "return" | "submit">(
    "none",
  );
  const [text, setText] = useState("");
  // The client values the plan asks for, asked before approving (ValuesDialog).
  const [asking, setAsking] = useState(false);
  const fields = { control_id: plan.controlId, version: plan.version };
  const held = approvalHeldBy(plan);
  const approve = async (
    values: Record<string, string>,
    everywhere: boolean,
  ): Promise<void> => {
    const done = await action.run("approve", {
      intent: "approve",
      ...fields,
      comment: "",
      note: "",
      values,
      everywhere,
    });
    if (done.ok) {
      setAsking(false);
    }
    finish(done);
  };
  const approved = plan.state === "APPROVED" && plan.status === "APPROVED";
  const finish = (done: { ok: boolean }) => {
    if (done.ok) {
      setMode("none");
      setText("");
    }
  };
  return (
    <div className="pl-review-actions" aria-busy={action.pending}>
      {plan.viewerCanDecide && !approved && plan.openValues.length > 0 ? (
        <ValuesDialog
          plan={plan}
          open={asking}
          busy={action.pending}
          problem={asking ? action.problem : null}
          onClose={() => setAsking(false)}
          onApprove={(values, everywhere) => void approve(values, everywhere)}
        />
      ) : null}
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
          // One click approves the revision on screen (the version is sent with it); a
          // comment is optional, added through its own control.
          <span className="pl-approve">
            <button
              type="button"
              className="btn"
              disabled={action.pending || held !== null}
              title={
                held ??
                (plan.findings.length > 0
                  ? `Approves revision ${plan.revision}. ${plan.findings.length} finding${plan.findings.length === 1 ? " is" : "s are"} kept with the approval.`
                  : `Approves revision ${plan.revision}.`)
              }
              aria-haspopup={plan.openValues.length > 0 ? "dialog" : undefined}
              onClick={() =>
                plan.openValues.length > 0
                  ? setAsking(true)
                  : approve({}, false)
              }
            >
              <UiIcon name="check" size={13} />
              {action.busy === "approve" ? "Approving…" : "Approve plan"}
            </button>
            {mode !== "approve" ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm pl-approve-note"
                disabled={action.pending || held !== null}
                onClick={() => setMode("approve")}
              >
                Approve with a comment
              </button>
            ) : null}
          </span>
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
                  ? "Comment kept with the approval"
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
                    (mode === "approve" && text.trim() === "") ||
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
                    ? "Approve with this comment"
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

/**
 * What stands in the way of approval, as work: one row per place where something is
 * resolved, with what to do and a button that opens that place. What holds approval comes
 * first; what can be answered later folds beneath it.
 */
/** A client's own control whose RCM gives no test attributes: the standard it matches,
 * followed as a customized standard to take its attributes (proposed for the team to
 * decide; the client's own description stays). */
function StandardSuggestion({ ids, plan }: { ids: Ids; plan: MasterPlan }) {
  const action = useAction(ids);
  const standard = plan.suggestedStandard;
  if (standard === null) {
    return null;
  }
  const other = holdHref(ids, plan.controlId, "CONTROL");
  const attributes = holdHref(ids, plan.controlId, "ATTRIBUTES");
  const strong = standard.status === "STRONG";
  return (
    <section className="pl-suggest" aria-label="A matching standard">
      <div className="pl-suggest-text">
        <strong>
          The client's RCM gives no test attributes for this control
        </strong>
        {strong ? (
          <p>
            It matches the standard{" "}
            <span className="pl-ref">{standard.controlRef}</span>{" "}
            {standard.title}{" "}
            <span className="pl-suggest-fit">Strong match</span>. Following it
            as a customized standard brings its attributes, proposed for you to
            decide; the client's own description stays.
          </p>
        ) : (
          <p>
            No library standard clearly matches it (the closest,{" "}
            <span className="pl-ref">{standard.controlRef}</span>{" "}
            {standard.title}, is a partial match). Write the attributes this
            control is tested against, or choose a standard yourself.
          </p>
        )}
      </div>
      <div className="pl-suggest-actions">
        {strong ? (
          <button
            type="button"
            className="btn btn-sm"
            disabled={action.pending}
            onClick={() =>
              void action.run("use-standard", {
                intent: "use-standard",
                control_id: plan.controlId,
                library_key: standard.libraryKey,
              })
            }
          >
            {action.busy === "use-standard"
              ? "Bringing its attributes…"
              : "Use its attributes"}
          </button>
        ) : attributes !== null ? (
          <a className="btn btn-sm" href={attributes}>
            Write the attributes
          </a>
        ) : null}
        {other !== null ? (
          <a className="pl-flag-action" href={other}>
            {strong ? "Choose another standard" : "Choose a standard"}
            <UiIcon name="arrow" size={11} />
          </a>
        ) : null}
      </div>
      <Problem text={action.problem} />
    </section>
  );
}

/** Where each resolution is done when the plan holds the control's own editors. */
const IN_PLAN: Partial<Record<string, Tab>> = {
  ATTRIBUTES: "attributes",
  CONTROL: "understanding",
  VALUES: "understanding",
  PROCESS: "understanding",
};

function Holding({
  ids,
  plan,
  onDescribe,
  onUnderstanding,
  onOpen,
}: {
  ids: Ids;
  plan: MasterPlan;
  /** Opens the Describe dialog; absent for a viewer who cannot state facts. */
  onDescribe?: (() => void) | undefined;
  onUnderstanding: () => void;
  /** In the control's Plan step: opens the tab where it is resolved, which shows the
   * question in full, so it is not repeated here. */
  onOpen?: ((tab: Tab) => void) | undefined;
}) {
  const holds = approvalHolds(plan.blockers);
  if (holds.length === 0) {
    return null;
  }
  const row = (group: HoldGroup) => {
    const inPlan = onOpen === undefined ? undefined : IN_PLAN[group.resolve];
    const href =
      inPlan !== undefined
        ? null
        : holdHref(ids, plan.controlId, group.resolve, group.target);
    return (
      <li key={`${group.resolve}-${group.blocks}`} className="pl-hold">
        <span className="pl-hold-icon" aria-hidden="true">
          <UiIcon
            name={
              group.resolve === "WAIT"
                ? "clock"
                : group.blocks
                  ? "risk"
                  : "info"
            }
            size={14}
          />
        </span>
        <div className="pl-hold-text">
          <strong>{group.title}</strong>
          {inPlan === undefined ? (
            <ul>
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
        {inPlan !== undefined && onOpen !== undefined ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onOpen(inPlan)}
          >
            {group.action}
            <UiIcon name="arrow" size={13} />
          </button>
        ) : href !== null ? (
          <a className="btn btn-secondary btn-sm" href={href}>
            {group.action}
            <UiIcon name="arrow" size={13} />
          </a>
        ) : group.resolve === "FACTS" && onDescribe !== undefined ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-haspopup="dialog"
            onClick={onDescribe}
          >
            {group.action}
            <UiIcon name="arrow" size={13} />
          </button>
        ) : group.resolve === "UNDERSTANDING" ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onUnderstanding}
          >
            {group.action}
          </button>
        ) : group.resolve === "REVISION" ? (
          <span className="pl-hold-note">Use the buttons above</span>
        ) : null}
      </li>
    );
  };
  return (
    <aside className="pl-holding has-blockers" aria-label="Before approval">
      <p className="pl-holding-title">
        {holds.length === 1
          ? "1 thing to resolve before approval"
          : `${holds.length} things to resolve before approval`}
      </p>
      <ul className="pl-holds">{holds.map(row)}</ul>
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
      onClick={(event) => {
        // Inside an item's line, tracing does not open or close the item.
        event.preventDefault();
        onSelect(code);
      }}
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
  optional = false,
}: {
  label: string;
  codes: string[];
  onSelect: (code: string) => void;
  /** On an item's line, links it does not have are left out rather than read "none". */
  optional?: boolean;
}) {
  if (optional && codes.length === 0) {
    return null;
  }
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

/** A row's findings, each with what resolves it and, where the plan can do it, the
 * control that does: the row's links or criteria, planning the control again with the
 * rules, or the control's own record. */
function Flags({
  ids,
  plan,
  findings,
  onLinks,
  onCriteria,
  onSelect,
}: {
  ids: Ids;
  plan: MasterPlan;
  findings: Finding[] | undefined;
  onLinks?: (() => void) | undefined;
  onCriteria?: (() => void) | undefined;
  /** Opens an item of the plan by its code (and the tab that holds it). */
  onSelect?: ((code: string) => void) | undefined;
}) {
  const action = useAction(ids);
  if (findings === undefined || findings.length === 0) {
    return null;
  }
  const approved = plan.state === "APPROVED" && plan.status === "APPROVED";
  const control = (fix: FindingFix) => {
    switch (fix.action) {
      case "links":
        return onLinks === undefined ? null : (
          <button type="button" className="pl-flag-action" onClick={onLinks}>
            {fix.label}
          </button>
        );
      case "criteria":
        return onCriteria === undefined ? null : (
          <button type="button" className="pl-flag-action" onClick={onCriteria}>
            {fix.label}
          </button>
        );
      case "procedures":
      case "evidence": {
        // The first operating item, where an attribute's testing or evidence is linked.
        const items =
          fix.action === "procedures" ? plan.procedures : plan.evidence;
        const code = (
          items.find((item) => item.phase === "INTERIM") ?? items[0]
        )?.code;
        return code === undefined || onSelect === undefined ? null : (
          <button
            type="button"
            className="pl-flag-action"
            onClick={() => onSelect(code)}
          >
            {fix.label}
          </button>
        );
      }
      case "replan":
        return (
          <button
            type="button"
            className="pl-flag-action"
            disabled={action.pending}
            onClick={() =>
              void action.run("replan", {
                intent: "replan-control",
                control_id: plan.controlId,
              })
            }
          >
            {action.busy === "replan" ? "Planning again…" : fix.label}
          </button>
        );
      case "attributes":
      case "basis": {
        const href = holdHref(
          ids,
          plan.controlId,
          fix.action === "basis" ? "CONTROL" : "ATTRIBUTES",
        );
        return href === null ? null : (
          <a className="pl-flag-action" href={href}>
            {fix.label}
            <UiIcon name="arrow" size={11} />
          </a>
        );
      }
      default:
        return null;
    }
  };
  return (
    <ul className="pl-flags">
      {findings.map((item) => {
        const fix = findingFix(item.kind, approved);
        return (
          <li key={item.detail}>
            <UiIcon name="risk" size={12} />
            <span className="pl-flag-body">
              <span>{item.detail}</span>
              {fix.hint !== "" ? (
                <span className="pl-flag-fix">
                  {fix.hint}
                  {control(fix)}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
      {action.problem !== null ? (
        <li className="pl-flag-problem" role="alert">
          {action.problem}
        </li>
      ) : null}
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

/** The item being traced opens; the rest stay one line. */
function isFocused(className: string): boolean {
  return className.includes("is-selected");
}

/** An item in one line: its code, what it is, and what it links to. The code and the
 * links trace through the plan; anywhere else on the line opens the item. */
function RowSummary({
  code,
  title,
  onSelect,
  links,
  aside,
}: {
  code: string;
  title: ReactNode;
  onSelect: (code: string) => void;
  links?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <summary className="pl-row-head">
      <button
        type="button"
        className="pl-code"
        onClick={(event) => {
          // Tracing does not open or close the item.
          event.preventDefault();
          onSelect(code);
        }}
      >
        {code}
      </button>
      <span className="pl-row-title">{title}</span>
      {links !== undefined ? (
        <span className="pl-row-links">{links}</span>
      ) : null}
      {aside}
      <UiIcon name="chevron" size={14} />
    </summary>
  );
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

function UnderstandingTab({
  plan,
  sources,
  onSources,
  onAnswer,
  describe,
  workspace = null,
}: {
  plan: MasterPlan;
  sources: boolean;
  onSources: (value: boolean) => void;
  /** Opens the answer to a client value (its key); absent when the viewer cannot. */
  onAnswer?: ((key: string) => void) | undefined;
  /** The facts the team states for a client's own control, and opening the dialog. */
  describe?: Describing | undefined;
  /** In the control's Plan step: the control statement, edited in place, stands for its
   * description; process and documents sit under More about this control. */
  workspace?: PlanWorkspace | null;
}) {
  const answer =
    onAnswer === undefined
      ? undefined
      : { values: plan.openValues, open: onAnswer };
  const lead = LEAD_FACTS.map((field) => factOf(plan, field)).filter(
    (item): item is Fact => item !== undefined,
  );
  const paired = lead.filter(
    (item) => item.field === "OBJECTIVE" || item.field === "RISK",
  );
  const narrative = lead.filter(
    (item) =>
      item.field !== "OBJECTIVE" &&
      item.field !== "RISK" &&
      // The statement, edited in place, is the description.
      !(item.field === "DESCRIPTION" && workspace?.statement != null),
  );
  const rest = plan.facts.filter((item) => !LEAD_FACTS.includes(item.field));
  const notes = [...plan.assumptions, ...plan.exceptions];
  if (workspace?.statement != null) {
    // The control's Plan step (decided by the product owner on 26 October 2026): the
    // control understanding in one card (objective, risk, the design elements the plan
    // tests, the narrative), then the client-specific information.
    const elements = plan.attributes.map((item) => item.text).filter(Boolean);
    const icons: Record<string, { icon: IconName; tone: string }> = {
      OBJECTIVE: { icon: "shield", tone: "is-blue" },
      RISK: { icon: "risk", tone: "is-red" },
    };
    return (
      <div className="pl-understanding">
        <section className="pu-card" aria-labelledby="pu-title">
          <header className="pu-head">
            <h3 id="pu-title">Control understanding</h3>
            {describe !== undefined ? (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => describe.open("")}
              >
                <UiIcon name="compose" size={13} />
                Edit
              </button>
            ) : null}
          </header>
          <div className="pu-grid">
            {paired.map((fact) => (
              <div key={fact.field} className="pu-item">
                <span
                  className={`pu-icon ${icons[fact.field]?.tone ?? ""}`}
                  aria-hidden="true"
                >
                  <UiIcon name={icons[fact.field]?.icon ?? "info"} size={15} />
                </span>
                <dl className="pl-lead-facts">
                  <FactLine
                    fact={fact}
                    sources={false}
                    title={factTitle(fact.field, fact.label)}
                    answer={answer}
                    describe={describe}
                  />
                </dl>
              </div>
            ))}
            <div className="pu-item is-wide">
              <span className="pu-icon is-indigo" aria-hidden="true">
                <UiIcon name="table" size={15} />
              </span>
              <div>
                <h4>Key design elements</h4>
                {elements.length === 0 ? (
                  <p className="pu-none">The plan states none yet.</p>
                ) : (
                  <ul className="pu-elements">
                    {elements.slice(0, 5).map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                    {elements.length > 5 ? (
                      <li className="pu-more">
                        and {elements.length - 5} more in Attributes
                      </li>
                    ) : null}
                  </ul>
                )}
              </div>
            </div>
          </div>
          {narrative.length > 0 ? (
            <dl className="pl-lead-facts pu-rest">
              {narrative.map((fact) => (
                <FactLine
                  key={fact.field}
                  fact={fact}
                  sources={false}
                  title={factTitle(fact.field, fact.label)}
                  answer={answer}
                  describe={describe}
                />
              ))}
            </dl>
          ) : null}
        </section>
        <div className="pl-statement">{workspace.statement}</div>
        <MoreAbout
          plan={plan}
          rest={rest}
          notes={notes}
          sources={sources}
          onSources={onSources}
          answer={answer}
          describe={describe}
          workspace={workspace}
        />
      </div>
    );
  }
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
              answer={answer}
              describe={describe}
            />
          ))}
        </div>
        {workspace?.statement != null
          ? null
          : narrative.map((fact) => (
              <FactLine
                key={fact.field}
                fact={fact}
                sources={false}
                title={factTitle(fact.field, fact.label)}
                answer={answer}
                describe={describe}
              />
            ))}
      </dl>
      {workspace?.statement != null ? (
        <>
          {/* How the control operates first: the statement, edited in place; then what
              it relies on. */}
          <div className="pl-statement">{workspace.statement}</div>
          <dl className="pl-lead-facts">
            {narrative.map((fact) => (
              <FactLine
                key={fact.field}
                fact={fact}
                sources={false}
                title={factTitle(fact.field, fact.label)}
                answer={answer}
                describe={describe}
              />
            ))}
          </dl>
        </>
      ) : null}
      <MoreAbout
        plan={plan}
        rest={rest}
        notes={notes}
        sources={sources}
        onSources={onSources}
        answer={answer}
        describe={describe}
        workspace={workspace}
      />
    </div>
  );
}

/** The control's other facts, its process, documents and assumptions, folded away. */
function MoreAbout({
  plan: _plan,
  rest,
  notes,
  sources,
  onSources,
  answer,
  describe,
  workspace,
}: {
  plan: MasterPlan;
  rest: Fact[];
  notes: string[];
  sources: boolean;
  onSources: (value: boolean) => void;
  answer: Answering | undefined;
  describe: Describing | undefined;
  workspace: PlanWorkspace | null;
}) {
  return (
    <details className="pl-fold">
      <summary>More about this control</summary>
      <div className="pl-more">
        <div className="pl-more-bar">
          <h3>Control facts</h3>
          <button
            type="button"
            className="pl-sources-toggle"
            aria-pressed={sources}
            onClick={() => onSources(!sources)}
          >
            {sources ? "Hide sources" : "Show sources"}
          </button>
        </div>
        <dl className="pl-fact-grid">
          {rest.map((fact) => (
            <FactLine
              key={fact.field}
              fact={fact}
              sources={sources}
              title={factTitle(fact.field, fact.label)}
              answer={answer}
              describe={describe}
            />
          ))}
        </dl>
        {workspace?.classification ?? null}
        {notes.length > 0 ? (
          <div className="pl-assumptions">
            <h3>Assumptions</h3>
            <ul className="pl-notes">
              {notes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}

/** The control's own editors, placed inside the plan in the control's Plan step. */
export type PlanWorkspace = {
  /** The control statement with the client's values, edited in place. */
  statement: ReactNode | null;
  /** The attributes: the one editable list, with its open questions. */
  attributes: ReactNode;
  /** Opened when the control's attributes wait on a decision. */
  attributesOpen?: boolean;
  /** What the fold under the attribute table holds, as its heading. */
  attributesLabel?: string;
  /** The control's history, by day, for the plan's History tab. */
  history?: ReactNode;
  /** How many of the control's activities happened today. */
  activityToday?: number;
  /** The test basis the plan follows, and changing it. */
  basis: ReactNode;
  /** How the control is classified, edited under its facts. The process understanding
   * and the supporting documents are not repeated here: the process narrative and the
   * assistant's documents card hold them (product owner, 26 October 2026). */
  classification?: ReactNode;
};

/** The open client values a plan shows, and how to answer one; absent for a viewer who
 * cannot enter them. */
type Answering = { values: OpenValue[]; open: (key: string) => void };

/** The facts the team states for a client's own control: each missing or proposed one,
 * and how to open the Describe dialog at it. */
type Describing = {
  fields: Map<string, string>;
  open: (field: string) => void;
};

function Statement({
  text,
  answer,
}: {
  text: string;
  answer?: Answering | undefined;
}) {
  return (
    <>
      {statementParts(text).map((part) => {
        if (!part.placeholder) {
          return <span key={part.at}>{part.text}</span>;
        }
        const value =
          answer === undefined
            ? undefined
            : openValueFor(answer.values, part.text);
        return value === undefined || answer === undefined ? (
          <span key={part.at} className="pl-placeholder">
            {part.text.slice(1, -1)}
          </span>
        ) : (
          <button
            key={part.at}
            type="button"
            className="pl-placeholder is-answerable"
            title={value.question || `Answer: ${value.label}`}
            onClick={() => answer.open(value.key)}
          >
            {part.text.slice(1, -1)}
            <UiIcon name="compose" size={11} />
          </button>
        );
      })}
    </>
  );
}

function FactLine({
  fact,
  sources,
  title,
  answer,
  describe,
}: {
  fact: Fact;
  sources: boolean;
  title?: string;
  answer?: Answering | undefined;
  describe?: Describing | undefined;
}) {
  const told = describe?.fields.get(fact.field);
  const marked = fact.basis !== "" && fact.basis !== "SOURCE";
  const missing =
    answer === undefined ? undefined : missingValueOf(fact, answer.values);
  return (
    <div className={fact.basis === "MISSING" ? "is-missing" : undefined}>
      <dt>{title ?? fact.label}</dt>
      <dd>
        {fact.value === "" ? (
          <span className="pl-none">Not stated</span>
        ) : (
          <Statement text={fact.value} answer={answer} />
        )}
        {marked ? (
          <span className="pl-basis">
            {BASIS_LABELS[fact.basis] ?? fact.basis}
          </span>
        ) : null}
        {missing !== undefined && answer !== undefined ? (
          // The client's value it waits for, answered here.
          <span className="pl-question pl-question-answer">
            {missing.question || fact.question}
            <button
              type="button"
              className="pl-answer-link"
              onClick={() => answer.open(missing.key)}
            >
              Answer
              <UiIcon name="arrow" size={12} />
            </button>
          </span>
        ) : told !== undefined && describe !== undefined ? (
          // A fact the team states for a client's own control, in the Describe dialog.
          <span className="pl-question pl-question-answer">
            {fact.question}
            <button
              type="button"
              className="pl-answer-link"
              onClick={() => describe.open(fact.field)}
            >
              {told === "missing" ? "Answer" : "Confirm"}
              <UiIcon name="arrow" size={12} />
            </button>
          </span>
        ) : fact.question ? (
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

function ProceduresTab({
  ids,
  plan,
  selected,
  trace,
  onSelect,
  table = false,
  guidance = null,
}: TabProps & {
  /** The control's Plan step: one table (decided by the product owner). */
  table?: boolean;
  /** The test basis the procedures follow, opened by Procedure guidance. */
  guidance?: ReactNode;
}) {
  const flagged = findingsByCode(plan);
  if (table) {
    return (
      <ProcedureBoard
        ids={ids}
        plan={plan}
        selected={selected}
        trace={trace}
        onSelect={onSelect}
        guidance={guidance}
      />
    );
  }
  // Every phase on one page; a phase that does not apply is one line.
  return (
    <div className="pl-sections">
      {PHASES.map((phase) => {
        const mine = plan.procedures.filter((item) => item.phase === phase);
        const phaseRow = plan.phases.find((item) => item.phase === phase);
        const applies = phaseRow?.applicability !== "NOT_APPLICABLE";
        return (
          <section key={phase} className="pl-phase">
            <h3>
              {PHASE_LABELS[phase]}{" "}
              <span className="pl-sub">
                {applies
                  ? `${mine.length} ${mine.length === 1 ? "procedure" : "procedures"}`
                  : "Not applicable"}
              </span>
            </h3>
            {mine.length > 0 ? (
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
            ) : null}
            {applies ? (
              <AddProcedure ids={ids} plan={plan} phase={phase} />
            ) : null}
          </section>
        );
      })}
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
  findings: Finding[] | undefined;
  onSelect: (code: string) => void;
}) {
  const [mode, setMode] = useState<ProcedureMode>("none");
  const lead = procedureLead(item.text);
  return (
    <li id={`pl-item-${item.code}`} className={className}>
      <details
        className="pl-row"
        open={mode !== "none" || isFocused(className) ? true : undefined}
      >
        <RowSummary
          code={item.code}
          title={lead.title}
          onSelect={onSelect}
          links={
            <>
              {item.phase === "DESIGN" ? null : (
                <Chips
                  optional
                  label="Tests"
                  codes={item.attributeCodes}
                  onSelect={onSelect}
                />
              )}
              <Chips
                optional
                label="Evidence"
                codes={item.evidenceCodes}
                onSelect={onSelect}
              />
            </>
          }
        />
        <div className="pl-row-body">
          {lead.body !== "" ? <p className="pl-row-text">{lead.body}</p> : null}
          <p className="pl-row-meta">
            {item.method ? <span>{METHOD_LABELS[item.method]}</span> : null}
            <Mark origin={item.origin} personEdited={item.personEdited} />
            {item.standardKey !== "" && plan.control.libraryKey !== "" ? (
              <a
                className="pl-standard-steps"
                href={standardStepsHref(
                  ids.organizationId,
                  ids.projectId,
                  plan.control.libraryKey,
                  item.standardKey,
                )}
              >
                View the standard's steps
              </a>
            ) : null}
          </p>
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
          <ProcedureForms
            ids={ids}
            plan={plan}
            item={item}
            mode={mode}
            onDone={() => setMode("none")}
          />
        </div>
      </details>
      <Flags
        ids={ids}
        plan={plan}
        findings={findings}
        onLinks={() => setMode("links")}
      />
    </li>
  );
}

type ProcedureMode = "none" | "edit" | "links" | "remove";

/** A procedure's edit, attribute links and removal (with its reason), in the list and
 * in the table alike. */
function ProcedureForms({
  ids,
  plan,
  item,
  mode,
  onDone,
}: {
  ids: Ids;
  plan: MasterPlan;
  item: Procedure;
  mode: ProcedureMode;
  onDone: () => void;
}) {
  const action = useAction(ids);
  const [text, setText] = useState(item.text);
  const [method, setMethod] = useState(item.method ?? "");
  const [reason, setReason] = useState("");
  const [links, setLinks] = useState<Set<string>>(new Set(item.attributeIds));
  const fields = { control_id: plan.controlId, procedure_id: item.id };
  const setMode = (next: ProcedureMode) => {
    if (next === "none") {
      onDone();
    }
  };
  const done = (result: { ok: boolean }) => {
    if (result.ok) {
      onDone();
    }
  };
  return (
    <>
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
    </>
  );
}

/**
 * The procedures as one table (decided by the product owner on 26 October 2026, from the
 * control workspace reference): each with its method, phase, what it tests and needs,
 * where it came from and whether a finding waits on it; Review opens it in place with its
 * findings and its edit, links and removal.
 */
function ProceduresTable({
  ids,
  plan,
  selected,
  trace,
  onSelect,
  guidance,
  phase,
  bare = false,
}: TabProps & {
  guidance: ReactNode;
  /** One phase's procedures, numbered within it (the board's Compact view). */
  phase?: Phase;
  /** The table alone, without the card's header and footer. */
  bare?: boolean;
}) {
  const flagged = findingsByCode(plan);
  const rows = procedureRows(plan)
    .filter(
      (row) =>
        phase === undefined ||
        plan.procedures.find((item) => item.id === row.id)?.phase === phase,
    )
    .map((row, index) =>
      phase === undefined ? row : { ...row, number: index + 1 },
    );
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [modes, setModes] = useState<Record<string, ProcedureMode>>({});
  const [showGuidance, setShowGuidance] = useState(false);
  const all = rows.length > 0 && rows.every((row) => open.has(row.id));
  const toggle = (id: string, value?: boolean) =>
    setOpen((now) => {
      const next = new Set(now);
      if (value ?? !next.has(id)) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  const mode = (id: string) => modes[id] ?? "none";
  const setMode = (id: string, next: ProcedureMode) => {
    setModes((now) => ({ ...now, [id]: next }));
    if (next !== "none") {
      toggle(id, true);
    }
  };
  const applicable = PHASES.filter(
    (phase) =>
      plan.phases.find((item) => item.phase === phase)?.applicability !==
      "NOT_APPLICABLE",
  );
  const notApplicable = PHASES.filter((phase) => !applicable.includes(phase));
  const tableView =
    rows.length === 0 ? (
      <p className="pl-quiet">The plan has no procedure yet.</p>
    ) : (
      <div className="pp-scroll">
        <table className="pp-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Procedure</th>
              <th scope="col">Type</th>
              <th scope="col">Phase</th>
              <th scope="col">Attributes</th>
              <th scope="col">Evidence</th>
              <th scope="col">Source</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const item = plan.procedures.find((entry) => entry.id === row.id);
              if (item === undefined) {
                return null;
              }
              const isOpen = open.has(row.id);
              return (
                <Fragment key={row.id}>
                  <tr
                    id={`pl-item-${row.code}`}
                    className={`pp-row${selected === row.code ? " is-selected" : ""}${trace.has(row.code) ? " is-related" : ""}${isOpen ? " is-open" : ""}`}
                  >
                    <td className="pp-num">{row.number}</td>
                    <td className="pp-text">
                      <strong>{row.title}</strong>
                      {row.body !== "" ? <small>{row.body}</small> : null}
                    </td>
                    <td>
                      {row.method !== "" ? (
                        <span
                          className={`pp-pill is-${row.method.toLowerCase()}`}
                        >
                          {row.method}
                        </span>
                      ) : (
                        <span className="pl-quiet">—</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`pp-pill is-phase is-${item.phase.toLowerCase()}`}
                      >
                        {row.phase}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="pp-count"
                        title={`Attributes it tests: ${item.attributeCodes.join(", ") || "none"}`}
                        onClick={() => setMode(row.id, "links")}
                        disabled={item.phase === "DESIGN"}
                      >
                        <UiIcon name="file" size={13} />
                        {row.attributes}
                      </button>
                    </td>
                    <td>
                      <span
                        className="pp-count"
                        title={`Evidence it needs: ${item.evidenceCodes.join(", ") || "none"}`}
                      >
                        <UiIcon name="table" size={13} />
                        {row.evidence}
                      </span>
                    </td>
                    <td className="pp-source">{row.source}</td>
                    <td>
                      <span
                        className={`pp-status ${row.status === "READY" ? "is-ready" : "is-review"}`}
                      >
                        {row.status === "READY" ? "Ready" : "Needs review"}
                      </span>
                    </td>
                    <td className="pp-actions">
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        aria-expanded={isOpen}
                        onClick={() => toggle(row.id)}
                      >
                        {isOpen ? "Close" : "Review"}
                      </button>
                      <ProcedureMenu
                        label={`More for procedure ${row.number}`}
                        items={[
                          {
                            text: "Edit",
                            run: () => setMode(row.id, "edit"),
                          },
                          ...(item.phase === "DESIGN"
                            ? []
                            : [
                                {
                                  text: "Link attributes",
                                  run: () => setMode(row.id, "links"),
                                },
                              ]),
                          {
                            text: "Trace in the plan",
                            run: () => onSelect(row.code),
                          },
                          {
                            text: "Remove",
                            run: () => setMode(row.id, "remove"),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="pp-detail">
                      <td />
                      <td colSpan={8}>
                        <div className="pp-detail-body">
                          <p className="pl-row-meta">
                            <span className="pl-ref">{row.code}</span>
                            <Mark
                              origin={item.origin}
                              personEdited={item.personEdited}
                            />
                            {item.standardKey !== "" &&
                            plan.control.libraryKey !== "" ? (
                              <a
                                className="pl-standard-steps"
                                href={standardStepsHref(
                                  ids.organizationId,
                                  ids.projectId,
                                  plan.control.libraryKey,
                                  item.standardKey,
                                )}
                              >
                                View the standard's steps
                              </a>
                            ) : null}
                          </p>
                          <p className="pl-row-links">
                            {item.phase === "DESIGN" ? null : (
                              <Chips
                                optional
                                label="Tests"
                                codes={item.attributeCodes}
                                onSelect={onSelect}
                              />
                            )}
                            <Chips
                              optional
                              label="Evidence"
                              codes={item.evidenceCodes}
                              onSelect={onSelect}
                            />
                          </p>
                          <Flags
                            ids={ids}
                            plan={plan}
                            findings={flagged.get(row.code)}
                            onLinks={() => setMode(row.id, "links")}
                          />
                          <span className="pl-item-actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() =>
                                setMode(
                                  row.id,
                                  mode(row.id) === "edit" ? "none" : "edit",
                                )
                              }
                            >
                              Edit
                            </button>
                            {item.phase === "DESIGN" ? null : (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() =>
                                  setMode(
                                    row.id,
                                    mode(row.id) === "links" ? "none" : "links",
                                  )
                                }
                              >
                                Attributes
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() =>
                                setMode(
                                  row.id,
                                  mode(row.id) === "remove" ? "none" : "remove",
                                )
                              }
                            >
                              Remove
                            </button>
                          </span>
                          <ProcedureForms
                            ids={ids}
                            plan={plan}
                            item={item}
                            mode={mode(row.id)}
                            onDone={() => setMode(row.id, "none")}
                          />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  if (bare) {
    return tableView;
  }
  return (
    <section className="pp-card" aria-labelledby="pp-title">
      <header className="pp-head">
        <div>
          <h3 id="pp-title">
            Procedures <span>({rows.length})</span>
          </h3>
          <p>
            Audit procedures to test the design and operating effectiveness of
            this control.
          </p>
        </div>
        <div className="pp-head-actions">
          {guidance !== null ? (
            <button
              type="button"
              className="btn-secondary"
              aria-expanded={showGuidance}
              onClick={() => setShowGuidance(!showGuidance)}
            >
              <UiIcon name="file" size={14} />
              Procedure guidance
            </button>
          ) : null}
          {rows.length > 0 ? (
            <button
              type="button"
              className="btn"
              onClick={() =>
                setOpen(all ? new Set() : new Set(rows.map((row) => row.id)))
              }
            >
              <UiIcon name="file" size={14} />
              {all ? "Close all procedures" : "Review all procedures"}
            </button>
          ) : null}
        </div>
      </header>
      {showGuidance && guidance !== null ? (
        <div className="pp-guidance">{guidance}</div>
      ) : null}
      {tableView}
      <footer className="pp-foot">
        {notApplicable.length > 0 ? (
          <p className="pl-quiet">
            Not applicable:{" "}
            {notApplicable.map((phase) => PHASE_LABELS[phase]).join(", ")}.
          </p>
        ) : null}
        {applicable.length > 0 ? (
          <AddProcedure ids={ids} plan={plan} phases={applicable} />
        ) : null}
      </footer>
    </section>
  );
}

/**
 * The control's procedures as the product owner's reference shows them (27 October
 * 2026): a header with where they came from, a coverage panel with one tile per phase,
 * then the chosen phase's procedures as numbered cards that open to their overview and
 * actions, or as the compact table.
 */
function ProcedureBoard({
  ids,
  plan,
  selected,
  trace,
  onSelect,
  guidance,
}: TabProps & { guidance: ReactNode }) {
  const coverage = procedureCoverage(plan);
  const flagged = findingsByCode(plan);
  const rows = procedureRows(plan);
  const [phase, setPhase] = useState<Phase>(coverage.first);
  const [view, setView] = useState<"cards" | "compact">("cards");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [modes, setModes] = useState<Record<string, ProcedureMode>>({});
  const [showGuidance, setShowGuidance] = useState(false);
  const mine = plan.procedures.filter((item) => item.phase === phase);
  const all = mine.length > 0 && mine.every((item) => open.has(item.id));
  const toggle = (id: string, value?: boolean) =>
    setOpen((now) => {
      const next = new Set(now);
      if (value ?? !next.has(id)) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  const mode = (id: string) => modes[id] ?? "none";
  const setMode = (id: string, next: ProcedureMode) => {
    setModes((now) => ({ ...now, [id]: next }));
    if (next !== "none") {
      toggle(id, true);
    }
  };
  // A procedure traced from elsewhere in the plan opens in its phase.
  useEffect(() => {
    const traced = plan.procedures.find((item) => item.code === selected);
    if (traced !== undefined) {
      setPhase(traced.phase);
      setOpen((now) => new Set(now).add(traced.id));
    }
  }, [selected, plan.procedures]);
  const current = coverage.phases.find((item) => item.phase === phase);
  return (
    <section className="pb" aria-labelledby="pb-title">
      <header className="pb-head">
        <div>
          <h3 id="pb-title">Test procedures</h3>
          <p>
            {coverage.total} {coverage.total === 1 ? "procedure" : "procedures"}{" "}
            across {coverage.phasesUsed}{" "}
            {coverage.phasesUsed === 1 ? "testing phase" : "testing phases"}
          </p>
        </div>
        <div className="pb-head-actions">
          {coverage.source !== "" ? (
            <span className="pb-source">{coverage.source}</span>
          ) : null}
          {guidance !== null ? (
            <button
              type="button"
              className="btn-secondary btn-sm"
              aria-expanded={showGuidance}
              onClick={() => setShowGuidance(!showGuidance)}
            >
              <UiIcon name="file" size={13} />
              Procedure guidance
            </button>
          ) : null}
          {mine.length > 0 ? (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setView("cards");
                setOpen(all ? new Set() : new Set(mine.map((item) => item.id)));
              }}
            >
              {all ? "Close procedures" : "Review procedures"}
            </button>
          ) : null}
        </div>
      </header>
      {showGuidance && guidance !== null ? (
        <div className="pp-guidance">{guidance}</div>
      ) : null}
      <div className="pb-coverage">
        <div className="pb-coverage-head">
          <h4>Procedure coverage</h4>
          <span className="pb-ready">
            {coverage.review > 0
              ? `${coverage.ready} ready · ${coverage.review} to review`
              : `${coverage.ready} ready for review`}
          </span>
        </div>
        <div className="pb-tiles" role="tablist" aria-label="Testing phases">
          {coverage.phases.map((item) => (
            <button
              key={item.phase}
              type="button"
              role="tab"
              aria-selected={item.phase === phase}
              className={`pb-tile${item.phase === phase ? " is-on" : ""}${item.applies ? "" : " is-na"}`}
              onClick={() => setPhase(item.phase)}
            >
              <span className="pb-tile-label">{item.short}</span>
              <strong>{item.applies ? item.count : "—"}</strong>
              <small>
                {item.applies
                  ? item.count === 1
                    ? "procedure"
                    : "procedures"
                  : "Not applicable"}
              </small>
            </button>
          ))}
        </div>
      </div>
      <div className="pb-phase" role="tabpanel">
        <div className="pb-phase-head">
          <h4>
            <UiIcon name="layers" size={18} />
            {PHASE_LABELS[phase]}
            <span className="pb-count">{mine.length}</span>
          </h4>
          {mine.length > 0 ? (
            <fieldset className="pb-views">
              <legend className="sr-only">View</legend>
              {(["cards", "compact"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  className={view === key ? "is-on" : undefined}
                  onClick={() => setView(key)}
                >
                  {key === "cards" ? "Cards" : "Compact"}
                </button>
              ))}
            </fieldset>
          ) : null}
        </div>
        <p className="pb-purpose">
          {current?.applies === false
            ? "This phase does not apply to the control."
            : PHASE_PURPOSE[phase]}
        </p>
        {mine.length === 0 ? (
          current?.applies === false ? null : (
            <p className="pl-quiet">No procedure in this phase yet.</p>
          )
        ) : view === "compact" ? (
          <ProceduresTable
            ids={ids}
            plan={plan}
            selected={selected}
            trace={trace}
            onSelect={onSelect}
            guidance={null}
            phase={phase}
            bare
          />
        ) : (
          <ol className="pb-cards">
            {mine.map((item, index) => {
              const row = rows.find((entry) => entry.id === item.id);
              if (row === undefined) {
                return null;
              }
              return (
                <ProcedureCard
                  key={item.id}
                  ids={ids}
                  plan={plan}
                  item={item}
                  row={row}
                  number={index + 1}
                  open={open.has(item.id)}
                  related={selected === row.code || trace.has(row.code)}
                  onToggle={() => toggle(item.id)}
                  mode={mode(item.id)}
                  onMode={(next) => setMode(item.id, next)}
                  findings={flagged.get(row.code)}
                  onSelect={onSelect}
                />
              );
            })}
          </ol>
        )}
        {current?.applies === false ? null : (
          <AddProcedure ids={ids} plan={plan} phase={phase} key={phase} />
        )}
      </div>
    </section>
  );
}

/** One procedure as a card: its number and title, opening to its phase, status and
 * source, its overview with the attributes it tests and the evidence it needs, its
 * findings, and its actions. */
function ProcedureCard({
  ids,
  plan,
  item,
  row,
  number,
  open,
  related,
  onToggle,
  mode,
  onMode,
  findings,
  onSelect,
}: {
  ids: Ids;
  plan: MasterPlan;
  item: Procedure;
  row: ProcedureRow;
  number: number;
  open: boolean;
  related: boolean;
  onToggle: () => void;
  mode: ProcedureMode;
  onMode: (next: ProcedureMode) => void;
  findings: Finding[] | undefined;
  onSelect: (code: string) => void;
}) {
  const flip = (next: ProcedureMode) => onMode(mode === next ? "none" : next);
  return (
    <li
      id={`pl-item-${row.code}`}
      className={`pb-card${open ? " is-open" : ""}${related ? " is-related" : ""}`}
    >
      <button
        type="button"
        className="pb-card-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="pb-num">{String(number).padStart(2, "0")}</span>
        <span className="pb-card-title">{row.title}</span>
        {row.status === "NEEDS_REVIEW" && !open ? (
          <span className="pp-status is-review">Needs review</span>
        ) : null}
        <UiIcon name="chevron" size={15} />
      </button>
      {open ? (
        <div className="pb-card-body">
          <p className="pb-pills">
            <span className={`pp-pill is-phase is-${item.phase.toLowerCase()}`}>
              {row.phase}
            </span>
            <span
              className={`pp-status ${row.status === "READY" ? "is-ready" : "is-review"}`}
            >
              {row.status === "READY" ? "Ready for review" : "Needs review"}
            </span>
            <Mark origin={item.origin} personEdited={item.personEdited} />
            {row.method !== "" ? (
              <span className={`pp-pill is-${row.method.toLowerCase()}`}>
                {row.method}
              </span>
            ) : null}
          </p>
          {row.body !== "" ||
          item.evidenceCodes.length > 0 ||
          (item.phase !== "DESIGN" && item.attributeCodes.length > 0) ||
          (item.standardKey !== "" && plan.control.libraryKey !== "") ? (
            <div className="pb-overview">
              <h5>Procedure overview</h5>
              {row.body !== "" ? <p>{row.body}</p> : null}
              <p className="pl-row-links">
                {item.phase === "DESIGN" ? null : (
                  <Chips
                    optional
                    label="Tests"
                    codes={item.attributeCodes}
                    onSelect={onSelect}
                  />
                )}
                <Chips
                  optional
                  label="Evidence"
                  codes={item.evidenceCodes}
                  onSelect={onSelect}
                />
              </p>
              {item.standardKey !== "" && plan.control.libraryKey !== "" ? (
                <a
                  className="pl-standard-steps"
                  href={standardStepsHref(
                    ids.organizationId,
                    ids.projectId,
                    plan.control.libraryKey,
                    item.standardKey,
                  )}
                >
                  View the standard's steps
                </a>
              ) : null}
            </div>
          ) : null}
          <Flags
            ids={ids}
            plan={plan}
            findings={findings}
            onLinks={() => onMode("links")}
          />
          <span className="pb-actions">
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => flip("edit")}
            >
              <UiIcon name="compose" size={13} />
              Edit
            </button>
            {item.phase === "DESIGN" ? null : (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => flip("links")}
              >
                Link attributes
              </button>
            )}
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => flip("remove")}
            >
              Remove
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm pb-trace"
              onClick={() => onSelect(row.code)}
            >
              Trace in the plan
              <UiIcon name="arrow" size={13} />
            </button>
          </span>
          <ProcedureForms
            ids={ids}
            plan={plan}
            item={item}
            mode={mode}
            onDone={() => onMode("none")}
          />
        </div>
      ) : null}
    </li>
  );
}

/** A procedure's other actions, in a small menu beside Review. */
function ProcedureMenu({
  label,
  items,
}: {
  label: string;
  items: Array<{ text: string; run: () => void }>;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !root.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <span className="pp-menu" ref={root}>
      <button
        type="button"
        className="pp-menu-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <UiIcon name="more" size={15} />
      </button>
      {open ? (
        <span className="pp-menu-panel" role="menu">
          {items.map((item) => (
            <button
              key={item.text}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.run();
              }}
            >
              {item.text}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function AddProcedure({
  ids,
  plan,
  phase: only,
  phases,
}: {
  ids: Ids;
  plan: MasterPlan;
  phase?: Phase;
  /** In the table: the phases a procedure can be added to, chosen in the form. */
  phases?: readonly Phase[];
}) {
  const action = useAction(ids);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>(only ?? phases?.[0] ?? "INTERIM");
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
      {only === undefined && (phases?.length ?? 0) > 1 ? (
        <label>
          Phase
          <select
            value={phase}
            onChange={(event) => setPhase(event.target.value as Phase)}
          >
            {(phases ?? []).map((value) => (
              <option key={value} value={value}>
                {PHASE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
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

/** A person's own evidence item for the plan: what the client provides, and what it shows
 * (product owner, 26 October 2026). */
export function AddEvidence({
  ids,
  plan,
  phase: shown,
  onDone,
}: {
  ids: Ids;
  plan: MasterPlan;
  /** The phase the board shows, chosen first when the plan has evidence there. */
  phase?: Phase;
  onDone: () => void;
}) {
  const action = useAction(ids);
  const phases = PHASES.filter((value) =>
    plan.evidence.some((item) => item.phase === value),
  );
  const [phase, setPhase] = useState<string>(
    shown !== undefined && phases.includes(shown)
      ? shown
      : (phases[0] ?? "INTERIM"),
  );
  const [type, setType] = useState<string>("CONTROL_EXECUTION");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [shows, setShows] = useState("");
  const [required, setRequired] = useState(true);
  const ready =
    title.trim().length >= 3 &&
    description.trim().length >= 10 &&
    shows.trim().length >= 10;
  return (
    <div className="pl-edit pe-add" aria-busy={action.pending}>
      <div className="pe-add-row">
        <label>
          Phase
          <select
            value={phase}
            onChange={(event) => setPhase(event.target.value)}
          >
            {(phases.length > 0 ? phases : PHASES).map((value) => (
              <option key={value} value={value}>
                {PHASE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            {ADDABLE_TYPES.map((value) => (
              <option key={value} value={value}>
                {EVIDENCE_TYPE_LABELS[value] ?? value}
              </option>
            ))}
          </select>
        </label>
        <label className="pe-add-check">
          <input
            type="checkbox"
            checked={required}
            onChange={(event) => setRequired(event.target.checked)}
          />
          Required
        </label>
      </div>
      <label>
        Evidence item
        <input
          type="text"
          maxLength={200}
          value={title}
          placeholder="For example: Approved access request for each sampled user"
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        What the client provides
        <textarea
          rows={3}
          maxLength={1500}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label>
        What it shows
        <textarea
          rows={2}
          maxLength={500}
          value={shows}
          placeholder="For example: The access was approved before it was granted."
          onChange={(event) => setShows(event.target.value)}
        />
      </label>
      <EditButtons
        busy={action.pending}
        disabled={!ready}
        save="Add evidence"
        onCancel={onDone}
        onSave={async () => {
          const result = await action.run("add", {
            intent: "evidence-add",
            control_id: plan.controlId,
            phase,
            category: type,
            title,
            description,
            objective: shows,
            necessity: required ? "REQUIRED" : "OPTIONAL",
          });
          if (result.ok) {
            onDone();
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
  note = "Saving revises the plan; an approved plan goes back for review.",
}: {
  busy: boolean;
  disabled?: boolean;
  save: string;
  onSave: () => void;
  onCancel: () => void;
  /** What saving does to the plan; null where it changes nothing in it. */
  note?: string | null;
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
      {note === null ? null : <span className="pl-sub">{note}</span>}
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
  findings: Finding[] | undefined;
  onSelect: (code: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <li id={`pl-item-${item.code}`} className={className}>
      <details
        className="pl-row"
        open={editing || isFocused(className) ? true : undefined}
      >
        <RowSummary
          code={item.code}
          title={item.text}
          onSelect={onSelect}
          links={
            <>
              <Chips
                optional
                label="Tested by"
                codes={item.procedureCodes}
                onSelect={onSelect}
              />
              <Chips
                optional
                label="Evidence"
                codes={item.evidenceCodes}
                onSelect={onSelect}
              />
            </>
          }
          aside={
            item.basis === "DOCUMENTED" ? null : (
              <span className="pill tone-warning">Inferred</span>
            )
          }
        />
        <div className="pl-row-body">
          <AttributeCriteria
            ids={ids}
            plan={plan}
            item={item}
            editing={editing}
            onEditing={setEditing}
          />
        </div>
      </details>
      <Flags
        ids={ids}
        plan={plan}
        findings={findings}
        onCriteria={() => setEditing(true)}
        onSelect={onSelect}
      />
    </li>
  );
}

/** An attribute's criteria (passes, fails, what it addresses, the condition, judgment,
 * automation, where the criteria came from) and their edit, in the list and the table. */
function AttributeCriteria({
  ids,
  plan,
  item,
  editing,
  onEditing,
}: {
  ids: Ids;
  plan: MasterPlan;
  item: Attribute;
  editing: boolean;
  onEditing: (value: boolean) => void;
}) {
  const action = useAction(ids);
  const setEditing = onEditing;
  // The agent's criteria are accepted as they read (0122) until the plan is approved,
  // which confirms them with it.
  const acceptable = criteriaToAccept(plan).includes(item);
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
    <>
      {item.criteriaSource === "NONE" &&
      item.judgmentRequired === null &&
      item.automatable === null ? (
        <p className="pl-sub pl-nocriteria">
          No criteria stated yet.
          {item.objective ? ` Addresses: ${item.objective}` : ""}
        </p>
      ) : null}
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
        {item.objective ? (
          <div className="pl-criteria-wide">
            <dt>Addresses</dt>
            <dd>{item.objective}</dd>
          </div>
        ) : null}
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
            {item.criteriaAcceptedAt !== "" ? (
              <span className="pl-accepted">
                <UiIcon name="check" size={11} />
                Accepted by {item.criteriaAcceptedBy || "a person"} on{" "}
                {formatDate(item.criteriaAcceptedAt)}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
      <span className="pl-item-actions">
        {acceptable ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={action.pending || editing}
            onClick={() =>
              void action.run("accept", {
                intent: "criteria-accept",
                control_id: plan.controlId,
                attributes: [{ id: item.id, version: item.version }],
              })
            }
          >
            <UiIcon name="check" size={13} />
            {action.busy === "accept" ? "Accepting…" : "Accept criteria"}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setEditing(!editing)}
        >
          Edit criteria
        </button>
      </span>
      {!editing && action.busy === "" ? (
        <Problem text={action.problem} />
      ) : null}
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
    </>
  );
}

const ATTRIBUTE_STATUS: Record<
  AttributeRow["status"],
  { label: string; tone: string; title: string }
> = {
  CONFIRMED: {
    label: "Confirmed",
    tone: "is-ready",
    title:
      "Its criteria are the firm's library definition or a person's, or a person accepted or approved the planner agent's.",
  },
  NEEDS_REVIEW: {
    label: "Needs review",
    tone: "is-review",
    title:
      "A finding is raised on it, the planner agent proposed criteria no one has accepted yet, or its basis is inferred.",
  },
  NOT_STARTED: {
    label: "Not started",
    tone: "is-idle",
    title: "No criteria are stated for it yet.",
  },
};

/** Codes as chips that trace them in the plan, the first few with the rest counted. */
function CodeList({
  codes,
  onSelect,
  limit = 3,
}: {
  codes: string[];
  onSelect: (code: string) => void;
  limit?: number;
}) {
  if (codes.length === 0) {
    return <span className="pl-quiet">—</span>;
  }
  return (
    <span className="pa-codes">
      {codes.slice(0, limit).map((code) => (
        <button
          key={code}
          type="button"
          className="pa-code"
          title={`Trace ${code} in the plan`}
          onClick={() => onSelect(code)}
        >
          {code}
        </button>
      ))}
      {codes.length > limit ? (
        <span className="pa-more" title={codes.slice(limit).join(", ")}>
          +{codes.length - limit}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The attributes as one table (decided by the product owner on 26 October 2026, from the
 * control workspace reference): what each requires, the result expected, the procedures
 * and evidence that test it, where it came from and where its criteria stand; Review opens
 * its criteria and findings in place. The control's own attributes are edited below it.
 */
function AttributesTable({
  ids,
  plan,
  selected,
  trace,
  onSelect,
  guidance,
  editor,
  editorOpen,
  editorLabel,
}: TabProps & {
  guidance: ReactNode;
  editor: ReactNode;
  editorOpen: boolean;
  editorLabel: string;
}) {
  const flagged = findingsByCode(plan);
  const rows = attributeRows(plan);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Set<string>>(new Set());
  // Users add, reword and remove the control's attributes here (product owner, 26 October
  // 2026), through the control's own attribute record.
  const change = useContextAction({
    organizationId: ids.organizationId,
    projectId: ids.projectId,
    controlId: plan.controlId,
  });
  const [adding, setAdding] = useState<string | null>(null);
  const [wording, setWording] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [removing, setRemoving] = useState<string | null>(null);
  const [showGuidance, setShowGuidance] = useState(false);
  // The agent's criteria still to confirm are named under the title and accepted together,
  // after they are opened to read (decided by the product owner, 27 October 2026); the
  // result is the server's. The title's line keeps its own actions.
  const toAccept = criteriaToAccept(plan);
  const accepting = useAction(ids);
  const [confirming, setConfirming] = useState(false);
  const [accepted, setAccepted] = useState<string[]>([]);
  const codesOf = (codes: string[]) =>
    codes.length === 1
      ? codes[0]
      : `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}`;
  const all = rows.length > 0 && rows.every((row) => open.has(row.id));
  const flip = (
    set: (update: (now: Set<string>) => Set<string>) => void,
    id: string,
    value?: boolean,
  ) =>
    set((now) => {
      const next = new Set(now);
      if (value ?? !next.has(id)) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  const edit = (id: string, value: boolean) => {
    flip(setEditing, id, value);
    if (value) {
      flip(setOpen, id, true);
    }
  };
  return (
    <section className="pp-card" aria-labelledby="pa-title">
      <header className="pp-head">
        <div>
          <h3 id="pa-title">
            Attributes <span>({rows.length})</span>
          </h3>
          <p>
            Control attributes and the results expected for this control to
            operate effectively.
          </p>
        </div>
        <div className="pp-head-actions">
          <button
            type="button"
            className="btn-secondary"
            aria-expanded={adding !== null}
            onClick={() => setAdding(adding === null ? "" : null)}
          >
            <UiIcon name="plus" size={14} />
            Add attribute
          </button>
          {guidance !== null ? (
            <button
              type="button"
              className="btn-secondary"
              aria-expanded={showGuidance}
              onClick={() => setShowGuidance(!showGuidance)}
            >
              <UiIcon name="file" size={14} />
              Attribute guidance
            </button>
          ) : null}
          {rows.length > 0 ? (
            <button
              type="button"
              className="btn"
              onClick={() =>
                setOpen(all ? new Set() : new Set(rows.map((row) => row.id)))
              }
            >
              <UiIcon name="file" size={14} />
              {all ? "Close all attributes" : "Review all attributes"}
            </button>
          ) : null}
        </div>
      </header>
      {showGuidance && guidance !== null ? (
        <div className="pp-guidance">{guidance}</div>
      ) : null}
      {toAccept.length > 0 && !confirming ? (
        <div className="pa-accept is-notice">
          <p>
            <UiIcon name="sparkles" size={13} />
            The planner agent proposed the criteria for{" "}
            {codesOf(toAccept.map((item) => item.code))}; no one has accepted
            them yet.
          </p>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              setAccepted([]);
              setConfirming(true);
              setOpen(
                (now) => new Set([...now, ...toAccept.map((item) => item.id)]),
              );
            }}
          >
            Review and accept
          </button>
        </div>
      ) : null}
      {confirming && toAccept.length > 0 ? (
        <div className="pl-edit pa-add pa-accept" aria-busy={accepting.pending}>
          <p>
            The planner agent's criteria for{" "}
            {codesOf(toAccept.map((item) => item.code))} are open below.
            Accepting them records your name and the time; the wording does not
            change and the plan is not revised.
          </p>
          <EditButtons
            busy={accepting.pending}
            save={
              accepting.busy === "accept-all"
                ? "Accepting…"
                : `Accept ${toAccept.length === 1 ? "the criteria" : `all ${toAccept.length}`}`
            }
            note={null}
            onCancel={() => setConfirming(false)}
            onSave={async () => {
              const codes = toAccept.map((item) => item.code);
              const result = await accepting.run("accept-all", {
                intent: "criteria-accept",
                control_id: plan.controlId,
                attributes: toAccept.map((item) => ({
                  id: item.id,
                  version: item.version,
                })),
              });
              if (result.ok) {
                setConfirming(false);
                setAccepted(codes);
              }
            }}
          />
          <Problem text={accepting.problem} />
        </div>
      ) : null}
      {accepted.length > 0 && !accepting.pending ? (
        <p className="pa-accepted" role="status">
          <UiIcon name="check" size={13} />
          Criteria accepted for {codesOf(accepted)}.
        </p>
      ) : null}
      {adding !== null ? (
        <div className="pl-edit pa-add" aria-busy={change.pending}>
          <label>
            The condition the tester checks for each sample
            <textarea
              rows={2}
              maxLength={300}
              value={adding}
              placeholder="For example: The access was approved by the user's manager before it was granted."
              onChange={(event) => setAdding(event.target.value)}
            />
          </label>
          <EditButtons
            busy={change.pending}
            disabled={adding.trim().length < 3}
            save="Add attribute"
            onCancel={() => setAdding(null)}
            onSave={async () => {
              if (
                await change.run("add", {
                  intent: "attribute-add",
                  text: adding.trim(),
                })
              ) {
                setAdding(null);
              }
            }}
          />
        </div>
      ) : null}
      {removing !== null ? (
        <p className="pe-removed" role="alertdialog">
          <span>
            Remove attribute{" "}
            {rows.find((row) => row.id === removing)?.number ?? ""} from the
            plan? It is kept on record as retired.
          </span>
          <span className="pa-confirm">
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setRemoving(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-sm"
              disabled={change.pending}
              onClick={async () => {
                const item = plan.attributes.find(
                  (entry) => entry.id === removing,
                );
                if (
                  item !== undefined &&
                  (await change.run("retire", {
                    intent: "attribute-retire",
                    attribute_id: item.id,
                    version: item.version,
                  }))
                ) {
                  setRemoving(null);
                }
              }}
            >
              Remove
            </button>
          </span>
        </p>
      ) : null}
      {change.problem !== null ? (
        <p className="form-error" role="alert">
          {change.problem}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="pl-quiet">The control has no approved attributes yet.</p>
      ) : (
        <div className="pp-scroll">
          <table className="pp-table pa-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Attribute</th>
                <th scope="col">Expected result / description</th>
                <th scope="col">Linked procedures</th>
                <th scope="col">Required evidence</th>
                <th scope="col">Source</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const item = plan.attributes.find(
                  (entry) => entry.id === row.id,
                );
                if (item === undefined) {
                  return null;
                }
                const isOpen = open.has(row.id);
                const status = ATTRIBUTE_STATUS[row.status];
                return (
                  <Fragment key={row.id}>
                    <tr
                      id={`pl-item-${row.code}`}
                      className={`pp-row${selected === row.code ? " is-selected" : ""}${trace.has(row.code) ? " is-related" : ""}${isOpen ? " is-open" : ""}`}
                    >
                      <td className="pp-num">{row.number}</td>
                      <td className="pp-text pa-statement">
                        <strong>{row.statement}</strong>
                      </td>
                      <td className="pp-text pa-expected">
                        <small>{row.expected || "Not stated"}</small>
                      </td>
                      <td>
                        <CodeList codes={row.procedures} onSelect={onSelect} />
                      </td>
                      <td>
                        <CodeList codes={row.evidence} onSelect={onSelect} />
                      </td>
                      <td className="pp-source">{row.source}</td>
                      <td>
                        <span
                          className={`pp-status ${status.tone}`}
                          title={status.title}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="pp-actions">
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          aria-expanded={isOpen}
                          onClick={() => flip(setOpen, row.id)}
                        >
                          {isOpen ? "Close" : "Review"}
                        </button>
                        <ProcedureMenu
                          label={`More for attribute ${row.number}`}
                          items={[
                            {
                              text: "Edit wording",
                              run: () =>
                                setWording({ id: row.id, text: item.text }),
                            },
                            {
                              text: "Edit criteria",
                              run: () => edit(row.id, true),
                            },
                            {
                              text: "Trace in the plan",
                              run: () => onSelect(row.code),
                            },
                            {
                              text: "Remove from the plan",
                              run: () => setRemoving(row.id),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                    {wording !== null && wording.id === row.id ? (
                      <tr className="pp-detail">
                        <td />
                        <td colSpan={7}>
                          <div className="pl-edit" aria-busy={change.pending}>
                            <label>
                              Wording of attribute {row.number}
                              <textarea
                                rows={2}
                                maxLength={300}
                                value={wording.text}
                                onChange={(event) =>
                                  setWording({
                                    id: row.id,
                                    text: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <EditButtons
                              busy={change.pending}
                              disabled={
                                wording.text.trim().length < 3 ||
                                wording.text.trim() === item.text
                              }
                              save="Save wording"
                              onCancel={() => setWording(null)}
                              onSave={async () => {
                                if (
                                  await change.run("edit", {
                                    intent: "attribute-edit",
                                    attribute_id: item.id,
                                    text: wording.text.trim(),
                                    version: item.version,
                                  })
                                ) {
                                  setWording(null);
                                }
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    {isOpen ? (
                      <tr className="pp-detail">
                        <td />
                        <td colSpan={7}>
                          <div className="pp-detail-body">
                            <p className="pl-row-meta">
                              <span className="pl-ref">{row.code}</span>
                              {item.basis !== "" &&
                              item.basis !== "DOCUMENTED" ? (
                                <span className="pill tone-warning">
                                  Inferred
                                </span>
                              ) : null}
                            </p>
                            <AttributeCriteria
                              ids={ids}
                              plan={plan}
                              item={item}
                              editing={editing.has(row.id)}
                              onEditing={(value) => edit(row.id, value)}
                            />
                            <Flags
                              ids={ids}
                              plan={plan}
                              findings={flagged.get(row.code)}
                              onCriteria={() => edit(row.id, true)}
                              onSelect={onSelect}
                            />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <details className="pl-fold pa-editor" open={editorOpen || undefined}>
        <summary>{editorLabel}</summary>
        {editor}
      </details>
    </section>
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
  findings: Finding[] | undefined;
  onSelect: (code: string) => void;
}) {
  const [mode, setMode] = useState<EvidenceMode>("none");
  return (
    <li id={`pl-item-${item.code}`} className={className}>
      <details
        className="pl-row"
        open={mode !== "none" || isFocused(className) ? true : undefined}
      >
        <RowSummary
          code={item.code}
          title={item.title}
          onSelect={onSelect}
          links={
            <Chips
              optional
              label="Supports"
              codes={item.attributeCodes}
              onSelect={onSelect}
            />
          }
          aside={
            item.status === "WAIVED" ? (
              <span className="pill">Not applicable</span>
            ) : null
          }
        />
        <div className="pl-row-body">
          {item.description !== "" ? (
            <p className="pl-row-text">{item.description}</p>
          ) : null}
          <p className="pl-row-meta">
            <span>
              {[
                item.categories.join(", ").toLowerCase().replaceAll("_", " "),
                item.necessity.toLowerCase(),
                item.periodLabel,
              ]
                .filter((part) => part !== "")
                .join(" · ")}
            </span>
            <Mark origin={item.origin} personEdited={item.personEdited} />
          </p>
          {item.objective ? (
            <p className="pl-row-meta">Objective: {item.objective}</p>
          ) : null}
          <p className="pl-row-meta">
            <Chips
              label="For"
              codes={item.procedureCodes}
              onSelect={onSelect}
            />
          </p>
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
          <EvidenceForms
            ids={ids}
            plan={plan}
            item={item}
            mode={mode}
            onDone={() => setMode("none")}
          />
        </div>
      </details>
      <Flags
        ids={ids}
        plan={plan}
        findings={findings}
        onLinks={() => setMode("links")}
      />
    </li>
  );
}

type EvidenceMode = "none" | "edit" | "links";

/** An evidence item's edit and its links to attributes and procedures, in the list and
 * the table alike. */
function EvidenceForms({
  ids,
  plan,
  item,
  mode,
  onDone,
}: {
  ids: Ids;
  plan: MasterPlan;
  item: Evidence;
  mode: EvidenceMode;
  onDone: () => void;
}) {
  const action = useAction(ids);
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
  const setMode = (next: EvidenceMode) => {
    if (next === "none") {
      onDone();
    }
  };
  return (
    <>
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
              maxLength={3000}
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
    </>
  );
}

const EVIDENCE_TONE: Record<EvidenceStatus, string> = {
  NOT_REQUESTED: "is-idle",
  REQUESTED: "is-info",
  IN_PROGRESS: "is-info",
  NEEDS_REVIEW: "is-review",
  ACCEPTED: "is-ready",
  NOT_APPLICABLE: "is-idle",
};

const REQUIREMENT_WORDS: Record<string, string> = {
  PLANNED: "Planned; requested once the plan is approved",
  AWAITING_DEPENDENCY: "Waits for an earlier item",
  NOT_GENERATED: "Not requested yet",
  DRAFT: "Being drafted",
  READY_FOR_REVIEW: "Drafted, ready for review",
  APPROVAL_PENDING: "Awaiting approval to send",
  SENT: "Sent, waiting for the owner",
  OVERDUE: "Overdue",
  PARTIALLY_RECEIVED: "Partly received",
  RECEIVED: "Received, not yet reviewed",
  UNDER_REVIEW: "Under review",
  ACCEPTED: "Accepted",
  INSUFFICIENT: "Insufficient",
  FOLLOW_UP_REQUIRED: "Follow-up required",
  WAIVED: "Not applicable",
};

/** Removing an item from the plan (product owner, 26 October 2026), undone right after it. */
function useEvidenceRemoval(ids: Ids, plan: MasterPlan) {
  const action = useAction(ids);
  const [removed, setRemoved] = useState<{
    id: string;
    code: string;
    version: number;
  } | null>(null);
  const remove = async (item: Evidence) => {
    const result = await action.run("remove", {
      intent: "evidence-remove",
      control_id: plan.controlId,
      requirement_id: item.id,
      version: item.version,
    });
    if (result.ok) {
      setRemoved({ id: item.id, code: item.code, version: item.version + 1 });
    }
  };
  const undo = async () => {
    if (removed === null) {
      return;
    }
    const result = await action.run("restore", {
      intent: "evidence-restore",
      control_id: plan.controlId,
      requirement_id: removed.id,
      version: removed.version,
    });
    if (result.ok) {
      setRemoved(null);
    }
  };
  return { action, removed, remove, undo };
}

type EvidenceRemoval = ReturnType<typeof useEvidenceRemoval>;

/**
 * The evidence as the procedures show theirs (the product owner, 27 October 2026): a
 * header with where the items came from, a coverage panel with one tile per phase and
 * where the requests stand, then the chosen phase's items as cards that open to their
 * overview and actions, or as the compact table with its filters. Requests are grouped
 * and sent on the control's Request step.
 */
function EvidenceBoard({ ids, plan, selected, trace, onSelect }: TabProps) {
  const coverage = evidenceCoverage(plan);
  const flagged = findingsByCode(plan);
  const rows = evidenceRows(plan);
  const removal = useEvidenceRemoval(ids, plan);
  const [phase, setPhase] = useState<Phase>(coverage.first);
  const [view, setView] = useState<"cards" | "compact">("cards");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [modes, setModes] = useState<Record<string, EvidenceMode>>({});
  const [adding, setAdding] = useState(false);
  const mine = rows.filter((row) => row.phase === phase);
  const all = mine.length > 0 && mine.every((row) => open.has(row.id));
  const toggle = (id: string, value?: boolean) =>
    setOpen((now) => {
      const next = new Set(now);
      if (value ?? !next.has(id)) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  const mode = (id: string) => modes[id] ?? "none";
  const setMode = (id: string, next: EvidenceMode) => {
    setModes((now) => ({ ...now, [id]: next }));
    if (next !== "none") {
      toggle(id, true);
    }
  };
  // An item traced from elsewhere in the plan opens in its phase.
  useEffect(() => {
    const traced = plan.evidence.find((item) => item.code === selected);
    if (traced !== undefined) {
      setPhase(traced.phase);
      setOpen((now) => new Set(now).add(traced.id));
    }
  }, [selected, plan.evidence]);
  const current = coverage.phases.find((item) => item.phase === phase);
  return (
    <section className="pb" aria-labelledby="eb-title">
      <header className="pb-head">
        <div>
          <h3 id="eb-title">Evidence</h3>
          <p>
            {coverage.total} {coverage.total === 1 ? "item" : "items"} across{" "}
            {coverage.phasesUsed}{" "}
            {coverage.phasesUsed === 1 ? "testing phase" : "testing phases"}
            {coverage.optional > 0 ? ` · ${coverage.optional} optional` : ""}
          </p>
        </div>
        <div className="pb-head-actions">
          {coverage.source !== "" ? (
            <span className="pb-source">{coverage.source}</span>
          ) : null}
          <button
            type="button"
            className="btn-secondary btn-sm"
            aria-expanded={adding}
            onClick={() => setAdding(!adding)}
          >
            <UiIcon name="plus" size={13} />
            Add evidence
          </button>
          <a
            className="btn-secondary btn-sm"
            href={controlStepHref(
              ids.organizationId,
              ids.projectId,
              plan.controlId,
              "request",
            )}
            title="Requests are grouped and sent on the control's Request step, once the plan is approved."
          >
            <UiIcon name="layers" size={13} />
            Group in requests
          </a>
          {mine.length > 0 ? (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setView("cards");
                setOpen(all ? new Set() : new Set(mine.map((row) => row.id)));
              }}
            >
              {all ? "Close evidence" : "Review evidence"}
            </button>
          ) : null}
        </div>
      </header>
      {adding ? (
        <AddEvidence
          ids={ids}
          plan={plan}
          phase={phase}
          onDone={() => setAdding(false)}
        />
      ) : null}
      <RemovedNotice removal={removal} />
      <div className="pb-coverage">
        <div className="pb-coverage-head">
          <h4>Evidence coverage</h4>
          {coverage.standing !== "" ? (
            <span className="pb-ready">{coverage.standing}</span>
          ) : null}
        </div>
        <div className="pb-tiles" role="tablist" aria-label="Testing phases">
          {coverage.phases.map((item) => (
            <button
              key={item.phase}
              type="button"
              role="tab"
              aria-selected={item.phase === phase}
              className={`pb-tile${item.phase === phase ? " is-on" : ""}${item.applies ? "" : " is-na"}`}
              onClick={() => setPhase(item.phase)}
            >
              <span className="pb-tile-label">{item.short}</span>
              <strong>{item.applies ? item.count : "—"}</strong>
              <small>
                {item.applies
                  ? item.count === 1
                    ? "item"
                    : "items"
                  : "Not applicable"}
                {item.review > 0 ? (
                  <span className="pb-tile-flag">
                    {" "}
                    · {item.review} to review
                  </span>
                ) : null}
              </small>
            </button>
          ))}
        </div>
      </div>
      <div className="pb-phase" role="tabpanel">
        <div className="pb-phase-head">
          <h4>
            <UiIcon name="file" size={18} />
            {PHASE_LABELS[phase]}
            <span className="pb-count">{mine.length}</span>
          </h4>
          {mine.length > 0 ? (
            <fieldset className="pb-views">
              <legend className="sr-only">View</legend>
              {(["cards", "compact"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  className={view === key ? "is-on" : undefined}
                  onClick={() => setView(key)}
                >
                  {key === "cards" ? "Cards" : "Compact"}
                </button>
              ))}
            </fieldset>
          ) : null}
        </div>
        <p className="pb-purpose">
          {current?.applies === false
            ? "This phase does not apply to the control."
            : EVIDENCE_PURPOSE[phase]}
        </p>
        {mine.length === 0 ? (
          current?.applies === false ? null : (
            <p className="pl-quiet">No evidence in this phase yet.</p>
          )
        ) : view === "compact" ? (
          <EvidenceTable
            key={phase}
            ids={ids}
            plan={plan}
            selected={selected}
            trace={trace}
            onSelect={onSelect}
            phase={phase}
            removal={removal}
          />
        ) : (
          <ol className="pb-cards">
            {mine.map((row) => {
              const item = plan.evidence.find((entry) => entry.id === row.id);
              if (item === undefined) {
                return null;
              }
              const isOpen = open.has(row.id);
              return (
                <li
                  key={row.id}
                  id={`pl-item-${row.code}`}
                  className={`pb-card${isOpen ? " is-open" : ""}${selected === row.code || trace.has(row.code) ? " is-related" : ""}`}
                >
                  <button
                    type="button"
                    className="pb-card-head"
                    aria-expanded={isOpen}
                    onClick={() => toggle(row.id)}
                  >
                    <span className="pb-num is-code">{row.code}</span>
                    <span className="pb-card-title">{row.title}</span>
                    {isOpen ? null : (
                      <>
                        {row.required ? null : (
                          <span className="pb-optional">Optional</span>
                        )}
                        {row.status === "NOT_REQUESTED" ? null : (
                          <span
                            className={`pp-status ${EVIDENCE_TONE[row.status]}`}
                          >
                            {EVIDENCE_STATUS_LABELS[row.status]}
                          </span>
                        )}
                      </>
                    )}
                    <UiIcon name="chevron" size={15} />
                  </button>
                  {isOpen ? (
                    <div className="pb-card-body">
                      <EvidenceBody
                        ids={ids}
                        plan={plan}
                        item={item}
                        row={row}
                        findings={flagged.get(row.code)}
                        mode={mode(row.id)}
                        onMode={(next) => setMode(row.id, next)}
                        removal={removal}
                        onSelect={onSelect}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

/** The line that says an item was removed, with its undo. */
function RemovedNotice({ removal }: { removal: EvidenceRemoval }) {
  return (
    <>
      {removal.removed !== null ? (
        <p className="pe-removed" role="status">
          <span>
            {removal.removed.code} was removed from the plan. It stays on
            record.
          </span>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={removal.action.pending}
            onClick={() => void removal.undo()}
          >
            Undo
          </button>
        </p>
      ) : null}
      <Problem text={removal.action.problem} />
    </>
  );
}

/** One evidence item opened, in a card or the compact table alike: its phase, type,
 * where its request stands and its source, its overview with what it must show and what
 * it supports, its findings, and its actions. */
function EvidenceBody({
  ids,
  plan,
  item,
  row,
  findings,
  mode,
  onMode,
  removal,
  onSelect,
}: {
  ids: Ids;
  plan: MasterPlan;
  item: Evidence;
  row: EvidenceRow;
  findings: Finding[] | undefined;
  mode: EvidenceMode;
  onMode: (next: EvidenceMode) => void;
  removal: EvidenceRemoval;
  onSelect: (code: string) => void;
}) {
  const flip = (next: EvidenceMode) => onMode(mode === next ? "none" : next);
  return (
    <>
      <p className="pb-pills">
        <span className={`pp-pill is-phase is-${item.phase.toLowerCase()}`}>
          {row.phaseLabel}
        </span>
        <span className="pp-pill">{row.typeLabel}</span>
        <span
          className={`pp-status ${EVIDENCE_TONE[row.status]}`}
          title={REQUIREMENT_WORDS[row.state] ?? row.state}
        >
          {EVIDENCE_STATUS_LABELS[row.status]}
        </span>
        <span className="pp-pill is-phase">
          {row.required ? "Required" : "Optional"}
        </span>
        <Mark origin={item.origin} personEdited={item.personEdited} />
      </p>
      <div className="pb-overview">
        <h5>Evidence overview</h5>
        {item.description !== "" ? <p>{item.description}</p> : null}
        {item.objective !== "" ? (
          <p className="pb-overview-line">
            <strong>Shows</strong> {item.objective}
          </p>
        ) : null}
        <p className="pb-overview-line">
          <strong>Request</strong>{" "}
          {[REQUIREMENT_WORDS[row.state] ?? "", item.periodLabel]
            .filter((part) => part !== "")
            .join(" · ")}
        </p>
        <p className="pl-row-links">
          <Chips
            optional
            label="Supports"
            codes={item.attributeCodes}
            onSelect={onSelect}
          />
          <Chips
            optional
            label="Procedures"
            codes={item.procedureCodes}
            onSelect={onSelect}
          />
        </p>
      </div>
      <Flags
        ids={ids}
        plan={plan}
        findings={findings}
        onLinks={() => onMode("links")}
      />
      <span className="pb-actions">
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => flip("edit")}
        >
          <UiIcon name="compose" size={13} />
          Edit
        </button>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => flip("links")}
        >
          Link attributes and procedures
        </button>
        <button
          type="button"
          className="btn-ghost btn-sm"
          disabled={removal.action.pending}
          onClick={() => void removal.remove(item)}
        >
          Remove
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm pb-trace"
          onClick={() => onSelect(row.code)}
        >
          Trace in the plan
          <UiIcon name="arrow" size={13} />
        </button>
      </span>
      <EvidenceForms
        ids={ids}
        plan={plan}
        item={item}
        mode={mode}
        onDone={() => onMode("none")}
      />
    </>
  );
}

/**
 * One phase's evidence as a table, the board's Compact view (the table decided by the
 * product owner on 26 October 2026): filtered by type, status or words; each item with
 * the procedures it serves, its type, source and where its request stands; it opens in
 * place as its card does.
 */
function EvidenceTable({
  ids,
  plan,
  selected,
  trace,
  onSelect,
  phase,
  removal,
}: TabProps & { phase: Phase; removal: EvidenceRemoval }) {
  const flagged = findingsByCode(plan);
  const rows = evidenceRows(plan).filter((row) => row.phase === phase);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [modes, setModes] = useState<Record<string, EvidenceMode>>({});
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const words = query.trim().toLowerCase();
  const shown = rows.filter(
    (row) =>
      (type === "" || row.type === type) &&
      (status === "" || row.status === status) &&
      (words === "" ||
        `${row.code} ${row.title} ${row.procedures.join(" ")}`
          .toLowerCase()
          .includes(words)),
  );
  const types = [...new Map(rows.map((row) => [row.type, row.typeLabel]))];
  const statuses = [...new Set(rows.map((row) => row.status))];
  const toggle = (id: string, value?: boolean) =>
    setOpen((now) => {
      const next = new Set(now);
      if (value ?? !next.has(id)) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  const pickedShown = shown.filter((row) => picked.has(row.id));
  const allPicked = shown.length > 0 && pickedShown.length === shown.length;
  const pick = (id: string) =>
    setPicked((now) => {
      const next = new Set(now);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  const mode = (id: string) => modes[id] ?? "none";
  const setMode = (id: string, next: EvidenceMode) => {
    setModes((now) => ({ ...now, [id]: next }));
    if (next !== "none") {
      toggle(id, true);
    }
  };
  return (
    <div className="pb-table">
      <div className="pe-filters">
        {types.length > 1 ? (
          <label>
            <span className="sr-only">Evidence type</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="">All evidence types</option>
              {types.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {statuses.length > 1 ? (
          <label>
            <span className="sr-only">Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {statuses.map((value) => (
                <option key={value} value={value}>
                  {EVIDENCE_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="pe-search">
          <UiIcon name="search" size={14} />
          <input
            type="search"
            value={query}
            placeholder="Search evidence…"
            aria-label="Search evidence"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {pickedShown.length > 0 ? (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setOpen(new Set(pickedShown.map((row) => row.id)))}
          >
            Review {pickedShown.length} selected
          </button>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <p className="pl-quiet">No evidence matches these filters.</p>
      ) : (
        <div className="pp-scroll">
          <table className="pp-table pe-table">
            <thead>
              <tr>
                <th scope="col" className="pe-pick">
                  <input
                    type="checkbox"
                    aria-label="Select the evidence shown"
                    checked={allPicked}
                    onChange={() =>
                      setPicked(
                        allPicked
                          ? new Set()
                          : new Set(shown.map((row) => row.id)),
                      )
                    }
                  />
                </th>
                <th scope="col">ID</th>
                <th scope="col">Evidence item</th>
                <th scope="col">Linked procedure(s)</th>
                <th scope="col">Type</th>
                <th scope="col">Source</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const item = plan.evidence.find((entry) => entry.id === row.id);
                if (item === undefined) {
                  return null;
                }
                const isOpen = open.has(row.id);
                return (
                  <Fragment key={row.id}>
                    <tr
                      id={`pl-item-${row.code}`}
                      className={`pp-row${selected === row.code ? " is-selected" : ""}${trace.has(row.code) ? " is-related" : ""}${isOpen ? " is-open" : ""}`}
                    >
                      <td className="pe-pick">
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.code}`}
                          checked={picked.has(row.id)}
                          onChange={() => pick(row.id)}
                        />
                      </td>
                      <td className="pe-code">{row.code}</td>
                      <td className="pp-text pe-title">
                        <button
                          type="button"
                          className="pe-open"
                          aria-expanded={isOpen}
                          onClick={() => toggle(row.id)}
                        >
                          {row.title}
                        </button>
                        {row.required ? null : <small>Optional</small>}
                      </td>
                      <td className="pe-links">
                        {row.procedures.length === 0 ? (
                          <span className="pl-quiet">—</span>
                        ) : (
                          row.procedures.map((code, index) => (
                            <Fragment key={code}>
                              {index > 0 ? ", " : null}
                              <button
                                type="button"
                                className="pe-link"
                                title={`Trace ${code} in the plan`}
                                onClick={() => onSelect(code)}
                              >
                                {code}
                              </button>
                            </Fragment>
                          ))
                        )}
                      </td>
                      <td className="pe-type">{row.typeLabel}</td>
                      <td className="pp-source">{row.source}</td>
                      <td>
                        <span
                          className={`pp-status ${EVIDENCE_TONE[row.status]}`}
                          title={REQUIREMENT_WORDS[row.state] ?? row.state}
                        >
                          {EVIDENCE_STATUS_LABELS[row.status]}
                        </span>
                      </td>
                      <td className="pp-actions">
                        <ProcedureMenu
                          label={`More for evidence ${row.code}`}
                          items={[
                            {
                              text: isOpen
                                ? "Close the details"
                                : "Open the details",
                              run: () => toggle(row.id),
                            },
                            {
                              text: "Edit",
                              run: () => setMode(row.id, "edit"),
                            },
                            {
                              text: "Link attributes and procedures",
                              run: () => setMode(row.id, "links"),
                            },
                            {
                              text: "Trace in the plan",
                              run: () => onSelect(row.code),
                            },
                            {
                              text: "Remove from the plan",
                              run: () => void removal.remove(item),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="pp-detail">
                        <td colSpan={2} />
                        <td colSpan={6}>
                          <div className="pp-detail-body pb-detail">
                            <EvidenceBody
                              ids={ids}
                              plan={plan}
                              item={item}
                              row={row}
                              findings={flagged.get(row.code)}
                              mode={mode(row.id)}
                              onMode={(next) => setMode(row.id, next)}
                              removal={removal}
                              onSelect={onSelect}
                            />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// History

function History({
  plan,
  inline = false,
}: {
  plan: MasterPlan;
  /** As the History tab of the control's Plan step: open, and saying so when empty. */
  inline?: boolean;
}) {
  if (plan.decisions.length === 0) {
    return inline ? (
      <p className="pl-quiet">
        No decision on this plan yet. Each approval or request for changes is
        recorded here with the version it was made on.
      </p>
    ) : null;
  }
  return (
    <details className="card pl-history" open={inline || undefined}>
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
