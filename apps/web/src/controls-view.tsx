import type { ReactNode } from "react";

import { analysisFor, reviewFor } from "./analysis-model";
import { AnalysisPanel } from "./analysis-view";
import { AppIdentity } from "./app-identity";
import { assistantBrief, stepAnchor } from "./assistant-model";
import { AutoRefresh } from "./auto-refresh";
import { BLOCKING_STATES, CLASSIFICATIONS } from "./control-context-model";
import {
  AttributesPanel,
  DesignPanel,
  DocumentsPanel,
  ProcessPanel,
  ReadinessPanel,
} from "./control-context-view";
import { PhasePanel, type PhaseState, PhaseStep } from "./control-phases";
import {
  ActivityTimeline,
  AgentRoster,
  ApproachLine,
  AttentionPanel,
} from "./control-workspace";
import {
  agentLanes,
  approachOf,
  attentionOf,
  figuresOf,
  laneSummary,
  lifecycleOf,
  RECORD_TAB_LABELS,
  STAGE_STATUS_LABELS,
  type WorkspaceInput,
} from "./control-workspace-model";
import { ControlsGroup, GroupsToggle } from "./controls-group";
import {
  ActionCenter,
  ControlsTable,
  ExpandableRow,
  LayoutMemory,
} from "./controls-overview";
import {
  ACTOR_LABELS,
  actionCenter,
  agentSummary,
  agentText,
  filterChips,
  groupHeadline,
  groupsStartOpen,
  nextStepLink,
  OVERALL_QUEUE,
  phaseLine,
  portfolio,
  type RegisterView,
  registerHref,
  registerView,
  rowState,
  sortControls,
  stageCounts,
  stageText,
} from "./controls-register-model";
import { ControlsToolbar } from "./controls-toolbar";
import {
  byApplication,
  byArea,
  CATEGORIES,
  type ControlFiles,
  type ControlRow,
  DEFICIENCY_STATUSES,
  DETAIL_TABS,
  type Deficiency,
  type DetailTab,
  detailTab,
  type EngagementState,
  filterControls,
  filterOptions,
  hasDraftInput,
  NO_APPLICATION,
  PROGRESS,
  PROGRESS_LABELS,
  type Queue,
  SEVERITIES,
} from "./engagement-model";
import { FileChanges } from "./evidence-change";
import {
  CHANGE_NOTICES,
  type ChangeNotice,
  changeBlocked,
  changeNoticeOk,
} from "./evidence-change-model";
import {
  evidenceActions,
  evidenceHref,
  primaryAction,
  REQUEST_STAGES,
  requestStage,
} from "./evidence-flow";
import { RequestUpload } from "./evidence-intake";
import {
  agentStatus,
  byApplicationOf,
  isReading,
  uploadBlocked,
} from "./evidence-model";
import {
  PHASE_STATE_SHORT,
  PHASE_STATE_TONES,
  type Phase,
  type PlanPhase,
  populationWaiting,
  stepStateOf,
} from "./evidence-plan-model";
import { PreviewButton } from "./evidence-preview";
import {
  proposals as evidenceProposals,
  evidenceSummary,
  fileServes,
  type RequestRow,
  requestRows,
} from "./evidence-workspace-model";
import { EvidenceWorkspace } from "./evidence-workspace-view";
import { formatDate } from "./format";
import { RequestReview } from "./request-review";
import { reviewFor as controlReviewFor, openNotes } from "./review-model";
import { ReviewTab } from "./review-view";
import { roundsFor } from "./round-model";
import { TestRounds } from "./round-view";
import { sheetFor } from "./sheet-model";
import { TestSheetCard } from "./sheet-view";
import type { ShellModel } from "./shell-model";
import { canManageProjects } from "./shell-model";
import { testFor } from "./testing-model";
import { TestPlanCard } from "./testing-view";
import { UiIcon } from "./ui-icon";
import { canDecide, canRequestEvidence } from "./workflow-model";
import { WorkpapersTab } from "./workpaper-view";
import { EmptyState, PageHeader } from "./workspace-view";

type Ready = Extract<ShellModel, { status: "ready" }>;
type Keep = Record<string, string | string[] | null>;

const SEVERITY_LABEL: Record<string, string> = Object.fromEntries(SEVERITIES);
const FINDING_STATUS: Record<string, string> =
  Object.fromEntries(DEFICIENCY_STATUSES);
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES);
const SEVERITY_TONE: Record<string, string> = {
  CONTROL_DEFICIENCY: "tone-warning",
  SIGNIFICANT_DEFICIENCY: "tone-danger",
  MATERIAL_WEAKNESS: "tone-critical",
};
const REQUEST_KIND = {
  EVIDENCE: "Evidence",
  SAMPLES: "Samples",
  FOLLOW_UP: "Follow-up",
};
const _QUEUE_LABELS: Array<[Queue | null, string]> = [
  [null, "All"],
  ["team", "Needs your action"],
  ["owner", "Waiting on owners"],
  ["overdue", "Overdue"],
  ["review", "In review"],
  ["findings", "With exceptions"],
  ["concluded", "Concluded"],
];

function href(model: Ready, extra: Keep = {}, section = "controls") {
  const params = new URLSearchParams({
    organization: model.organization.id,
    section,
  });
  if (model.selectedProject !== null) {
    params.set("project", model.selectedProject.id);
  }
  for (const [key, value] of Object.entries(extra)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
    } else if (value !== null && value !== "") {
      params.set(key, value);
    }
  }
  return `/?${params.toString()}`;
}

function _initials(name: string): string {
  const parts = name.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const CLASSIFICATION_LABELS: Readonly<Record<string, string>> =
  Object.fromEntries(CLASSIFICATIONS);

function frequencyText(control: ControlRow): string {
  return (
    control.frequencyLabel ||
    control.frequency.replaceAll("_", " ").toLowerCase()
  );
}

/** "event driven" as "Event driven". */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function natureText(control: ControlRow): string {
  return (
    control.natureLabel || control.nature.replaceAll("_", " ").toLowerCase()
  );
}

export function ControlsMain({
  model,
  engagement,
}: {
  model: Ready;
  engagement: EngagementState;
}) {
  const project = model.selectedProject;
  if (project === null) {
    return null;
  }
  const all = engagement.controls;
  const filters = engagement.filters;
  if (all === null) {
    return (
      <div className="page">
        <section className="card">
          <EmptyState
            icon="shield"
            title="The controls could not be loaded"
            detail="Refresh to try again."
          />
        </section>
      </div>
    );
  }
  const inScope = all.filter((control) => control.included);
  const keep: Keep = {
    category: filters.category,
    q: filters.query || null,
    queue: filters.queue,
    group: filters.group === "application" ? "application" : null,
    app: filters.application,
    area: filters.area,
    owner: filters.owner,
    stage: filters.stage,
    key: filters.keyOnly ? "1" : null,
  };
  const shown = filterControls(inScope, filters);
  const selected =
    all.find((control) => control.id === filters.control) ?? null;
  if (selected !== null) {
    return (
      <ControlRecord
        model={model}
        control={selected}
        engagement={engagement}
        keep={keep}
        siblings={shown}
      />
    );
  }
  return (
    <ControlRegister
      model={model}
      engagement={engagement}
      inScope={inScope}
      shown={shown}
      keep={keep}
    />
  );
}

// The register

function ControlRegister({
  model,
  engagement,
  inScope,
  shown,
  keep,
}: {
  model: Ready;
  engagement: EngagementState;
  inScope: ControlRow[];
  shown: ControlRow[];
  keep: Keep;
}) {
  const filters = engagement.filters;
  const project = model.selectedProject;
  const view = registerView(filters);
  const base = {
    organization: model.organization.id,
    project: project?.id ?? "",
  };
  const ids = { organizationId: base.organization, projectId: base.project };
  // The attention count follows the other filters, so it is what a click shows.
  const typed = filterControls(inScope, { ...filters, queue: null });
  const byApp = view.group === "application";
  const groups = byApp ? byApplication(shown) : byArea(shown);
  const categories = CATEGORIES.filter(([key]) =>
    inScope.some((control) => control.category === key),
  );
  const active = project?.status === "ACTIVE";
  const canSubmit = canRequestEvidence(model.organization.role) && active;
  const canAssign = canManageProjects(model.organization.role) && active;
  const progress = portfolio(inScope);
  const stages = stageCounts(inScope);
  const actions = actionCenter(inScope, canSubmit);
  const agents = agentSummary(inScope);
  const applications = new Set(
    inScope.map((control) => control.applicationName).filter(Boolean),
  ).size;
  const areas = new Set(inScope.map((control) => control.area)).size;
  const startOpen = groupsStartOpen(view, shown.length, groups.length);
  // Each person's open and closed groups are kept for the whole register only.
  const keepChoice = view.queue === null && filterChips(view).length === 0;
  const rcmHref = href(model, { step: "rcm" }, "setup");
  const exportHref = `/workspace/workpapers/export?organization=${model.organization.id}&project=${project?.id ?? ""}`;
  const cleared: Partial<RegisterView> = {
    q: "",
    category: null,
    app: [],
    area: [],
    owner: [],
    stage: [],
    key: false,
  };
  const view$ = (change: Partial<RegisterView>) =>
    registerHref(base, view, { ...cleared, ...change });
  const stepHref = (control: ControlRow): string | null => {
    const link = nextStepLink(control);
    return link === null
      ? null
      : link.section === "approvals"
        ? href(model, {}, "approvals")
        : href(model, { ...keep, control: control.id, tab: link.tab });
  };
  const actionHrefs = Object.fromEntries(
    actions.map((item) => [
      item.key,
      item.to.kind === "view"
        ? view$(item.to.change)
        : item.to.kind === "approvals"
          ? href(model, {}, "approvals")
          : href(model, { tab: "requests" }, "evidence"),
    ]),
  );
  // The header's one action: the next control that is the viewer's to take on.
  const nextControl = sortControls(
    inScope.filter((control) => control.yours),
    "attention",
  )[0];
  const nextHref = nextControl === undefined ? null : stepHref(nextControl);
  const tableLinks = Object.fromEntries(
    shown.map((control) => {
      const step = stepHref(control);
      return [
        control.id,
        {
          open: href(model, { ...keep, control: control.id }),
          step: step === null ? null : { label: control.nextStep, href: step },
        },
      ];
    }),
  );
  const sortHrefs = Object.fromEntries(
    (
      ["control", "stage", "attention", "owner", "application", "due"] as const
    ).map((sort) => [sort, registerHref(base, view, { sort })]),
  ) as Record<RegisterView["sort"], string>;
  const meta = [
    `${inScope.length} control${inScope.length === 1 ? "" : "s"} in scope`,
    applications > 0
      ? `${applications} application${applications === 1 ? "" : "s"}`
      : "",
    `${areas} area${areas === 1 ? "" : "s"}`,
    project?.periodEnd ? `Period ending ${formatDate(project.periodEnd)}` : "",
  ].filter((part) => part !== "");
  const agentRows: Array<{
    key: string;
    state: "running" | "waiting" | "completed" | "failed";
    text: string;
    href: string;
  }> = [
    ...(agents.testing > 0
      ? [
          {
            key: "testing",
            state: "running" as const,
            text: `Testing ${agents.testing} control${agents.testing === 1 ? "" : "s"}`,
            href: view$({ queue: "agents" }),
          },
        ]
      : []),
    ...(agents.reading > 0
      ? [
          {
            key: "reading",
            state: "running" as const,
            text: `Reading ${agents.reading} evidence file${agents.reading === 1 ? "" : "s"}`,
            href: view$({ queue: "agents" }),
          },
        ]
      : []),
    ...(agents.drafting > 0
      ? [
          {
            key: "drafting",
            state: "running" as const,
            text: `Drafting workpapers on ${agents.drafting} control${agents.drafting === 1 ? "" : "s"}`,
            href: view$({ queue: "agents" }),
          },
        ]
      : []),
    ...(agents.reviewing > 0
      ? [
          {
            key: "reviewing",
            state: "running" as const,
            text: `Re-performing ${agents.reviewing} review${agents.reviewing === 1 ? "" : "s"}`,
            href: view$({ queue: "agents" }),
          },
        ]
      : []),
    ...(agents.awaitingConfirmation > 0
      ? [
          {
            key: "confirm",
            state: "completed" as const,
            text: `${agents.awaitingConfirmation} tested, results to confirm`,
            href: view$({ stage: ["RESULTS_TO_CONFIRM"] }),
          },
        ]
      : []),
    ...(agents.waitingEvidence > 0
      ? [
          {
            key: "waiting",
            state: "waiting" as const,
            text: `${agents.waitingEvidence} waiting for the owner's evidence`,
            href: view$({ queue: "evidence" }),
          },
        ]
      : []),
    ...(agents.stopped > 0
      ? [
          {
            key: "stopped",
            state: "failed" as const,
            text: `${agents.stopped} stopped, to start again`,
            href: view$({ queue: "stopped" }),
          },
        ]
      : []),
  ];
  const AGENT_WORDS = {
    running: "Running",
    waiting: "Waiting",
    completed: "Done",
    failed: "Stopped",
  } as const;
  return (
    <div className="page register-page cr co">
      {view.layout === "applications" ? (
        <LayoutMemory
          tableHref={registerHref(base, view, { layout: "table" })}
        />
      ) : null}
      <PageHeader
        context={project?.name}
        title="Controls"
        description={meta.join(" · ")}
        actions={
          <div className="cr-head-actions">
            {nextControl !== undefined && nextHref !== null ? (
              <a className="btn" href={nextHref}>
                Continue: {nextControl.controlRef}
                <UiIcon name="arrow" size={15} />
              </a>
            ) : null}
            <details className="co-menu">
              <summary className="btn btn-secondary" aria-label="More actions">
                <UiIcon name="more" size={16} />
              </summary>
              <div className="co-menu-list">
                <a href={exportHref}>
                  <UiIcon name="upload" size={14} />
                  Export workpapers
                </a>
                <a href={rcmHref}>
                  <UiIcon name="table" size={14} />
                  Edit RCM
                </a>
              </div>
            </details>
          </div>
        }
      />
      {inScope.length > 0 ? (
        <section className="co-summary" aria-label="Progress">
          <div className="co-summary-head">
            <p className="co-done">
              <strong>{progress.states[0]?.count ?? 0}</strong> of{" "}
              {progress.total} completed
            </p>
            {progress.needsYou > 0 ? (
              <a className="co-you" href={view$({ queue: "team" })}>
                {progress.needsYou} need{progress.needsYou === 1 ? "s" : ""}{" "}
                your attention
              </a>
            ) : null}
            {progress.exceptions > 0 ? (
              <a className="co-exceptions" href={view$({ queue: "findings" })}>
                <UiIcon name="risk" size={13} />
                {progress.exceptions} with exceptions
              </a>
            ) : null}
          </div>
          <div
            className="co-bar"
            role="img"
            aria-label={progress.states
              .map((item) => `${item.count} ${item.label.toLowerCase()}`)
              .join(", ")}
          >
            {progress.states
              .filter((item) => item.count > 0)
              .map((item) => (
                <span
                  key={item.state}
                  className={`is-${item.state}`}
                  style={{ flexGrow: item.count }}
                />
              ))}
          </div>
          <div className="co-summary-foot">
            <ul className="co-legend">
              {progress.states.map((item) => (
                <li key={item.state}>
                  <a
                    className={`is-${item.state}${item.count === 0 ? " is-zero" : ""}`}
                    href={view$({ queue: OVERALL_QUEUE[item.state] })}
                    aria-current={
                      view.queue === OVERALL_QUEUE[item.state]
                        ? "true"
                        : undefined
                    }
                  >
                    <span className="co-dot" aria-hidden="true" />
                    {item.label}
                    <strong>{item.count}</strong>
                  </a>
                </li>
              ))}
            </ul>
            <details className="co-stages">
              <summary>By stage</summary>
              <ul>
                {stages.stages.map((item) => (
                  <li key={item.stage}>
                    <a
                      href={view$({ stage: [item.stage], queue: null })}
                      className={item.count === 0 ? "is-zero" : undefined}
                    >
                      {item.label}
                      <strong>{item.count}</strong>
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </section>
      ) : null}
      {inScope.length > 0 ? (
        <div className="co-cards">
          <ActionCenter ids={ids} items={actions} hrefs={actionHrefs} />
          <section
            className="co-card co-agents"
            aria-labelledby="co-agents-title"
          >
            <h2 id="co-agents-title" className="co-card-title">
              Agents
              <span className="co-card-note">
                {agents.running > 0
                  ? `${agents.running} working now`
                  : agents.queued > 0
                    ? `${agents.queued} queued`
                    : "None working now"}
                {agents.running > 0 && agents.queued > 0
                  ? ` · ${agents.queued} queued`
                  : ""}
              </span>
            </h2>
            {agentRows.length === 0 ? (
              <p className="co-calm">No agent is working on these controls.</p>
            ) : (
              <ul className="co-agent-list">
                {agentRows.map((row) => (
                  <li key={row.key} className={`is-${row.state}`}>
                    <span className="co-agent-state">
                      {row.state === "running" ? (
                        <span className="cw-pulse" aria-hidden="true" />
                      ) : null}
                      {AGENT_WORDS[row.state]}
                    </span>
                    <a href={row.href}>{row.text}</a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
      <section className="cr-panel">
        <ControlsToolbar
          base={base}
          view={view}
          options={filterOptions(inScope)}
          categories={categories}
          stages={PROGRESS.map((stage) => [stage, PROGRESS_LABELS[stage]])}
          shown={shown.length}
          total={inScope.length}
          needsYou={typed.filter((control) => control.yours).length}
          extra={
            view.layout === "applications" && groups.length > 1 ? (
              <GroupsToggle />
            ) : null
          }
        />
        {inScope.length === 0 ? (
          <EmptyState
            icon="shield"
            title="No controls in scope yet"
            detail="Controls come from the RCM. Add or bring them into scope there."
            action={
              <a className="btn" href={rcmHref}>
                Edit RCM
              </a>
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon="shield"
            title={
              filters.queue === "team" && filterChips(view).length === 0
                ? "No controls require your action"
                : "No controls match"
            }
            detail={
              filters.queue === "team" && filterChips(view).length === 0
                ? "Controls appear here when an approval, a review, or a testing step is assigned to you."
                : "Nothing in scope matches this search and these filters."
            }
            action={
              filterChips(view).length > 0 || filters.queue !== null ? (
                <a className="btn btn-secondary" href={view$({ queue: null })}>
                  Show every control
                </a>
              ) : undefined
            }
          />
        ) : view.layout === "table" ? (
          <ControlsTable
            ids={ids}
            rows={sortControls(shown, view.sort)}
            links={tableLinks}
            sortHrefs={sortHrefs}
            sort={view.sort}
            canSubmit={canSubmit}
            canAssign={canAssign}
          />
        ) : (
          <div className="cr-list">
            <div className="cr-list-head" aria-hidden="true">
              <span>Control</span>
              <span>Status</span>
              <span>Owner</span>
              <span>Next</span>
            </div>
            {groups.map((group, index) => {
              const line = groupHeadline(group.controls);
              const rows = sortControls(
                byApp
                  ? group.areas.flatMap((area) => area.controls)
                  : group.controls,
                view.sort,
              );
              const first = group.controls[0];
              const done =
                line.total === 0
                  ? 0
                  : Math.round((line.concluded / line.total) * 100);
              return (
                <ControlsGroup
                  key={group.area}
                  id={`cr-group-${index}`}
                  storageKey={`aw.controls.${project?.id ?? ""}.${view.group}.${group.area}`}
                  startOpen={startOpen}
                  keepChoice={keepChoice}
                  header={
                    <>
                      {byApp && group.area !== NO_APPLICATION ? (
                        <AppIdentity
                          name={group.area}
                          layer={first?.applicationLayer ?? null}
                          hosting={first?.applicationHosting ?? null}
                        />
                      ) : (
                        <span className="app-identity">
                          <span
                            className="app-identity-mark"
                            aria-hidden="true"
                          >
                            <UiIcon name="shield" size={14} />
                          </span>
                          <span className="app-identity-name">
                            {group.area}
                          </span>
                        </span>
                      )}
                      <span className="cr-group-line">
                        {line.total} control{line.total === 1 ? "" : "s"}
                        {" · "}
                        {line.concluded} completed
                        {line.needYou > 0 ? (
                          <span className="cr-flag-you">
                            {" · "}
                            {line.needYou} need{line.needYou === 1 ? "s" : ""}{" "}
                            you
                          </span>
                        ) : null}
                        {line.blocked > 0 ? (
                          <span className="cr-flag-late">
                            {" · "}
                            {line.blocked} blocked
                          </span>
                        ) : null}
                      </span>
                      <span
                        className="cr-group-meter"
                        aria-hidden="true"
                        title={`${done}% completed`}
                      >
                        <span style={{ width: `${done}%` }} />
                      </span>
                    </>
                  }
                >
                  <ul className="cr-rows">
                    {rows.map((control) => (
                      <ControlLine
                        key={control.id}
                        model={model}
                        control={control}
                        keep={keep}
                        byApp={byApp}
                        stepHref={stepHref(control)}
                      />
                    ))}
                  </ul>
                </ControlsGroup>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * One control in the application view: what it is, where it stands in a few words (with
 * what blocks it, if anything), whether it is the viewer's, its owner, and the one thing to
 * do. Everything else opens below on request: area, frequency, nature, samples, evidence by
 * phase, the agent at work, and the full next step.
 */
function ControlLine({
  model,
  control,
  keep,
  byApp,
  stepHref,
}: {
  model: Ready;
  control: ControlRow;
  keep: Keep;
  /** Under "By application" the application is the heading, so the row omits it. */
  byApp: boolean;
  stepHref: string | null;
}) {
  const state = rowState(control);
  const owner = control.ownerName || control.ownerEmail;
  const who = ACTOR_LABELS[control.actor];
  const agent = agentText(control);
  const open = href(model, { ...keep, control: control.id });
  return (
    <ExpandableRow
      className={`cr-row${control.yours ? " is-yours" : ""}${state.tone === "blocked" ? " is-blocked" : ""}`}
      label={`${control.controlRef} ${control.title}`}
      main={
        <>
          <a className="cr-open" href={open}>
            <span className="cr-id">{control.controlRef}</span>
            <span className="cr-title">{control.title}</span>
            {!byApp && control.applicationName !== "" ? (
              <span className="cr-where">
                <AppIdentity
                  name={control.applicationName}
                  layer={control.applicationLayer}
                  hosting={control.applicationHosting}
                  size={14}
                />
              </span>
            ) : null}
          </a>
          <span className="cr-state-col" data-label="Status">
            <span className={`co-state is-${state.tone}`}>
              {state.tone === "blocked" ? (
                <UiIcon name="risk" size={12} />
              ) : state.tone === "active" ? (
                <span className="cw-pulse" aria-hidden="true" />
              ) : null}
              {state.label}
            </span>
            {state.detail !== "" ? (
              <small className="cr-state-detail">{state.detail}</small>
            ) : null}
          </span>
          <span
            className="cr-owner"
            data-label="Owner"
            title={control.ownerEmail || undefined}
          >
            {owner !== "" ? (
              owner
            ) : (
              <span className="cr-unowned">PBC coordinator</span>
            )}
          </span>
          <span className="cr-next" data-label="Next">
            {stepHref !== null ? (
              <a className="cr-action" href={stepHref}>
                <span className="cr-you">You</span>
                {control.nextStep}
                <UiIcon name="arrow" size={12} />
              </a>
            ) : control.progress === "CONCLUDED" ? (
              <a
                className="cr-action is-quiet"
                href={href(model, {
                  ...keep,
                  control: control.id,
                  tab: "review",
                })}
              >
                View the review
              </a>
            ) : control.drafted ? null : who !== "" ? (
              <span className="cr-waiting">With {who.toLowerCase()}</span>
            ) : null}
          </span>
        </>
      }
      more={
        <dl className="cr-facts">
          <div>
            <dt>Area</dt>
            <dd>{control.area}</dd>
          </div>
          <div>
            <dt>Frequency</dt>
            <dd>{sentence(frequencyText(control))}</dd>
          </div>
          <div>
            <dt>Nature</dt>
            <dd>{sentence(natureText(control))}</dd>
          </div>
          <div>
            <dt>Samples</dt>
            <dd>
              {control.sampleSize}
              {control.keyControl ? "" : " · Non-key"}
            </dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>
              {control.evidencePhases.length === 0
                ? "None requested"
                : control.evidencePhases
                    .map((phase) => {
                      const line = phaseLine(phase);
                      return `${line.label} ${line.text}`;
                    })
                    .join(" · ")}
            </dd>
          </div>
          <div>
            <dt>Next step</dt>
            <dd>
              {control.nextStep || "None"}
              {who !== "" && !control.yours ? ` (${who.toLowerCase()})` : ""}
            </dd>
          </div>
          {agent !== "" ? (
            <div>
              <dt>Agent</dt>
              <dd>{agent}</dd>
            </div>
          ) : null}
          {control.readinessBlocker !== "" ? (
            <div className="cr-fact-wide">
              <dt>Before testing</dt>
              <dd>{control.readinessBlocker}</dd>
            </div>
          ) : null}
          {control.ownerEmail !== "" ? (
            <div>
              <dt>Owner email</dt>
              <dd>{control.ownerEmail}</dd>
            </div>
          ) : null}
          {control.deficiencies > 0 && control.worstSeverity !== null ? (
            <div>
              <dt>Findings</dt>
              <dd>
                {control.deficiencies} deficienc
                {control.deficiencies === 1 ? "y" : "ies"},{" "}
                {SEVERITY_LABEL[control.worstSeverity]?.toLowerCase()}
              </dd>
            </div>
          ) : null}
        </dl>
      }
    />
  );
}

// The control record

function ControlRecord({
  model,
  control,
  engagement,
  keep,
  siblings,
}: {
  model: Ready;
  control: ControlRow;
  engagement: EngagementState;
  keep: Keep;
  siblings: ControlRow[];
}) {
  const tab = detailTab(control, engagement.filters.tab);
  const tasks = (engagement.plan?.tasks ?? []).filter(
    (task) => task.controlId === control.id,
  );
  const findings = (engagement.deficiencies ?? []).filter(
    (item) => item.controlId === control.id,
  );
  const test = testFor(engagement.tests, control.id);
  const review = controlReviewFor(engagement.reviews, control.id);
  const index = siblings.findIndex((item) => item.id === control.id);
  const previous = index > 0 ? siblings[index - 1] : undefined;
  const next =
    index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : undefined;
  const rounds = roundsFor(engagement.rounds, control.id);
  const sheet = sheetFor(engagement.sheets, control.id);
  const taskOf = (kind: string) => tasks.find((task) => task.kind === kind);
  const ids = {
    organizationId: model.organization.id,
    projectId: model.selectedProject?.id ?? "",
    controlId: control.id,
  };
  const canAct =
    canRequestEvidence(model.organization.role) &&
    model.selectedProject?.status === "ACTIVE";
  const hasInput = hasDraftInput(control, engagement.files);
  const context =
    engagement.context !== null && engagement.context.controlId === control.id
      ? engagement.context
      : null;
  const evidencePlan =
    engagement.evidencePlan !== null &&
    engagement.evidencePlan.controlId === control.id
      ? engagement.evidencePlan
      : null;
  const controlFiles = new Set(
    (engagement.files?.files ?? []).map((file) => file.id),
  );
  // What a person does next on the evidence, one item per record (evidence-flow.ts).
  // Owners, admins, and project managers approve; the API checks it again.
  const canApprove =
    canDecide(model.organization.role) &&
    model.selectedProject?.status === "ACTIVE";
  const evidence = evidenceActions({
    control,
    plan: evidencePlan,
    canAct,
    canApprove,
    proposals: evidenceProposals(evidencePlan).length,
  });
  // What the agents did and what needs the person (assistant-model.ts).
  const brief = assistantBrief({
    control,
    context,
    test,
    sheet,
    review,
    tasks,
    filesRead: (engagement.files?.analyses ?? []).filter(
      (analysis) =>
        analysis.status === "READY" && controlFiles.has(analysis.fileId),
    ).length,
    populationToAccept: populationWaiting(evidencePlan, "INTERIM"),
    evidence,
  });
  const input: WorkspaceInput = {
    control,
    plan: evidencePlan,
    context,
    test,
    sheet,
    review,
    rounds,
    workpapers: engagement.workpapers,
    tasks,
    files: engagement.files,
    findings,
  };
  const stages = lifecycleOf(input);
  const lanes = agentLanes(input);
  const working = laneSummary(lanes).running;
  const approach = approachOf(input, CLASSIFICATION_LABELS);
  const figures = figuresOf(input, stages);
  const stage = stageText(control);
  const link = nextStepLink(control);
  const who = control.yours ? "You" : ACTOR_LABELS[control.actor];
  const attention = attentionOf(brief, control, control.yours ? "" : who);
  const tabHrefs = Object.fromEntries(
    DETAIL_TABS.map((key) => [
      key,
      href(model, { ...keep, control: control.id, tab: key }),
    ]),
  ) as Record<DetailTab, string>;
  // The header's next step opens the record it is about when that is evidence work.
  const firstEvidence = evidence.find((action) => action.mine);
  const nextHref =
    link === null
      ? null
      : firstEvidence !== undefined &&
          (link.section === "approvals" || link.tab === "evidence")
        ? evidenceHref(tabHrefs.evidence, firstEvidence.target)
        : link.section === "approvals"
          ? href(model, {}, "approvals")
          : (tabHrefs[link.tab as DetailTab] ?? tabHrefs.overview);
  // The header leads with the same evidence action as the Evidence tab when the next
  // step is evidence work the person can do; otherwise with the control's next step.
  const evidenceLead = primaryAction(evidence);
  // On the Evidence tab the page itself approves the plan. The header does not
  // offer the same button again.
  const lead =
    evidenceLead !== null &&
    !(tab === "evidence" && evidenceLead.action.kind === "approve_plan") &&
    (link === null || link.section === "approvals" || link.tab === "evidence")
      ? {
          label: evidenceLead.label,
          href: evidenceHref(tabHrefs.evidence, evidenceLead.action.target),
        }
      : link !== null && nextHref !== null
        ? { label: control.nextStep, href: nextHref }
        : null;
  // The request opened on the Evidence tab (?request=), with its review.
  const focused = engagement.filters.request ?? null;
  const focusRow =
    focused === null
      ? undefined
      : control.requests.find((request) => request.id === focused);
  const requestReview =
    focusRow !== undefined ? (
      <RequestReview
        ids={ids}
        request={focusRow}
        details={
          engagement.focusRequest?.request.id === focusRow.id
            ? engagement.focusRequest
            : null
        }
        stage={requestStage(focusRow, control)}
        control={{
          ref: control.controlRef,
          title: control.title,
          system: control.applicationName,
        }}
        plan={evidencePlan}
        planned={control.evidencePlan !== "NONE"}
        canAct={canAct}
        canApprove={canApprove}
        closeHref={evidenceHref(tabHrefs.evidence, { view: "requests" })}
      />
    ) : focused !== null ? (
      <p className="form-hint" role="status">
        That request is not on this control. Its requests are listed below.
      </p>
    ) : null;
  const attributesState: PhaseState =
    context === null
      ? "todo"
      : context.approved.length === 0
        ? "issue"
        : context.proposed.length > 0 ||
            context.issues.some(
              (item) => item.status === "OPEN" && item.origin !== "PROCESS",
            )
          ? "active"
          : "done";
  const processState: PhaseState =
    context === null
      ? "todo"
      : !context.processRequired || context.understanding.status === "CONFIRMED"
        ? "done"
        : context.understanding.status === "DRAFT"
          ? "active"
          : "todo";
  const lifeState = (key: string): PhaseState => {
    const found = stages.find((item) => item.key === key)?.status;
    return found === "done"
      ? "done"
      : found === "blocked"
        ? "issue"
        : found === "not_started" ||
            found === "not_applicable" ||
            found === undefined
          ? "todo"
          : "active";
  };
  const planPhase = (phase: Phase) =>
    evidencePlan?.phases.find((item) => item.phase === phase) ?? null;
  const _planStep = (phase: Phase) => {
    const found = planPhase(phase);
    return {
      state: found === null ? ("todo" as const) : stepStateOf(found.state),
      note: PHASE_STATE_SHORT[found === null ? "NOT_PLANNED" : found.state],
    };
  };
  const _phaseHrefs: Record<Phase, string> = {
    DESIGN: tabHrefs.evidence,
    INTERIM: tabHrefs.evidence,
    ROLLFORWARD: tabHrefs.evidence,
  };
  const openFindings = figures.findings.open;
  const tabs: Array<[DetailTab, number | null]> = [
    ["overview", attention.filter((item) => item.kind !== "waiting").length],
    ["design", context?.proposed.length ?? null],
    [
      "evidence",
      control.requests.filter((request) => request.status !== "CANCELLED")
        .length,
    ],
    ["testing", sheet === null ? null : sheet.counts.items],
    ["findings", openFindings + figures.findings.potential],
    ["review", review === null ? null : openNotes(review).length],
    ["activity", engagement.activity?.length ?? null],
  ];
  const workpaperProps = {
    papers: engagement.workpapers,
    notice: engagement.workpaperNotice,
    viewing: engagement.workpaperViewing,
    ids,
    canAct,
    hasInput,
  };
  const keepWorkpaper =
    engagement.workpaperNotice !== null || engagement.workpaperViewing !== null;
  return (
    <div className="page record-page cx cw">
      <div className="cx-record-nav">
        <nav className="cx-crumbs" aria-label="Breadcrumb">
          <a href={href(model, keep)}>
            <span aria-hidden="true">←</span> Controls
          </a>
          {control.applicationName !== "" ? (
            <>
              <span aria-hidden="true">/</span>
              <span>{control.applicationName}</span>
            </>
          ) : null}
          <span aria-hidden="true">/</span>
          <span>{control.controlRef}</span>
        </nav>
        {index >= 0 ? (
          <span className="cx-pager">
            <span>
              {index + 1} of {siblings.length}
            </span>
            {previous !== undefined ? (
              <a
                className="cx-pager-btn"
                href={href(model, { ...keep, control: previous.id })}
                aria-label={`Previous control, ${previous.label}`}
              >
                ‹
              </a>
            ) : (
              <span className="cx-pager-btn is-disabled" aria-hidden="true">
                ‹
              </span>
            )}
            {next !== undefined ? (
              <a
                className="cx-pager-btn"
                href={href(model, { ...keep, control: next.id })}
                aria-label={`Next control, ${next.label}`}
              >
                ›
              </a>
            ) : (
              <span className="cx-pager-btn is-disabled" aria-hidden="true">
                ›
              </span>
            )}
          </span>
        ) : null}
      </div>
      <header className="cw-head">
        <div className="cw-id">
          <p className="cw-kicker">
            <span className="cw-ref">{control.controlRef}</span>
            {control.applicationName !== "" ? (
              <span>{control.applicationName}</span>
            ) : null}
          </p>
          <h1>{control.title}</h1>
          <p className="cw-meta">
            <span>{CATEGORY_LABEL[control.category] ?? control.category}</span>
            <span>{control.keyControl ? "Key control" : "Non-key"}</span>
            <span>{sentence(natureText(control))}</span>
            <span>{sentence(frequencyText(control))}</span>
            <span>{approach.method}</span>
            <span title={control.ownerEmail || undefined}>
              Owner{" "}
              {control.ownerName || control.ownerEmail || "PBC coordinator"}
            </span>
          </p>
        </div>
        <div className="cw-head-side">
          <p className="cw-stage-line">
            <span
              className={`cr-status cw-stage is-${control.progress.toLowerCase()}`}
            >
              {stage.label}
            </span>
            {stage.ai ? (
              <span
                className="cw-ai"
                title="An agent's work that no person has confirmed yet"
              >
                AI
              </span>
            ) : null}
            {working > 0 ? (
              <span className="cw-live">
                <span className="cw-pulse" aria-hidden="true" />
                {working === 1
                  ? "1 agent working"
                  : `${working} agents working`}
              </span>
            ) : null}
          </p>
          {lead !== null ? (
            <a className="btn" href={lead.href}>
              {lead.label}
              <UiIcon name="arrow" size={15} />
            </a>
          ) : control.progress === "CONCLUDED" ? (
            <a className="btn btn-secondary" href={tabHrefs.review}>
              View the conclusion
              <UiIcon name="arrow" size={15} />
            </a>
          ) : (
            <p className={`cw-waiting-on${control.overdue ? " is-late" : ""}`}>
              {control.drafted ? (
                <>
                  <span className="cw-owner">Drafted</span>
                  Submit with the drafted batch
                </>
              ) : (
                <>
                  {who !== "" ? <span className="cw-owner">{who}</span> : null}
                  {control.nextStep}
                </>
              )}
            </p>
          )}
        </div>
      </header>
      <nav className="cw-life" aria-label="Where the audit stands">
        <ol>
          {stages.map((item) => (
            <li key={item.key} className={`is-${item.status}`}>
              <a href={tabHrefs[item.tab]}>
                <span className="cw-life-icon" aria-hidden="true">
                  {item.status === "done" ? (
                    <UiIcon name="check" size={12} />
                  ) : item.status === "blocked" ? (
                    <UiIcon name="risk" size={12} />
                  ) : item.agent ? (
                    <UiIcon name="sparkles" size={11} />
                  ) : null}
                </span>
                <span className="cw-life-text">
                  <strong>{item.label}</strong>
                  <small>
                    {item.note !== ""
                      ? item.note
                      : STAGE_STATUS_LABELS[item.status]}
                  </small>
                </span>
                <span className="sr-only">
                  : {STAGE_STATUS_LABELS[item.status]}
                </span>
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <nav className="cx-tabs cw-tabs" aria-label="Control record">
        {tabs.map(([key, count]) => (
          <a
            key={key}
            href={tabHrefs[key]}
            aria-current={tab === key ? "page" : undefined}
          >
            {RECORD_TAB_LABELS[key]}
            {count !== null && count > 0 ? (
              <span className="cx-tab-count">{count}</span>
            ) : null}
          </a>
        ))}
      </nav>
      <div className="record-tab cw-body">
        {tab === "overview" ? (
          <>
            <AttentionPanel
              attention={attention}
              ids={ids}
              hrefs={tabHrefs}
              canAct={canAct}
            />
            <AgentRoster lanes={lanes} hrefs={tabHrefs} />
            <ApproachLine approach={approach} />
            <section className="cw-recent" aria-labelledby="cw-recent-title">
              <h2 id="cw-recent-title">Recent activity</h2>
              <ActivityTimeline
                items={engagement.activity}
                limit={5}
                moreHref={tabHrefs.activity}
              />
            </section>
          </>
        ) : null}
        {tab === "design" ? (
          <>
            <AboutControl control={control} />
            <ReadinessPanel readiness={context?.readiness ?? null} />
            <PhasePanel
              number={1}
              title="Design and walkthrough"
              state={lifeState("design")}
              summary="Confirm the control exists as described and is designed to address the risk: what the tester checks, how the process runs where it is needed, and the walkthrough of one instance in the design workpaper."
              task={taskOf("walkthrough")}
            >
              <PhaseStep
                number={1}
                title="Definition and attributes"
                hint="What the tester checks for each sample. The attributes belong to the control: from the library, the client's RCM, or the team, and proposed by the agent from the sources for you to approve."
                state={attributesState}
                note={
                  context === null
                    ? undefined
                    : context.proposed.length > 0
                      ? `${context.proposed.length} proposed`
                      : `${context.approved.length} approved`
                }
              >
                {context === null ? (
                  <p className="form-hint">
                    The control's context could not be loaded.
                  </p>
                ) : (
                  <>
                    {context.design !== null ? (
                      <DesignPanel
                        ids={ids}
                        design={context.design}
                        canAct={canAct}
                      />
                    ) : null}
                    <AttributesPanel
                      ids={ids}
                      context={context}
                      canAct={canAct}
                    />
                  </>
                )}
              </PhaseStep>
              <PhaseStep
                number={2}
                title="Process understanding"
                hint={
                  context?.processRequired === true
                    ? "How the process runs and where this control operates in it. Built from the RCM and any supporting documents; each step says whether a source states it or it is inferred. Testing waits until you confirm it."
                    : "Needed only for business process controls. This one is defined by its own criteria and configuration."
                }
                state={processState}
                note={
                  context === null
                    ? undefined
                    : !context.processRequired
                      ? "Not needed"
                      : context.understanding.status === "CONFIRMED"
                        ? "Confirmed"
                        : context.understanding.status === "DRAFT"
                          ? "Draft"
                          : "Not started"
                }
              >
                {context === null ? null : (
                  <ProcessPanel ids={ids} context={context} canAct={canAct} />
                )}
              </PhaseStep>
              <PhaseStep
                number={3}
                title="Supporting documents"
                hint="Optional: a narrative, policy, procedure, flowchart, walkthrough notes, or system documentation. One document can support several controls; the agent reviews it against the control and proposes changes."
                state={
                  context === null || context.documents.length === 0
                    ? "todo"
                    : context.documents.every((item) => item.reviewed)
                      ? "done"
                      : "active"
                }
                note={
                  context === null || context.documents.length === 0
                    ? "Optional"
                    : `${context.documents.length} linked`
                }
              >
                {context === null ? null : (
                  <DocumentsPanel
                    ids={ids}
                    context={context}
                    canAct={canAct}
                    controls={(engagement.controls ?? [])
                      .filter((item) => item.included)
                      .map((item) => ({
                        id: item.id,
                        label: item.label || item.controlRef,
                      }))}
                  />
                )}
              </PhaseStep>
              <PhaseStep
                number={4}
                title="Walkthrough and design workpaper"
                hint="The agent writes the understanding of the control and the walkthrough of one instance from the evidence as soon as the first file has been read; you complete the design attributes and the conclusion, then prepare it."
                state={lifeState("design")}
                keepOpen={keepWorkpaper}
              >
                <WorkpapersTab {...workpaperProps} stage="DESIGN" />
              </PhaseStep>
            </PhasePanel>
          </>
        ) : null}
        {tab === "evidence" ? (
          <EvidenceWorkspace
            ids={ids}
            plan={evidencePlan}
            canAct={canAct}
            summary={evidenceSummary(
              evidencePlan,
              control.requests,
              engagement.files,
            )}
            proposals={evidenceProposals(evidencePlan)}
            actions={evidence}
            focus={{
              view: engagement.filters.evidenceView ?? null,
              request: focusRow?.id ?? null,
            }}
            tabHref={tabHrefs.evidence}
            lanes={lanes.filter(
              (lane) => lane.key === "requests" || lane.key === "reader",
            )}
            files={(engagement.files?.files ?? []).map((file) => ({
              id: file.id,
              fileName: file.fileName,
              requestId: file.request?.id ?? null,
            }))}
            requests={
              <EvidenceRequests
                model={model}
                control={control}
                tabHref={tabHrefs.evidence}
                focus={focusRow?.id ?? null}
                review={requestReview}
                rows={requestRows(
                  control.requests,
                  evidencePlan,
                  engagement.files,
                )}
              />
            }
            library={
              <ControlEvidence
                model={model}
                control={control}
                files={engagement.files}
                notice={engagement.changeNotice}
                serves={fileServes(evidencePlan)}
              />
            }
            rcmItems={control.pbcItems}
          />
        ) : null}
        {tab === "testing" ? (
          <>
            <PhasePanel
              number={1}
              title="Interim testing"
              state={lifeState("interim")}
              summary="Operating effectiveness up to the interim date: a sample from a population you accepted as complete, the agent's test of every item against every attribute with the passage it relied on, your decisions and sign-off, and the interim workpaper."
              task={taskOf("test")}
              aside={<PlanChip plan={planPhase("INTERIM")} />}
            >
              {test !== null || sheet?.method !== "TEST_OF_ONE" ? (
                <PhaseStep
                  number={1}
                  title="Population and sample"
                  hint="The agent checks the population and proposes the sample; you approve it before anything is tested."
                  state={
                    test === null
                      ? "todo"
                      : test.status === "APPROVED"
                        ? "done"
                        : "active"
                  }
                  note={
                    test === null
                      ? undefined
                      : `${test.samples.length} ${test.status === "APPROVED" ? "approved" : "proposed"}`
                  }
                  keepOpen={engagement.testNotice !== null}
                >
                  <TestPlanCard
                    test={test}
                    notice={engagement.testNotice}
                    organizationId={model.organization.id}
                    projectId={model.selectedProject?.id ?? ""}
                    controlId={control.id}
                    canAct={canRequestEvidence(model.organization.role)}
                    sampled={control.nature !== "AUTOMATED"}
                    blocked={
                      context?.readiness !== null &&
                      context?.readiness !== undefined &&
                      BLOCKING_STATES.includes(context.readiness.state)
                        ? `Not ready for testing: ${context.readiness.label.toLowerCase()}. See Readiness on the Control & design tab.`
                        : null
                    }
                  />
                </PhaseStep>
              ) : null}
              <PhaseStep
                number={2}
                title="Test results and sign-off"
                hint="The agent tests each item against each attribute from the evidence and cites the passage it relied on. Its results are proposals: you decide the open ones and sign the testing off."
                state={
                  control.sheetStatus === "SIGNED_OFF"
                    ? "done"
                    : control.sheetStatus === "OPEN"
                      ? "active"
                      : "todo"
                }
                note={
                  sheet === null
                    ? undefined
                    : sheet.status === "SIGNED_OFF"
                      ? `Signed off${sheet.signedBy ? ` by ${sheet.signedBy}` : ""}`
                      : `${sheet.counts.tested} of ${sheet.items.length} tested`
                }
                keepOpen={engagement.sheetNotice !== null}
              >
                <TestSheetCard
                  sheet={sheet}
                  notice={engagement.sheetNotice}
                  ids={ids}
                  canAct={canAct}
                />
              </PhaseStep>
              <PhaseStep
                number={3}
                title="Interim workpaper"
                hint="Filled from the records: population, sample, the testing matrix, exceptions, and the conclusion derived from the sign-off. The agent drafts the narratives; you prepare it."
                keepOpen={keepWorkpaper}
                state={
                  engagement.workpapers?.some(
                    (paper) =>
                      paper.stage === "EFFECTIVENESS" &&
                      paper.status === "PREPARED",
                  ) === true
                    ? "done"
                    : engagement.workpapers?.some(
                          (paper) => paper.stage === "EFFECTIVENESS",
                        ) === true
                      ? "active"
                      : "todo"
                }
              >
                <WorkpapersTab
                  {...workpaperProps}
                  stage="EFFECTIVENESS"
                  initial="interim"
                />
              </PhaseStep>
            </PhasePanel>
            <PhasePanel
              number={2}
              title="Roll-forward and retests"
              state={lifeState("rollforward")}
              summary="From the interim date to period end: the owner evidences what changed and sends the remaining population, the agent tests an update sample from the remaining period only, and a deficiency fixed during the period is retested from after the fix."
              aside={<PlanChip plan={planPhase("ROLLFORWARD")} />}
            >
              <PhaseStep
                number={1}
                title="Rounds"
                hint="A roll-forward starts when interim testing is signed off effective; a retest when a deficiency is marked ready. Each round has its own request, sample, and test sheet."
                state={lifeState("rollforward")}
                note={
                  rounds.length === 0
                    ? undefined
                    : `${rounds.length} round${rounds.length === 1 ? "" : "s"}`
                }
              >
                {rounds.length === 0 ? (
                  <p className="sheet-empty">
                    <UiIcon name="clock" size={16} />
                    <span>
                      {planPhase("ROLLFORWARD")?.applicability ===
                      "NOT_APPLICABLE"
                        ? "No roll-forward: the evidence plan says why it does not apply."
                        : control.sheetStatus === "SIGNED_OFF"
                          ? "No roll-forward round yet. One starts when interim testing is signed off effective."
                          : "The roll-forward round starts once interim testing is signed off effective. Its evidence is already planned on the Evidence tab."}
                    </span>
                  </p>
                ) : (
                  <TestRounds
                    rounds={rounds}
                    tests={engagement.tests}
                    sheets={engagement.sheets}
                    ids={ids}
                    canAct={canAct}
                    today={new Date().toISOString().slice(0, 10)}
                  />
                )}
              </PhaseStep>
              <PhaseStep
                number={2}
                title="Roll-forward workpaper"
                hint="The roll-forward tab of the testing workpaper: changes since interim, the update sample, its testing, and the conclusion for the whole period."
                state={rounds.length === 0 ? "todo" : lifeState("rollforward")}
                keepOpen={keepWorkpaper}
              >
                <WorkpapersTab
                  {...workpaperProps}
                  stage="EFFECTIVENESS"
                  initial="rollforward"
                />
              </PhaseStep>
            </PhasePanel>
          </>
        ) : null}
        {tab === "findings" ? (
          <>
            {figures.findings.potential > 0 ? (
              <section className="cw-potential">
                <h2>
                  Potential exceptions from testing
                  <span className="cw-ai">AI</span>
                </h2>
                <p>
                  The tester found{" "}
                  {figures.findings.potential === 1
                    ? "an exception"
                    : `${figures.findings.potential} exceptions`}{" "}
                  that no person has confirmed. They are not audit findings
                  until a person decides them on the test sheet and logs a
                  deficiency.
                </p>
                <a
                  className="cw-open"
                  href={`${tabHrefs.testing}#${stepAnchor("Test results and sign-off")}`}
                >
                  Decide them on the test sheet
                  <UiIcon name="arrow" size={13} />
                </a>
              </section>
            ) : null}
            <section className="cw-plain">
              <h2>Deficiencies logged</h2>
              <FindingsTab
                model={model}
                control={control}
                findings={findings}
              />
            </section>
          </>
        ) : null}
        {tab === "review" ? (
          <>
            <PhasePanel
              number={1}
              title="Independent review"
              state={lifeState("review")}
              summary="Once the testing workpaper is prepared, the independent reviewer agent re-performs the testing against the evidence and proposes review notes; a reviewer who did not test or prepare decides each note and signs the control off."
              task={taskOf("review")}
            >
              <PhaseStep
                number={1}
                title="Review"
                hint="The agent's re-performance, the notes, and the reviewer's sign-off."
                state={lifeState("review")}
                note={
                  review === null
                    ? undefined
                    : `${openNotes(review).length} open note${openNotes(review).length === 1 ? "" : "s"}`
                }
              >
                <ReviewTab
                  review={review}
                  sheet={sheet}
                  notice={engagement.reviewNotice}
                  ids={ids}
                  canAct={canAct}
                />
              </PhaseStep>
            </PhasePanel>
            <section className="cw-plain cw-conclusion">
              <h2>Conclusion</h2>
              {control.conclusion === "NOT_CONCLUDED" ? (
                <p>
                  Not concluded. A control is concluded only when its review is
                  signed off by the independent reviewer; an agent can draft,
                  never conclude.
                </p>
              ) : (
                <p>
                  <strong>
                    {control.conclusion === "EFFECTIVE"
                      ? "Effective"
                      : "Concluded with exceptions"}
                  </strong>
                  , on the signed-off review
                  {review?.signedBy ? ` by ${review.signedBy}` : ""}.
                </p>
              )}
            </section>
          </>
        ) : null}
        {tab === "activity" ? (
          <section className="cw-plain">
            <h2>Activity</h2>
            <p className="cw-hint">
              Everything recorded about this control and its records, from the
              audit trail: agents' work, people's decisions, and the workspace's
              own steps.
            </p>
            <ActivityTimeline items={engagement.activity} />
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** What the control is: its activity, the risk it addresses, and its facts. */
function AboutControl({ control }: { control: ControlRow }) {
  return (
    <section className="cw-plain cw-about">
      <h2>About the control</h2>
      <p className="cx-lead">{control.activity}</p>
      {control.risk !== "" ? (
        <div className="cx-risk">
          <UiIcon name="risk" size={16} />
          <div>
            <h3>Risk addressed</h3>
            <p>{control.risk}</p>
          </div>
        </div>
      ) : null}
      <dl className="cw-facts">
        <div>
          <dt>Type</dt>
          <dd>{CATEGORY_LABEL[control.category] ?? control.category}</dd>
        </div>
        <div>
          <dt>Area</dt>
          <dd>{control.area}</dd>
        </div>
        <div>
          <dt>Nature</dt>
          <dd>{sentence(natureText(control))}</dd>
        </div>
        <div>
          <dt>Frequency</dt>
          <dd>{sentence(frequencyText(control))}</dd>
        </div>
        <div>
          <dt>Sample size</dt>
          <dd>{control.sampleSize}</dd>
        </div>
        <div>
          <dt>Control owner</dt>
          <dd>
            {control.ownerName || "PBC coordinator"}
            {control.ownerEmail ? <small>{control.ownerEmail}</small> : null}
          </dd>
        </div>
        <div>
          <dt>Systems</dt>
          <dd>
            {control.systems.length === 0 ? "None" : control.systems.join(", ")}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/** Where a phase's evidence plan stands, beside the phase's title. */
function PlanChip({ plan }: { plan: PlanPhase | null }) {
  return plan === null ? null : (
    <span
      className={`cx-status ${PHASE_STATE_TONES[plan.state]}`}
      title="Evidence plan"
    >
      {plan.stateLabel}
    </span>
  );
}

const PHASE_WORDS: Record<string, string> = {
  DESIGN: "Design",
  INTERIM: "Interim",
  ROLLFORWARD: "Roll-forward",
  RETEST: "Retest",
  REMEDIATION: "Remediation",
};

/** The control's requests across phases: what each carries, its due date and status,
 * the files that came back, and where to add one. Sending is approved on the Evidence
 * page; nothing goes to the owner from here. */
function EvidenceRequests({
  model,
  control,
  tabHref,
  focus,
  review,
  rows,
}: {
  model: Ready;
  control: ControlRow;
  /** The Evidence tab's address, for each request's own link. */
  tabHref: string;
  /** The request opened for review, and its panel. */
  focus: string | null;
  review: ReactNode;
  rows: RequestRow[];
}) {
  const canUpload =
    canRequestEvidence(model.organization.role) &&
    model.selectedProject?.status === "ACTIVE";
  const blocked = uploadBlocked(
    model.selectedProject?.status ?? "",
    model.organization.role,
  );
  const drafted = rows.filter((row) => row.status === "DRAFT").length;
  return (
    <div className="stack">
      {blocked !== null ? (
        <p className="upload-blocked" role="status">
          <UiIcon name="info" size={15} />
          <span>{blocked}</span>
        </p>
      ) : null}
      {review}
      {rows.length === 0 ? (
        <p className="form-hint">
          No requests yet. They are made from the evidence plan.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table data-grid ew-requests">
            <thead>
              <tr>
                <th scope="col">Phase</th>
                <th scope="col">Request</th>
                <th scope="col" className="col-date">
                  Due
                </th>
                <th scope="col" className="col-status">
                  Status
                </th>
                <th scope="col">Files</th>
                <th scope="col" className="col-open">
                  <span className="sr-only">Review</span>
                </th>
                {canUpload ? (
                  <th scope="col" className="col-upload">
                    <span className="sr-only">Add evidence</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((request) => (
                <tr
                  key={request.id}
                  className={request.id === focus ? "is-open" : undefined}
                  aria-current={request.id === focus ? "true" : undefined}
                >
                  <td className="cell-muted">
                    {PHASE_WORDS[request.phase ?? "INTERIM"] ?? request.phase}
                  </td>
                  <td className="cell-title">
                    <span title={request.title}>{request.title}</span>
                    {request.carries.length > 0 ? (
                      <small
                        className="ew-carries"
                        title={request.carries.join("\n")}
                      >
                        {request.carries.length} planned item
                        {request.carries.length === 1 ? "" : "s"}:{" "}
                        {request.carries.join("; ")}
                      </small>
                    ) : (
                      <small className="ew-carries">
                        {REQUEST_KIND[request.kind]}
                      </small>
                    )}
                  </td>
                  <td className="col-date cell-muted">
                    {formatDate(request.dueAt)}
                  </td>
                  <td className="col-status">
                    {(() => {
                      const stage =
                        REQUEST_STAGES[requestStage(request, control)];
                      return (
                        <span
                          className={`pill pill-dot ${
                            stage.tone === "done"
                              ? "tone-success"
                              : stage.tone === "warn"
                                ? "tone-warning"
                                : stage.tone === "info"
                                  ? "tone-info"
                                  : ""
                          }`}
                        >
                          {stage.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="cell-muted">{request.files}</td>
                  <td className="col-open">
                    {request.id === focus ? (
                      <span className="ew-open-now">Open</span>
                    ) : (
                      <a
                        className="text-link"
                        href={evidenceHref(tabHref, {
                          view: "requests",
                          request: request.id,
                        })}
                        aria-label={`Review ${request.title}`}
                      >
                        Review
                      </a>
                    )}
                  </td>
                  {canUpload ? (
                    <td className="col-upload">
                      {request.status !== "CANCELLED" &&
                      request.status !== "CLOSED" ? (
                        <RequestUpload
                          organizationId={model.organization.id}
                          projectId={model.selectedProject?.id ?? ""}
                          requestId={request.id}
                          label={request.title}
                        />
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="form-hint">
        {drafted > 0
          ? `Open a request to review it, approve it, and send it, here. ${drafted} drafted request${drafted === 1 ? " waits" : "s wait"} for review. `
          : "Open a request to see where it stands and what comes next. "}
        Nothing is sent to the owner before a person approves it.{" "}
        <a className="text-link" href={href(model, {}, "evidence")}>
          Every control's requests and replies are on the Evidence page.
        </a>
      </p>
    </div>
  );
}

const CONCLUSION_LABELS: Record<string, { label: string; tone: string }> = {
  NO_EXCEPTION: { label: "No exception proposed", tone: "tone-success" },
  EXCEPTION: { label: "Exception proposed", tone: "tone-danger" },
  CANNOT_CONCLUDE: { label: "Cannot conclude yet", tone: "tone-warning" },
};

/** The control's evidence files, each with what the agents read and found in it. */
function ControlEvidence({
  model,
  control,
  files,
  notice,
  serves,
}: {
  model: Ready;
  control: ControlRow;
  files: ControlFiles | null;
  notice: ChangeNotice | null;
  /** The plan requirements each file serves (evidence-workspace-model.fileServes). */
  serves?: Map<string, Array<{ label: string; via: "REQUEST" | "LINK" }>>;
}) {
  if (files === null) {
    return null;
  }
  const canAct =
    canRequestEvidence(model.organization.role) &&
    model.selectedProject?.status === "ACTIVE";
  const reading = files.files.some(
    (file) => file.state === "READING" || isReading(file),
  );
  const keep = { section: "controls", control: control.id, tab: "evidence" };
  return (
    <section className="control-evidence" aria-label="Evidence received">
      {reading ? <AutoRefresh /> : null}
      {notice !== null ? (
        <p
          className={`banner ${changeNoticeOk(notice) ? "" : "banner-warning"}`}
          role="status"
        >
          <UiIcon name="info" size={15} />
          <span>{CHANGE_NOTICES[notice]}</span>
        </p>
      ) : null}
      <h4>
        Evidence received
        <span className="view-count">{files.files.length}</span>
        {reading ? (
          <span className="pill pill-dot tone-info">
            <span className="spinner small" aria-hidden="true" /> The agents are
            reading new files
          </span>
        ) : null}
      </h4>
      {files.files.length === 0 ? (
        <p className="form-hint">
          No files yet. Add evidence to a request above, or drop a folder on the
          Evidence page.
        </p>
      ) : (
        <div className="app-groups">
          {byApplicationOf(
            files.files,
            files.applications,
            control.applicationName,
          ).map((group) => {
            const status =
              group.key === "unknown" ||
              group.key === "all" ||
              group.key === "elsewhere" ||
              group.key === "rest"
                ? undefined
                : control.byApplication[group.label];
            return (
              <section
                key={group.key}
                className={`app-group app-${group.key === "unknown" ? "unknown" : "known"}`}
              >
                <h5>
                  <span>{group.label}</span>
                  <span className="view-count">{group.files.length}</span>
                  {status?.result === "PASS" ? (
                    <span className="pill pill-dot tone-success">
                      Tested · pass
                    </span>
                  ) : status?.result === "EXCEPTION" ? (
                    <span className="pill pill-dot tone-danger">
                      Tested · exception
                    </span>
                  ) : status?.result === "OPEN" ? (
                    <span className="pill pill-dot tone-warning">
                      Testing open
                    </span>
                  ) : null}
                  {group.key === "unknown" ? (
                    <small>
                      Set the application on each file so it is tested with the
                      right one.
                    </small>
                  ) : group.key === "all" ? (
                    <small>Used as evidence for every application.</small>
                  ) : group.key === "elsewhere" ? (
                    <small>
                      Uploaded here, but tested with the application each file
                      shows. Change it if it is wrong.
                    </small>
                  ) : null}
                </h5>
                {group.files.length === 0 ? (
                  <p className="form-hint app-empty">
                    No evidence for this application yet.
                  </p>
                ) : (
                  <ul className="evidence-files">
                    {group.files.map((file) => {
                      const analysis = analysisFor(files.analyses, file.id);
                      const review = reviewFor(files.reviews, file.id);
                      const status = agentStatus(file);
                      const verdict =
                        review === null
                          ? null
                          : (CONCLUSION_LABELS[
                              review.conclusion ?? review.proposed
                            ] ?? null);
                      const summary =
                        review?.feedback ||
                        analysis?.classification?.summary ||
                        (status.label === "Reading"
                          ? "The evidence coordinator is reading this file."
                          : "");
                      return (
                        <li key={file.id}>
                          <details className="evidence-file">
                            <summary>
                              <span className="evidence-file-head">
                                <strong title={file.fileName}>
                                  {file.fileName}
                                </strong>
                                <PreviewButton
                                  organizationId={model.organization.id}
                                  projectId={model.selectedProject?.id ?? ""}
                                  files={files.files.map((entry) => ({
                                    id: entry.id,
                                    fileName: entry.fileName,
                                  }))}
                                  startFileId={file.id}
                                  title={`${control.controlRef}: evidence`}
                                  className="btn-secondary btn-sm preview-open"
                                  label={
                                    <>
                                      <UiIcon name="grid" size={13} /> Preview
                                    </>
                                  }
                                />
                                <span className="evidence-file-pills">
                                  {file.kindLabel !== null ? (
                                    <span className="pill">
                                      {file.kindLabel}
                                    </span>
                                  ) : null}
                                  {verdict !== null ? (
                                    <span
                                      className={`pill pill-dot ${verdict.tone}`}
                                    >
                                      {review?.conclusion !== null
                                        ? "Signed off · "
                                        : ""}
                                      {verdict.label}
                                    </span>
                                  ) : (
                                    <span
                                      className={`pill pill-dot ${TONE_CLASS[status.tone]}`}
                                    >
                                      {status.label === "Reading" ? (
                                        <span
                                          className="spinner small"
                                          aria-hidden="true"
                                        />
                                      ) : null}
                                      {status.label}
                                    </span>
                                  )}
                                </span>
                              </span>
                              {summary !== "" ? (
                                <span className="evidence-file-summary">
                                  {summary}
                                </span>
                              ) : null}
                              {serves !== undefined ? (
                                <span className="evidence-file-serves">
                                  {(serves.get(file.id) ?? []).length === 0
                                    ? "Serves no planned item yet"
                                    : `Serves: ${(serves.get(file.id) ?? [])
                                        .map(
                                          (item) =>
                                            `${item.label}${item.via === "LINK" ? " (linked)" : ""}`,
                                        )
                                        .join("; ")}`}
                                </span>
                              ) : null}
                              <span className="evidence-file-meta">
                                {file.source === "MAILBOX"
                                  ? "By email"
                                  : `Added by ${file.addedBy}`}{" "}
                                · {formatDate(file.createdAt)}
                                {analysis !== null &&
                                analysis.classification !== null
                                  ? ` · ${analysis.classification.gaps.length} follow-up point${analysis.classification.gaps.length === 1 ? "" : "s"}`
                                  : ""}
                              </span>
                            </summary>
                            <div className="evidence-file-body">
                              {canAct && files.applications.length > 1 ? (
                                <form
                                  autoComplete="off"
                                  method="post"
                                  action="/workspace/evidence-application"
                                  className="inline-form app-form"
                                >
                                  <input
                                    type="hidden"
                                    name="organization_id"
                                    value={model.organization.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="project_id"
                                    value={model.selectedProject?.id ?? ""}
                                  />
                                  <input
                                    type="hidden"
                                    name="control_id"
                                    value={control.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="file_id"
                                    value={file.id}
                                  />
                                  <label htmlFor={`app-${file.id}`}>
                                    Application
                                  </label>
                                  <select
                                    id={`app-${file.id}`}
                                    name="application"
                                    defaultValue={
                                      file.applicationScope === "ALL"
                                        ? "ALL"
                                        : (file.application?.id ?? "")
                                    }
                                    required
                                  >
                                    <option value="" disabled>
                                      Choose the application it shows
                                    </option>
                                    {files.applications.map((app) => (
                                      <option key={app.id} value={app.id}>
                                        {app.name}
                                      </option>
                                    ))}
                                    <option value="ALL">
                                      All applications (such as a policy)
                                    </option>
                                  </select>
                                  <button
                                    type="submit"
                                    className="btn-secondary btn-sm"
                                  >
                                    Save
                                  </button>
                                  <small className="form-hint">
                                    {file.applicationBy === "PERSON"
                                      ? "Set by a person."
                                      : "Suggested by the evidence coordinator."}
                                  </small>
                                </form>
                              ) : null}
                              <AnalysisPanel
                                analysis={analysis}
                                review={review}
                                organizationId={model.organization.id}
                                projectId={model.selectedProject?.id ?? ""}
                                canAct={canAct}
                                keep={keep}
                              />
                              <div className="evidence-file-tools">
                                <a
                                  className="btn btn-secondary btn-sm"
                                  href={`/workspace/evidence-files/${file.id}?organization=${model.organization.id}&project=${model.selectedProject?.id ?? ""}`}
                                >
                                  Download
                                </a>
                                {canAct ? (
                                  <FileChanges
                                    organizationId={model.organization.id}
                                    projectId={model.selectedProject?.id ?? ""}
                                    fileId={file.id}
                                    fileName={file.fileName}
                                    blocked={changeBlocked(file)}
                                    controlId={control.id}
                                  />
                                ) : null}
                              </div>
                            </div>
                          </details>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

const TONE_CLASS: Record<string, string> = {
  neutral: "",
  info: "tone-info",
  success: "tone-success",
  warning: "tone-warning",
  danger: "tone-danger",
};

function FindingsTab({
  model,
  control,
  findings,
}: {
  model: Ready;
  control: ControlRow;
  findings: Deficiency[];
}) {
  return (
    <div className="stack">
      {findings.length === 0 ? (
        <p className="form-hint">No findings on this control.</p>
      ) : (
        <table className="table data-grid">
          <thead>
            <tr>
              <th scope="col" className="col-id">
                Ref
              </th>
              <th scope="col">Finding</th>
              <th scope="col" className="col-status">
                Status
              </th>
              <th scope="col" className="col-status">
                Severity
              </th>
            </tr>
          </thead>
          <tbody>
            {findings.map((item) => (
              <tr key={item.id}>
                <td className="col-id mono">{item.reference}</td>
                <td className="cell-title">
                  <a
                    href={href(model, { deficiency: item.id }, "deficiencies")}
                  >
                    {item.title}
                  </a>
                </td>
                <td className="cell-muted">
                  {FINDING_STATUS[item.status] ?? item.status}
                </td>
                <td>
                  <span
                    className={`pill pill-dot ${SEVERITY_TONE[item.severity]}`}
                  >
                    {SEVERITY_LABEL[item.severity]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <a
        className="btn btn-secondary btn-sm"
        href={href(model, { new: control.id }, "deficiencies")}
      >
        <UiIcon name="plus" size={14} /> Log a deficiency
      </a>
    </div>
  );
}
