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

import { AnswerProgress } from "./answer-progress";
import { DescribeDialog } from "./describe-dialog";
import { formatDate } from "./format";
import type { PlanningPageState } from "./load-planning";
import { CONTROL_CATEGORIES } from "./onboarding-model";
import { PhaseStrip, PhasesView, ViewSwitch } from "./phases-view";
import {
  type Attribute,
  activeFilters,
  answeredValues,
  answerPlaceholder,
  approvalHeldBy,
  BASIS_LABELS,
  basisWords,
  type ControlPhases,
  CRITERIA_LABELS,
  changesSummary,
  decisionLine,
  decisionWords,
  describeQuestions,
  type Evidence,
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
  holdGroups,
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
  PHASES,
  type Phase,
  type PlanningState,
  type Procedure,
  planningHref,
  planningProblem,
  planQuestions,
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
import { UiIcon } from "./ui-icon";
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
  agentNote = null,
  workspace = null,
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
  /** How the agent drafted the plan, folded into one line on request (the control's
   * Plan step shows no separate agent block). */
  agentNote?: ReactNode;
  /** In the control's Plan step (decided by the product owner): the control's own
   * editors inside the plan, so each fact is shown once and edited where it is read. */
  workspace?: PlanWorkspace | null;
}) {
  const [view, setView] = useState<Tab>(initialTab);
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
            {agentNote !== null ? (
              <details className="pl-agent-note">
                <summary>How the agent drafted this</summary>
                {agentNote}
              </details>
            ) : null}
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
              <h2 className="sr-only">{TAB_LABELS[view]}</h2>
              {view === "understanding" ? (
                <UnderstandingTab
                  plan={plan}
                  sources={sources}
                  onSources={setSources}
                  onAnswer={onAnswer}
                  describe={describe}
                  workspace={workspace}
                />
              ) : view === "procedures" ? (
                <>
                  {workspace !== null ? (
                    <details className="pl-fold pl-basis">
                      <summary>Test basis</summary>
                      {workspace.basis}
                    </details>
                  ) : null}
                  <ProceduresTab
                    ids={ids}
                    plan={plan}
                    selected={selected}
                    trace={trace}
                    onSelect={select}
                  />
                </>
              ) : view === "attributes" ? (
                <>
                  {plan.suggestedStandard !== null && plan.viewerCanAnswer ? (
                    <StandardSuggestion ids={ids} plan={plan} />
                  ) : null}
                  {workspace !== null ? (
                    <>
                      {workspace.attributes}
                      <details className="pl-fold">
                        <summary>How each attribute is tested</summary>
                        <AttributesTab
                          ids={ids}
                          plan={plan}
                          selected={selected}
                          trace={trace}
                          onSelect={select}
                        />
                      </details>
                    </>
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
  const groups = holdGroups(plan.blockers);
  if (groups.length === 0) {
    return null;
  }
  const holds = groups.filter((group) => group.blocks);
  const later = groups.filter((group) => !group.blocks);
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
    <aside
      className={`pl-holding ${holds.length > 0 ? "has-blockers" : ""}`}
      aria-label="Before approval"
    >
      {holds.length > 0 ? (
        <>
          <p className="pl-holding-title">
            {holds.length === 1
              ? "1 thing to resolve before approval"
              : `${holds.length} things to resolve before approval`}
          </p>
          <ul className="pl-holds">{holds.map(row)}</ul>
        </>
      ) : null}
      {later.length > 0 ? (
        <details className="pl-holding-later">
          <summary>
            {later.length === 1
              ? "1 thing to settle when it can be"
              : `${later.length} things to settle when they can be`}
            <span>Does not prevent approval</span>
            <UiIcon name="chevron" size={13} />
          </summary>
          <ul className="pl-holds">{later.map(row)}</ul>
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
      <details
        className="pl-fold"
        open={workspace?.moreOpen === true ? true : undefined}
      >
        <summary>More about this control</summary>
        <div className="pl-more">
          {workspace !== null ? workspace.more : null}
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
    </div>
  );
}

/** The control's own editors, placed inside the plan in the control's Plan step. */
export type PlanWorkspace = {
  /** The control statement with the client's values, edited in place. */
  statement: ReactNode | null;
  /** The attributes: the one editable list, with its open questions. */
  attributes: ReactNode;
  /** The test basis the plan follows, and changing it. */
  basis: ReactNode;
  /** Process understanding and supporting documents. */
  more: ReactNode;
  /** Opened when one of them needs a decision. */
  moreOpen: boolean;
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

function ProceduresTab({ ids, plan, selected, trace, onSelect }: TabProps) {
  const flagged = findingsByCode(plan);
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
        </div>
      </details>
      <Flags
        ids={ids}
        plan={plan}
        findings={findings}
        onLinks={() => setMode("links")}
      />
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
  findings: Finding[] | undefined;
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
                {item.passCriteria || (
                  <span className="pl-none">Not stated</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Fails when</dt>
              <dd>
                {item.failCriteria || (
                  <span className="pl-none">Not stated</span>
                )}
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
              </dd>
            </div>
          </dl>
          <span className="pl-item-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setEditing(!editing)}
            >
              Edit criteria
            </button>
          </span>
          {editing ? (
            <div className="pl-edit" aria-busy={action.pending}>
              {(
                [
                  [
                    "objective",
                    "The control objective or risk it addresses",
                    500,
                  ],
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
                    value={
                      automatable === null ? "" : automatable ? "yes" : "no"
                    }
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
                disabled={
                  title.trim().length < 3 || description.trim().length < 10
                }
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
                          toggle(
                            attributes,
                            attribute.id,
                            event.target.checked,
                          ),
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
                            toggle(
                              procedures,
                              procedure.id,
                              event.target.checked,
                            ),
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
