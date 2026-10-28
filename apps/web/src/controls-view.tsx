import type { ReactNode } from "react";
import { agentSays, reviewForStep, sheetForStep } from "./agent-says-model";
import { analysisFor, reviewFor } from "./analysis-model";
import { AnalysisPanel } from "./analysis-view";
import { AppIdentity } from "./app-identity";
import { assistantBrief, stepAnchor } from "./assistant-model";
import { AutoRefresh } from "./auto-refresh";
import { BLOCKING_STATES, CLASSIFICATIONS } from "./control-context-model";
import {
  AttributesPanel,
  Classifications,
  DesignPanel,
  DocumentActions,
  DocumentsPanel,
  ProcessPanel,
} from "./control-context-view";
import {
  blockersOf,
  currentStep,
  needsYou,
  phaseItems,
  STEP_TABS,
  STEPS,
  stepForTab,
  stepperItems,
} from "./control-journey-model";
import { PhasePanel, type PhaseState, PhaseStep } from "./control-phases";
import {
  type AssistantAction,
  ControlAssistant,
  ControlBar,
  ControlContextCard,
  EvidenceSummaryCard,
  GoverningDocumentsCard,
  PlanVersionsCard,
  RecordMenu,
} from "./control-rail";
import {
  activitiesOn,
  contextRows,
  controlDocuments,
  exampleAnswers,
  GOVERNING_KINDS,
  governingDocuments,
  lowestConfidence,
  openSection,
  type RecordSection,
  relatedControls,
  stepPosition,
} from "./control-rail-model";
import { ControlStepper } from "./control-stepper";
import {
  ActivityTimeline,
  ControlHistory,
  TestPlanSummary,
} from "./control-workspace";
import {
  type AttentionItem,
  agentLanes,
  approachOf,
  attentionOf,
  attributeFoldLabel,
  definitionWork,
  figuresOf,
  lifecycleOf,
  nextActionOf,
  summaryMetrics,
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
  actionCenterFromQueue,
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
import { CoverageForm } from "./coverage-form";
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
  REQUEST_STAGES,
  requestStage,
} from "./evidence-flow";
import { RequestUpload } from "./evidence-intake";
import { EvidenceMappingPanel } from "./evidence-mapping-view";
import {
  agentStatus,
  byApplicationOf,
  isReading,
  uploadBlocked,
} from "./evidence-model";
import {
  PHASE_STATE_SHORT,
  type Phase,
  populationWaiting,
  stepStateOf,
} from "./evidence-plan-model";
import { PreviewButton } from "./evidence-preview";
import {
  proposals as evidenceProposals,
  evidenceSummary,
  fileServes,
  placedFiles,
  type RequestRow,
  requestReference,
  requestRows,
  requestsByPhase,
} from "./evidence-workspace-model";
import { EvidenceWorkspace } from "./evidence-workspace-view";
import { formatDate } from "./format";
import { HashScroll } from "./hash-scroll";
import { impactFor } from "./impact-model";
import { ImpactPanel } from "./impact-panel";
import {
  evidenceSummary as planEvidenceSummary,
  planningHref,
  planVersions,
} from "./planning-model";
import { PlanReview, type PlanWorkspace } from "./planning-view";
import { ControlPriorYear } from "./references-view";
import { RequestReview } from "./request-review";
import {
  reviewFor as controlReviewFor,
  openNotes,
  roundReviewsFor,
} from "./review-model";
import { ReviewTab } from "./review-view";
import { roundsFor } from "./round-model";
import { RoundReviews } from "./round-reviews";
import { TestRounds } from "./round-view";
import { canonicalQuery, placeSetup } from "./routes";
import { RowMenu, type RowMenuItem } from "./row-menu";
import { sheetFor } from "./sheet-model";
import { TestSheetCard } from "./sheet-view";
import type { ShellModel } from "./shell-model";
import { canManageProjects } from "./shell-model";
import { TestBasisCard } from "./test-basis-view";
import { testFor } from "./testing-model";
import { TestPlanCard } from "./testing-view";
import { type TraceRound, traceOf, traceRows } from "./trace-model";
import { UiIcon } from "./ui-icon";
import { canDecide, canRequestEvidence } from "./workflow-model";
import { WorkpapersTab } from "./workpaper-view";
import { EmptyState, PageHeader, sectionHref } from "./workspace-view";

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
  // An older section name (deficiencies) lands on its destination directly, and setup
  // where it lives for the engagement.
  canonicalQuery(params);
  placeSetup(params, model.selectedProject?.status ?? null);
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
  embedded = false,
}: {
  model: Ready;
  engagement: EngagementState;
  /** Inside the Systems & Processes page's Controls tab, under that page's header. */
  embedded?: boolean;
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
      embedded={embedded}
    />
  );
}

// The register

/** The register's title and actions: a page header of its own, or under the Systems &
 * Processes page's header a line with the same summary and actions. */
function RegisterHead({
  embedded,
  context,
  description,
  actions,
}: {
  embedded: boolean;
  context: string | undefined;
  description: string;
  actions: ReactNode;
}) {
  if (!embedded) {
    return (
      <PageHeader
        context={context}
        title="Controls"
        description={description}
        actions={actions}
      />
    );
  }
  return (
    <div className="cr-embedded-head">
      <p>{description}</p>
      {actions}
    </div>
  );
}

function ControlRegister({
  model,
  engagement,
  inScope,
  shown,
  keep,
  embedded,
}: {
  model: Ready;
  engagement: EngagementState;
  inScope: ControlRow[];
  shown: ControlRow[];
  keep: Keep;
  embedded: boolean;
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
  const actions = actionCenterFromQueue(
    engagement.work?.items ?? [],
    inScope,
    canSubmit,
  );
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
          : item.to.kind === "queue"
            ? href(model, { filter: item.to.filter }, "overview")
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
    <div
      className={`${embedded ? "" : "page "}register-page cr co${embedded ? " is-embedded" : ""}`}
    >
      {view.layout === "applications" ? (
        <LayoutMemory
          tableHref={registerHref(base, view, { layout: "table" })}
        />
      ) : null}
      <RegisterHead
        embedded={embedded}
        context={project?.name}
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
            {control.units !== "" ? (
              <span className="cr-where">{control.units}</span>
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
  // The guided workspace is the control's one interface (M2d). The step comes from
  // the API's journey or from ?step=; an older link's ?tab= opens the step that holds
  // that tab's work, and ?tab=activity opens the activity record below the steps.
  const journey = control.journey ?? null;
  const legacyTab =
    engagement.filters.tab === null
      ? null
      : detailTab(control, engagement.filters.tab);
  const guided = true;
  const step = currentStep(
    journey,
    engagement.filters.step ??
      (legacyTab === null ? null : stepForTab(legacyTab).toLowerCase()),
  );
  const tab = STEP_TABS[step];
  const showActivity = legacyTab === "activity";
  const tasks = (engagement.plan?.tasks ?? []).filter(
    (task) => task.controlId === control.id,
  );
  const findings = (engagement.deficiencies ?? []).filter(
    (item) => item.controlId === control.id,
  );
  const test = testFor(engagement.tests, control.id);
  const review = controlReviewFor(engagement.reviews, control.id);
  // Milestone 1b: the plan-revision impact assessments, the rounds' own reviews, and
  // the coverage gaps the journey reports, surfaced in the steps they belong to.
  const impact = impactFor(engagement.impact ?? null, control.id);
  const pendingImpact = impact.filter(
    (item) => item.status === "PENDING",
  ).length;
  const decideImpact = impact.some(
    (item) => item.status === "PENDING" && item.viewerCanDecide,
  );
  const roundReviews = roundReviewsFor(engagement.reviews, control.id);
  const reasons = control.notFinalBecause ?? [];
  const coverageGaps = {
    control:
      reasons.find(
        (text) =>
          /review/i.test(text) &&
          /changed since|did not record|after the review/i.test(text) &&
          !/^(Roll-forward|Retest|The roll-forward|The retest)/.test(text),
      ) ?? "",
    "roll-forward":
      reasons.find((text) =>
        /^(Roll-forward|The roll-forward) .*review/i.test(text),
      ) ?? "",
    retest:
      reasons.find((text) => /^(Retest|The retest) .*review/i.test(text)) ?? "",
  };
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
    automation: engagement.automation ?? null,
  };
  const stages = lifecycleOf(input);
  const lanes = agentLanes(input);
  const approach = approachOf(input, CLASSIFICATION_LABELS);
  const figures = figuresOf(input, stages);
  const stage = stageText(control, engagement.automation ?? null);
  const link = nextStepLink(control);
  const who = control.yours ? "You" : ACTOR_LABELS[control.actor];
  // Work done on another page links there directly: the evidence plan is approved
  // with the test plan, on its Evidence tab.
  const attention = attentionOf(brief, control, control.yours ? "" : who).map(
    (item): AttentionItem =>
      item.page === "test-plan"
        ? {
            ...item,
            href: planningHref(ids.organizationId, ids.projectId, {
              control: control.id,
              tab: "evidence",
            }),
            hrefLabel: "Review the test plan",
          }
        : item,
  );
  const tabHrefs = Object.fromEntries(
    DETAIL_TABS.map((key) => [
      key,
      href(model, { ...keep, control: control.id, tab: key }),
    ]),
  ) as Record<DetailTab, string>;
  // The guided workspace's steps; a step link carries no classic tab.
  const stepHrefs = Object.fromEntries(
    STEPS.map((key) => [
      key,
      href(model, {
        ...keep,
        control: control.id,
        tab: null,
        step: key.toLowerCase(),
      }),
    ]),
  ) as Record<(typeof STEPS)[number], string>;
  // Milestone 1c: the agent block for the open step and the trace rail, both read from
  // the records above; nothing here decides or derives state.
  const controlSheets = (engagement.sheets ?? []).filter(
    (item) => item.controlId === control.id,
  );
  const controlReviews = (engagement.reviews ?? []).filter(
    (item) => item.controlId === control.id,
  );
  const stepSheet = guided
    ? sheetForStep(controlSheets, rounds, journey)
    : null;
  const stepReview = guided ? reviewForStep(controlReviews, journey) : null;
  const agent = guided
    ? agentSays({
        step,
        journey,
        controlRef: control.controlRef,
        sheet: stepSheet,
        review: stepReview,
        impact,
        plan: evidencePlan,
        activity: engagement.activity ?? [],
        deficiencies: findings,
        hrefs: stepHrefs,
        automation: engagement.automation ?? null,
        agents: control.agents,
      })
    : null;
  const trace = guided
    ? (() => {
        const traceInput = {
          journey,
          risk: control.risk,
          statement: control.activity,
          attributes: control.testAttributes,
          plan: evidencePlan,
          sheet: stepSheet,
          review: stepReview,
          deficiencies: findings,
          conclusion: control.conclusion,
          hrefs: stepHrefs,
          round:
            journey?.stepPhase === "ROLLFORWARD" ||
            journey?.stepPhase === "RETEST"
              ? ((): TraceRound | null => {
                  const found =
                    rounds.find((item) => item.kind === journey.stepPhase) ??
                    null;
                  return found === null
                    ? null
                    : {
                        kind: found.kind,
                        number: found.number,
                        deficiencyReference: found.deficiencyReference,
                        requestStatus: found.requestStatus,
                        basis: found.basis,
                      };
                })()
              : null,
        };
        return { nodes: traceOf(traceInput), rows: traceRows(traceInput) };
      })()
    : null;
  // The control's next step opens the record it is about when that is evidence work.
  const firstEvidence = evidence.find((action) => action.mine);
  // The viewer's next action: what needs them, most pressing first (attentionOf), then an
  // agent that stopped before finishing; with none, the control's own next step when it
  // is theirs, and a drafted control's batch submission.
  // The canonical next step, as the register states it: the viewer's action when it is
  // theirs, else what the control waits on (the same state as the guided Needs-you).
  const canonical: AttentionItem | null =
    link !== null && control.progress !== "CONCLUDED" && !control.drafted
      ? {
          key: `next-${control.nextStep}`,
          title: control.nextStep,
          detail: control.overdue ? "Overdue" : "",
          owner: control.yours ? "You" : who,
          kind: control.yours ? "action" : "waiting",
          anchor: "",
          quick: null,
          ...(firstEvidence !== undefined &&
          (link.section === "approvals" || link.tab === "evidence")
            ? { tab: "evidence", target: firstEvidence.target }
            : link.section === "approvals"
              ? {
                  tab: "overview",
                  href: href(model, {}, "approvals"),
                  hrefLabel: "Open the approvals",
                }
              : {
                  tab: DETAIL_TABS.includes(link.tab as DetailTab)
                    ? (link.tab as DetailTab)
                    : "overview",
                }),
        }
      : control.drafted && control.yours
        ? {
            key: `drafted-${control.id}`,
            title: "Submit the drafted requests with the batch",
            detail: "",
            owner: "You",
            kind: "action",
            tab: "evidence",
            anchor: "",
            target: { view: "requests" },
            quick: null,
          }
        : null;
  const nextAction = nextActionOf({
    attention,
    lanes,
    control,
    canAct,
    canonical,
  });
  const _metrics = summaryMetrics(input);
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
  // The client-specific walkthrough's context: what the records hold about the control,
  // its governing documents first, and where a typed question goes.
  const walkthrough = {
    // The control's policies, procedures, narratives and diagrams, for the questions that
    // ask for one and the narrative's sources.
    documents: (context?.documents ?? [])
      .filter((item) => item.kind in GOVERNING_KINDS)
      .map((item) => ({
        id: item.id,
        title: item.title || item.fileName,
        detail: [GOVERNING_KINDS[item.kind], item.fileName]
          .filter((part) => part !== undefined && part !== "")
          .join(" · "),
        kind: item.kind,
      })),
    policiesHref: `${href(model, {})}&pane=policies`,
    askHref: sectionHref(model, "console"),
    viewer: model.email,
    understanding: context?.understanding ?? null,
    issues: context?.issues ?? [],
    // The attributes the plan tests, with the procedures that test them.
    attributes:
      engagement.masterPlan != null &&
      engagement.masterPlan.controlId === control.id
        ? engagement.masterPlan.attributes.map((item) => ({
            code: item.code,
            text: item.text,
            procedures: item.procedureCodes,
          }))
        : [],
    // The control's reference, shown on the flow where it operates.
    controlRef: control.controlRef,
    // The narrative's subtitle: the system and the control it describes.
    subtitle: [control.applicationName, control.title]
      .filter((part) => part !== "")
      .join(" · "),
  };
  // The control's definition, part by part: what waits on a person shows on the Test plan
  // tab, the rest folds away. The plan itself is reviewed on the Test plans page.
  const work = definitionWork(context);
  const unreviewed =
    context?.documents.filter((item) => !item.reviewed).length ?? 0;
  const definitionParts: Array<{
    key: string;
    label: string;
    pending: boolean;
    node: ReactNode;
  }> =
    context === null
      ? []
      : [
          ...(context.design !== null
            ? [
                {
                  key: "statement",
                  label: "Statement",
                  pending: work.values,
                  node: (
                    <DefinitionSection
                      key="statement"
                      title="Control statement"
                      note={work.values ? "Client values to record" : ""}
                    >
                      <DesignPanel
                        ids={ids}
                        design={context.design}
                        canAct={canAct}
                        walkthrough={walkthrough}
                      />
                    </DefinitionSection>
                  ),
                },
              ]
            : []),
          {
            key: "attributes",
            label: `${context.approved.length} ${context.approved.length === 1 ? "attribute" : "attributes"}`,
            pending: work.attributes,
            node: (
              <DefinitionSection
                key="attributes"
                title="Definition and attributes"
                note={
                  !work.attributes
                    ? ""
                    : context.proposed.length > 0
                      ? `${context.proposed.length} proposed to decide`
                      : context.approved.length === 0
                        ? "None approved"
                        : "Open question"
                }
              >
                <AttributesPanel ids={ids} context={context} canAct={canAct} />
              </DefinitionSection>
            ),
          },
          {
            key: "process",
            label: context.processRequired
              ? "Process understanding"
              : "Process not needed",
            pending: work.process,
            node: (
              <DefinitionSection
                key="process"
                title="Process understanding"
                note={
                  !work.process
                    ? ""
                    : context.understanding.proposedSteps !== null
                      ? "Revision proposed"
                      : context.understanding.steps.length === 0
                        ? "To build"
                        : "To confirm"
                }
              >
                <ProcessPanel ids={ids} context={context} canAct={canAct} />
              </DefinitionSection>
            ),
          },
          {
            key: "documents",
            label:
              context.documents.length === 0
                ? "No supporting documents"
                : `${context.documents.length} supporting ${context.documents.length === 1 ? "document" : "documents"}`,
            pending: work.documents,
            node: (
              <DefinitionSection
                key="documents"
                title="Supporting documents"
                note={unreviewed > 0 ? `${unreviewed} to review` : ""}
              >
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
              </DefinitionSection>
            ),
          },
        ];
  // The test plan in the Plan step holds the control's own editors (decided by the
  // product owner): each fact once, edited where it is read; no separate cards below.
  const planHere =
    engagement.masterPlan != null &&
    engagement.masterPlan.controlId === control.id;
  const planWorkspace: PlanWorkspace | null =
    context === null || !planHere
      ? null
      : {
          statement:
            context.design !== null ? (
              <DesignPanel
                ids={ids}
                design={context.design}
                canAct={canAct}
                narrative={false}
                walkthrough={walkthrough}
              />
            ) : null,
          attributes: (
            <AttributesPanel
              ids={ids}
              context={context}
              canAct={canAct}
              compact
            />
          ),
          // The control's history, by day, on the plan's History tab.
          history: (
            <ControlHistory
              items={engagement.activity ?? null}
              viewer={model.email}
            />
          ),
          activityToday: activitiesOn(engagement.activity ?? [], new Date()),
          // The control's attributes open below the table when they wait on a decision.
          attributesOpen: definitionParts.some(
            (part) => part.key === "attributes" && part.pending,
          ),
          attributesLabel: attributeFoldLabel(context),
          basis: (
            <TestBasisCard ids={ids} basis={engagement.testBasis ?? null} />
          ),
          classification: (
            <Classifications ids={ids} context={context} canAct={canAct} />
          ),
        };
  const stageState = (key: string): PhaseState => {
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
  // M1d: the classic panels read their state from the API's journey, the same phase
  // states the strip shows, so a retest in testing is never "not started"; the stage
  // derivation remains only when the journey is absent.
  const JOURNEY_KEYS: Record<string, string[]> = {
    design: ["DESIGN"],
    interim: ["INTERIM"],
    rollforward: ["ROLLFORWARD", "REMEDIATION", "RETEST"],
  };
  const lifeState = (key: string): PhaseState => {
    if (key === "review") {
      // The control's own review or any round's: open is in progress, all signed is done.
      if (controlReviews.some((item) => item.status === "OPEN")) {
        return "active";
      }
      return controlReviews.length > 0 ? "done" : "todo";
    }
    const names = JOURNEY_KEYS[key] ?? [];
    const found = (journey?.phases ?? []).filter(
      (item) => names.includes(item.phase) && item.state !== "NOT_APPLICABLE",
    );
    if (journey === null || found.length === 0) {
      return stageState(key);
    }
    if (
      found.every(
        (item) => item.state === "SIGNED_OFF" || item.state === "REVIEWED",
      )
    ) {
      return "done";
    }
    if (
      found.every(
        (item) =>
          item.state === "AWAITING_PLAN" ||
          item.state === "PLANNED" ||
          item.state === "RELEASED",
      )
    ) {
      return "todo";
    }
    return "active";
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
  // The counts beside the Evidence & testing views.
  const _counts: Partial<Record<DetailTab, number | null>> = {
    evidence: control.requests.filter(
      (request) => request.status !== "CANCELLED",
    ).length,
    testing: sheet === null ? null : sheet.counts.items,
    findings: openFindings + figures.findings.potential,
  };
  // A workpaper step: prepared, being drafted or written, or not started.
  const paperState = (stage: "DESIGN" | "EFFECTIVENESS"): PhaseState => {
    const papers = (engagement.workpapers ?? []).filter(
      (paper) => paper.stage === stage,
    );
    return papers.some((paper) => paper.status === "PREPARED")
      ? "done"
      : papers.length > 0
        ? "active"
        : "todo";
  };
  const workpaperProps = {
    papers: engagement.workpapers,
    notice: engagement.workpaperNotice,
    viewing: engagement.workpaperViewing,
    ids,
    canAct,
    hasInput,
    automation: engagement.automation ?? null,
  };
  const keepWorkpaper =
    engagement.workpaperNotice !== null || engagement.workpaperViewing !== null;
  // The control workspace's frame (decided by the product owner): its source and
  // objective, the client questions the planning agent asks, the section open, and the
  // way to ask the agent about it.
  const design = context?.design ?? null;
  const fillableSlots = (design?.slots ?? []).filter((slot) => !slot.automatic);
  const clientQuestions =
    design === null
      ? null
      : {
          total: fillableSlots.length,
          attention: fillableSlots.filter(
            (slot) => slot.blocks && slot.value.trim() === "",
          ).length,
          open: fillableSlots.filter((slot) => slot.value.trim() === "").length,
        };
  // The agent's confidence in the plan: the lowest its attribute definitions state.
  const confidence = lowestConfidence(
    (context?.approved ?? []).map(
      (item) => item.definition?.confidence ?? null,
    ),
  );
  const planSource =
    engagement.masterPlan != null &&
    engagement.masterPlan.controlId === control.id
      ? engagement.masterPlan.control.source
      : "";
  const source =
    planSource === "LIBRARY"
      ? "Standard"
      : planSource === "UPLOAD"
        ? "Client"
        : "";
  const objective = context?.testing?.objective ?? "";
  const section = openSection(engagement.filters.step, showActivity);
  const sectionHrefs: Record<RecordSection, string> = {
    OVERVIEW: href(model, { ...keep, control: control.id }),
    PLAN: stepHrefs.PLAN,
    REQUEST: stepHrefs.REQUEST,
    TEST: stepHrefs.TEST,
    CONCLUDE: stepHrefs.CONCLUDE,
    REVIEW: stepHrefs.REVIEW,
    HISTORY: `${href(model, { ...keep, control: control.id, tab: "activity" })}#activity`,
  };
  const askHref = sectionHref(model, "console");
  // The policies, procedures, narratives and diagrams the control cites, its own or
  // through its system or process (0112).
  const governing = governingDocuments(context?.documents ?? []);
  // Every document, with whether the agent has reviewed it, for the documents card.
  const documentCard = controlDocuments(context?.documents ?? []);
  // In the Plan step, the assistant's next actions open the part of the plan they name.
  const openQuestions = clientQuestions?.open ?? 0;
  const planActions: AssistantAction[] = [
    ...(openQuestions > 0
      ? [
          {
            key: "questions",
            label: `Review ${openQuestions} client-specific ${openQuestions === 1 ? "answer" : "answers"}`,
            icon: "file" as const,
            target: { anchor: "client-info", tab: "understanding" },
          },
        ]
      : []),
    {
      key: "procedures",
      label: "Review drafted procedures",
      icon: "layers",
      target: { tab: "procedures" },
    },
    {
      key: "evidence",
      label: "Check evidence requirements",
      icon: "inbox",
      target: { tab: "evidence" },
    },
    {
      key: "prior-year",
      label: "Compare with prior year",
      icon: "clock",
      target: { anchor: "cw-prior-year" },
    },
  ];
  const actionItems: RowMenuItem[] = [
    {
      label: "Open the test plan in Testing",
      icon: "file",
      href: planningHref(ids.organizationId, ids.projectId, {
        control: control.id,
      }),
    },
    {
      label: "Ask the agent about this control",
      icon: "sparkles",
      href: askHref,
    },
    {
      label: "See the history",
      icon: "clock",
      href: sectionHrefs.HISTORY,
    },
    {
      label: "Back to the controls",
      icon: "back",
      href: href(model, {}, "register"),
    },
  ];
  const statusClass = `cr-status cw-stage is-${control.progress.toLowerCase()}${control.yours ? " is-yours" : ""}`;
  return (
    <div className="page record-page cx cw">
      <HashScroll />
      <ControlBar
        heroId="cw-hero"
        controlRef={control.controlRef}
        title={control.title}
        status={stage.label}
        statusClass={statusClass}
        step={stepPosition(step)}
        actions={
          <RowMenu
            label={`Actions for ${control.controlRef}`}
            trigger={{ label: "Actions", icon: "more" }}
            items={actionItems}
          />
        }
      />
      <header className="cw-hero" id="cw-hero">
        <div className="cw-hero-id">
          <nav className="cw-crumbs" aria-label="Where this control sits">
            <a href={href(model, {}, "register")}>Controls</a>
            {control.applicationName !== "" &&
            control.applicationId !== null ? (
              <>
                <span aria-hidden="true">/</span>
                <a
                  href={`${href(model, {})}&pane=systems&system=${control.applicationId}`}
                >
                  {control.applicationName}
                </a>
              </>
            ) : null}
            <span aria-hidden="true">/</span>
            <span aria-current="page">{control.controlRef}</span>
          </nav>
          <h1>
            <span className="cw-ref">{control.controlRef}</span>
            <span className="cw-title">{control.title}</span>
            {source !== "" ? <span className="cw-source">{source}</span> : null}
          </h1>
          {objective !== "" ? (
            <p className="cw-objective">{objective}</p>
          ) : null}
        </div>
        <div className="cw-hero-actions">
          <span className={statusClass}>
            <span className="sr-only">Status: </span>
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
          {control.overdue ? <span className="cw-late">Overdue</span> : null}
          <RowMenu
            label={`Actions for ${control.controlRef}`}
            trigger={{ label: "Actions", icon: "more" }}
            items={actionItems}
          />
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
      </header>
      <section
        className="cw-summary cw-steps-wrap"
        aria-label="Control workflow"
      >
        {guided ? (
          <ControlStepper
            journey={journey}
            items={stepperItems(journey)}
            phases={phaseItems(journey)}
            current={step}
            hrefs={stepHrefs}
            ids={{
              organizationId: ids.organizationId,
              projectId: ids.projectId,
            }}
            needs={needsYou({
              nextStep: control.nextStep,
              actor: control.actor,
              yours: control.yours,
              journey,
              decideImpact,
              assignees: control.assignees,
            })}
            // Open lands on the work itself, below the summary, so the same
            // Needs-you card is not the first thing seen again.
            actionHref={
              decideImpact
                ? `${stepHrefs.PLAN}#cw-work`
                : nextAction.primary !== null
                  ? (nextAction.primary.href ??
                    `${tabHrefs[nextAction.primary.tab]}#cw-work`)
                  : null
            }
            blockers={blockersOf(journey)}
            receipts={engagement.signoffs ?? []}
            activityHref="#activity"
            agent={agent}
            trace={trace}
            simple={step === "PLAN" && planHere}
            // The Request step's list says what waits and where each request stands, so
            // the summary blocks are not repeated above it (product owner, 27 October 2026).
            summary={step !== "REQUEST"}
            planPending={
              engagement.masterPlan != null &&
              engagement.masterPlan.controlId === control.id &&
              ["DRAFT_READY", "PENDING_REVIEW", "NEEDS_CLARIFICATION"].includes(
                engagement.masterPlan.state,
              )
            }
          />
        ) : null}
      </section>
      {/* The Request step's list of requests and its detail panel take the page's width
          (product owner's reference, 27 October 2026). */}
      <div
        className={`cw-layout${
          tab === "evidence" &&
          evidencePlan !== null &&
          evidencePlan.status !== "NOT_PLANNED"
            ? " is-wide"
            : ""
        }`}
      >
        <RecordMenu open={section} hrefs={sectionHrefs} />
        <div className="cw-main">
          <div className="record-tab cw-body" id="cw-work">
            {tab === "design" ? (
              <>
                <ImpactPanel
                  assessments={impact}
                  ids={ids}
                  hrefs={{ test: stepHrefs.TEST, review: stepHrefs.REVIEW }}
                />
                {engagement.masterPlan != null &&
                engagement.masterPlan.controlId === control.id ? (
                  // The plan is reviewed and approved here, with the one review component
                  // the Testing destination uses (M2d): the same human approval, revision
                  // checks and audit trail.
                  <PlanReview
                    ids={{
                      organizationId: ids.organizationId,
                      projectId: ids.projectId,
                      section: "testing",
                    }}
                    plan={engagement.masterPlan}
                    queue={null}
                    initialTab="understanding"
                    phases={engagement.phaseProgress?.controls.find(
                      (row) => row.controlId === control.id,
                    )}
                    canRelease={
                      engagement.phaseProgress?.viewerCanRelease ?? false
                    }
                    embedded
                    workspace={planWorkspace}
                    clientQuestions={clientQuestions}
                    confidence={confidence}
                  />
                ) : (
                  <TestPlanSummary
                    plan={evidencePlan}
                    approach={approach}
                    attributes={context?.approved.length ?? 0}
                    questions={
                      context?.issues.filter(
                        (item) =>
                          item.status === "OPEN" && item.kind !== "CONFLICT",
                      ).length ?? 0
                    }
                    href={planningHref(ids.organizationId, ids.projectId, {
                      control: control.id,
                    })}
                  />
                )}
                <div id="cw-prior-year">
                  <ControlPriorYear
                    ids={{
                      organizationId: ids.organizationId,
                      projectId: ids.projectId,
                    }}
                    controlId={control.id}
                    editable={canAct}
                  />
                </div>
                {planWorkspace !== null ? null : (
                  <TestBasisCard
                    ids={ids}
                    basis={engagement.testBasis ?? null}
                  />
                )}
                {planWorkspace !== null ? null : context === null ? (
                  <p className="form-hint">
                    The control's definition could not be loaded. Refresh to try
                    again.
                  </p>
                ) : (
                  <>
                    {definitionParts.some((part) => part.pending) ? (
                      <h2 className="cw-group-title">Needs your decision</h2>
                    ) : null}
                    {definitionParts
                      .filter((part) => part.pending)
                      .map((part) => part.node)}
                    {definitionParts.some((part) => !part.pending) ? (
                      <details className="cw-fold">
                        <summary>
                          <span>
                            <strong>Control definition</strong>
                            <small>
                              {definitionParts
                                .filter((part) => !part.pending)
                                .map((part) => part.label)
                                .join(" · ")}
                            </small>
                          </span>
                          <UiIcon name="chevron" size={14} />
                        </summary>
                        <div className="cw-fold-body">
                          {definitionParts
                            .filter((part) => !part.pending)
                            .map((part) => part.node)}
                        </div>
                      </details>
                    ) : null}
                  </>
                )}
              </>
            ) : null}
            {tab === "evidence" ? (
              <EvidenceWorkspace
                ids={ids}
                plan={evidencePlan}
                canAct={canAct}
                requestList={{
                  master:
                    engagement.masterPlan != null &&
                    engagement.masterPlan.controlId === control.id
                      ? engagement.masterPlan
                      : null,
                  activity: engagement.activity ?? null,
                  controlRef: control.controlRef,
                }}
                summary={evidenceSummary(
                  evidencePlan,
                  control.requests,
                  engagement.files,
                )}
                proposals={evidenceProposals(evidencePlan)}
                focus={{
                  view: engagement.filters.evidenceView ?? null,
                  request: focusRow?.id ?? null,
                }}
                files={(engagement.files?.files ?? []).map((file) => ({
                  id: file.id,
                  fileName: file.fileName,
                  requestId: file.request?.id ?? null,
                  blocked: changeBlocked(file),
                  // Only when the coordinator could not tell; a file still being read
                  // has no tag yet, and one on an instance's request takes its application.
                  applicationUnknown: file.applicationScope === "UNKNOWN",
                }))}
                applications={engagement.files?.applications ?? []}
                system={
                  (engagement.files?.applications ?? []).find(
                    (app) => app.name === control.applicationName,
                  )?.id ?? null
                }
                requests={(() => {
                  const rows = requestRows(
                    control.requests,
                    evidencePlan,
                    engagement.files,
                  );
                  const grouped = requestsByPhase(
                    rows,
                    (evidencePlan?.phases ?? []).map((phase) => phase.phase),
                  );
                  // Under a phase each item has its own Add evidence, so its request has none;
                  // a request for no planned phase, or before the plan is shown, keeps it.
                  const lines = (set: RequestRow[], showPhase = false) => (
                    <RequestLines
                      model={model}
                      control={control}
                      tabHref={tabHrefs.evidence}
                      focus={focusRow?.id ?? null}
                      rows={set}
                      showPhase={showPhase}
                      upload={showPhase}
                    />
                  );
                  return {
                    rows,
                    byPhase: Object.fromEntries(
                      [...grouped.byPhase].map(([phase, set]) => [
                        phase,
                        lines(set),
                      ]),
                    ),
                    other: lines(grouped.other, true),
                    all: lines(rows, true),
                    head: <RequestHead model={model} review={requestReview} />,
                  };
                })()}
                library={
                  <ControlEvidence
                    model={model}
                    control={control}
                    files={engagement.files}
                    notice={engagement.changeNotice}
                    serves={fileServes(evidencePlan)}
                    placed={placedFiles(evidencePlan)}
                  />
                }
                rcmItems={control.pbcItems}
              />
            ) : null}
            {tab === "testing" ? (
              <>
                {pendingImpact > 0 ? (
                  <p
                    className="banner banner-warning cw-impact-banner"
                    role="status"
                  >
                    <UiIcon name="risk" size={16} />
                    <span>
                      {pendingImpact === 1
                        ? "These results await a reviewer's impact decision: the test plan changed after they were signed off."
                        : `${pendingImpact} signed-off results await a reviewer's impact decision.`}
                      <a href={stepHrefs.PLAN}>Open the assessment</a>
                    </span>
                  </p>
                ) : null}
                {stages.find((item) => item.key === "design")?.status !==
                "not_applicable" ? (
                  <PhasePanel
                    number={1}
                    title="Design and walkthrough"
                    state={lifeState("design")}
                  >
                    <PhaseStep
                      number={1}
                      title="Walkthrough and design workpaper"
                      state={paperState("DESIGN")}
                      waits="Starts when design evidence has been read"
                      keepOpen={keepWorkpaper}
                    >
                      <WorkpapersTab
                        compact
                        {...workpaperProps}
                        stage="DESIGN"
                      />
                    </PhaseStep>
                  </PhasePanel>
                ) : null}
                <PhasePanel
                  number={2}
                  title="Interim testing"
                  state={lifeState("interim")}
                >
                  {test !== null || sheet?.method !== "TEST_OF_ONE" ? (
                    <PhaseStep
                      number={1}
                      title="Population and sample"
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
                      waits="Starts when the population is received"
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
                            ? `Not ready for testing: ${context.readiness.label.toLowerCase()}. See the Test plan tab.`
                            : null
                        }
                      />
                    </PhaseStep>
                  ) : null}
                  {engagement.evidenceMapping === undefined ? null : (
                    <EvidenceMappingPanel
                      run={
                        engagement.evidenceMapping !== null &&
                        engagement.evidenceMapping.controlId === control.id
                          ? engagement.evidenceMapping
                          : null
                      }
                      ids={{
                        organizationId: ids.organizationId,
                        projectId: ids.projectId,
                        controlId: control.id,
                      }}
                      back={stepHrefs.TEST ?? ""}
                      canMap={true}
                    />
                  )}
                  <PhaseStep
                    number={2}
                    title="Test results and sign-off"
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
                    waits={
                      sheet?.method === "TEST_OF_ONE" ||
                      control.nature === "AUTOMATED"
                        ? "Starts when the evidence is read"
                        : "Starts when the samples are approved"
                    }
                    keepOpen={engagement.sheetNotice !== null}
                  >
                    <TestSheetCard
                      sheet={sheet}
                      notice={engagement.sheetNotice}
                      ids={ids}
                      canAct={canAct}
                      automation={engagement.automation ?? null}
                    />
                  </PhaseStep>
                  <PhaseStep
                    number={3}
                    title="Interim workpaper"
                    state={paperState("EFFECTIVENESS")}
                    waits="Starts when testing begins"
                    keepOpen={keepWorkpaper}
                  >
                    <WorkpapersTab
                      compact
                      {...workpaperProps}
                      stage="EFFECTIVENESS"
                      initial="interim"
                    />
                  </PhaseStep>
                </PhasePanel>
                {stages.find((item) => item.key === "rollforward")?.status !==
                "not_applicable" ? (
                  <PhasePanel
                    number={3}
                    title="Roll-forward and retests"
                    state={lifeState("rollforward")}
                  >
                    <PhaseStep
                      number={1}
                      title="Rounds"
                      state={
                        rounds.length === 0 ? "todo" : lifeState("rollforward")
                      }
                      note={
                        rounds.length === 0
                          ? undefined
                          : `${rounds.length} round${rounds.length === 1 ? "" : "s"}`
                      }
                      waits="Starts when interim testing is signed off effective"
                    >
                      {rounds.length === 0 ? (
                        <p className="sheet-empty">
                          <UiIcon name="clock" size={16} />
                          <span>
                            A roll-forward round starts when interim testing is
                            signed off effective; a retest when a deficiency is
                            marked ready.
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
                      state={
                        rounds.length === 0 ? "todo" : lifeState("rollforward")
                      }
                      waits="Starts with the first round"
                      keepOpen={keepWorkpaper}
                    >
                      <WorkpapersTab
                        compact
                        {...workpaperProps}
                        stage="EFFECTIVENESS"
                        initial="rollforward"
                      />
                    </PhaseStep>
                  </PhasePanel>
                ) : null}
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
                  summary={
                    guided
                      ? undefined
                      : "Once the testing workpaper is prepared, the independent reviewer agent re-performs the testing against the evidence and proposes review notes; a reviewer who did not test or prepare decides each note and signs the control off."
                  }
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
                    {guided && review === null ? (
                      <p className="cw-plain-note">
                        No review of the control's own has opened. It opens when
                        the testing is signed off and the effectiveness
                        workpaper is prepared; the rounds' reviews are listed
                        below.
                      </p>
                    ) : (
                      <ReviewTab
                        review={review}
                        sheet={sheet}
                        notice={engagement.reviewNotice}
                        ids={ids}
                        canAct={canAct}
                        automation={engagement.automation ?? null}
                      />
                    )}
                  </PhaseStep>
                </PhasePanel>
                {pendingImpact > 0 ? (
                  <p
                    className="banner banner-warning cw-impact-banner"
                    role="status"
                  >
                    <UiIcon name="risk" size={16} />
                    <span>
                      The results this review covers await a reviewer's impact
                      decision.
                      <a href={stepHrefs.PLAN}>Open the assessment</a>
                    </span>
                  </p>
                ) : null}
                {review !== null ? (
                  <CoverageForm
                    review={review}
                    ids={ids}
                    gap={coverageGaps.control}
                    canAct={canAct}
                  />
                ) : null}
                <RoundReviews
                  reviews={roundReviews}
                  rounds={rounds}
                  sheets={engagement.sheets}
                  notice={engagement.reviewNotice}
                  ids={ids}
                  canAct={canAct}
                  gaps={coverageGaps}
                  automation={engagement.automation ?? null}
                />
                <section className="cw-plain cw-conclusion">
                  <h2>Conclusion</h2>
                  {control.conclusion === "NOT_CONCLUDED" ? (
                    <p>
                      Not concluded. A control is concluded only when its review
                      is signed off by the independent reviewer; an agent can
                      draft, never conclude.
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
                      {sheet !== null &&
                      sheet.conclusion === "NOT_EFFECTIVE" &&
                      control.conclusion === "EFFECTIVE"
                        ? ` The testing was signed off not effective (${sheet.counts.exceptions} exception${sheet.counts.exceptions === 1 ? "" : "s"}); ${sheet.proposalStatus === "DISMISSED" ? `the proposed deficiency was dismissed by a person${sheet.proposalReason !== "" ? ` (${sheet.proposalReason.replace(/\.$/, "")})` : ""}, and ` : ""}the reviewer concluded the control effective on the signed-off review.`
                        : ""}
                    </p>
                  )}
                </section>
              </>
            ) : null}
          </div>
          {/* The audit trail opens from History (the section menu, or a control's link
              in the Controls list); it is not repeated under every step (product owner,
              26 October 2026), and the Plan step keeps it in its History tab. */}
          {showActivity ? (
            <details className="cw-fold cw-activity" id="activity" open>
              <summary>
                <span>
                  <strong>Activity</strong>
                  <small>
                    The audit trail: agents' work, people's decisions, and the
                    workspace's steps.
                  </small>
                </span>
                <UiIcon name="chevron" size={14} />
              </summary>
              <div className="cw-fold-body">
                <ActivityTimeline items={engagement.activity} />
              </div>
            </details>
          ) : null}
        </div>
        <aside className="cw-rail" aria-label="Assistant and context">
          <ControlAssistant
            controlRef={control.controlRef}
            title={control.title}
            counts={
              engagement.masterPlan != null &&
              engagement.masterPlan.controlId === control.id
                ? {
                    procedures: engagement.masterPlan.procedures.length,
                    attributes: engagement.masterPlan.attributes.length,
                    evidence: engagement.masterPlan.evidence.length,
                  }
                : null
            }
            answers={exampleAnswers(design)}
            related={relatedControls(
              design,
              engagement.controls ?? [],
              control.applicationName,
            ).map((item) => ({
              ref: item.ref,
              href:
                item.id === null
                  ? null
                  : href(model, { ...keep, control: item.id }),
            }))}
            askHref={askHref}
            system={control.applicationName}
            documents={governing}
            contradictions={(context?.issues ?? [])
              .filter(
                (item) => item.status === "OPEN" && item.kind === "CONFLICT",
              )
              .map((item) => item.topic)}
            nextActions={planHere ? planActions : []}
          />
          {engagement.masterPlan != null &&
          engagement.masterPlan.controlId === control.id ? (
            <>
              <EvidenceSummaryCard
                counts={planEvidenceSummary(engagement.masterPlan)}
              />
              <PlanVersionsCard
                versions={planVersions(engagement.masterPlan)}
              />
            </>
          ) : null}
          <ControlContextCard
            editHref={
              control.applicationId !== null
                ? `${href(model, {})}&pane=systems&system=${control.applicationId}`
                : null
            }
            rows={contextRows({
              applicationName: control.applicationName,
              category: control.category,
              categoryLabel: CATEGORY_LABEL[control.category] ?? "",
              area: control.area,
              ownerName: control.ownerName,
              ownerEmail: control.ownerEmail,
              environment: control.applicationEnvironment ?? "",
              frequencyLabel: sentence(frequencyText(control)),
              keyControl: control.keyControl,
            })}
          />
          <GoverningDocumentsCard
            documents={documentCard.governing}
            supporting={documentCard.supporting}
            manageHref={`${href(model, {})}&pane=policies`}
            actions={
              context !== null && planHere ? (
                <DocumentActions
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
              ) : null
            }
          />
        </aside>
      </div>
    </div>
  );
}

/** One part of the control's definition, with what waits on it. Its anchor is the one the
 * next action links to. */
function DefinitionSection({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section
      className="cw-plain cw-def"
      id={stepAnchor(title)}
      aria-label={title}
    >
      <header className="cw-def-head">
        <h2>{title}</h2>
        {note !== "" ? <span className="cw-def-note">{note}</span> : null}
      </header>
      {children}
    </section>
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
/** Above the control's evidence: why uploads are held, and the request opened for review.
 * The requests' own statuses say which are drafted (product owner, 27 October 2026). */
function RequestHead({
  model,
  review,
}: {
  model: Ready;
  /** The request opened for review, and its panel. */
  review: ReactNode;
}) {
  const blocked = uploadBlocked(
    model.selectedProject?.status ?? "",
    model.organization.role,
  );
  return (
    <>
      {blocked !== null ? (
        <p className="upload-blocked" role="status">
          <UiIcon name="info" size={15} />
          <span>{blocked}</span>
        </p>
      ) : null}
      {review}
    </>
  );
}

/**
 * Requests, one line each: which request (its reference and kind), when it is due and to
 * whom, where it stands, what came back, and Review, with Add evidence where its items do
 * not carry their own. Under a phase the items it asks for are listed right below, each
 * with its Add evidence, so the request lists neither again.
 */
function RequestLines({
  model,
  control,
  tabHref,
  focus,
  rows,
  showPhase = false,
  upload = true,
}: {
  model: Ready;
  control: ControlRow;
  /** The Evidence tab's address, for each request's own link. */
  tabHref: string;
  /** The request opened for review. */
  focus: string | null;
  rows: RequestRow[];
  /** Name each request's phase: where they are not listed under it. */
  showPhase?: boolean;
  /** Offer Add evidence on the request (not where its items offer their own). */
  upload?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="form-hint">
        No requests yet. They are made from the evidence plan.
      </p>
    );
  }
  const canUpload =
    upload &&
    canRequestEvidence(model.organization.role) &&
    model.selectedProject?.status === "ACTIVE";
  return (
    <ul className="ew-request-lines">
      {rows.map((request) => {
        const stage = REQUEST_STAGES[requestStage(request, control)];
        return (
          <li
            key={request.id}
            className={`ew-request-line${request.id === focus ? " is-open" : ""}`}
            aria-current={request.id === focus ? "true" : undefined}
          >
            <span className="ew-request-main">
              <strong>
                {request.kind === "EVIDENCE"
                  ? "Request"
                  : `${REQUEST_KIND[request.kind]} request`}{" "}
                <span className="mono">{requestReference(request.id)}</span>
              </strong>
              <small>
                {showPhase && request.phase !== null
                  ? `${PHASE_WORDS[request.phase] ?? request.phase} · `
                  : ""}
                Due {formatDate(request.dueAt)}
                {request.recipient ? ` · to ${request.recipient}` : ""}
                {` · ${request.files} file${request.files === 1 ? "" : "s"}`}
              </small>
            </span>
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
            <span className="ew-request-actions">
              {request.id === focus ? (
                <span className="ew-open-now">Open</span>
              ) : (
                <a
                  className="btn btn-sm btn-secondary"
                  href={evidenceHref(tabHref, {
                    view: "requests",
                    request: request.id,
                  })}
                  aria-label={`Review ${request.title}`}
                >
                  Review
                </a>
              )}
              {canUpload &&
              request.status !== "CANCELLED" &&
              request.status !== "CLOSED" ? (
                <RequestUpload
                  organizationId={model.organization.id}
                  projectId={model.selectedProject?.id ?? ""}
                  requestId={request.id}
                  label={request.title}
                />
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
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
  placed,
}: {
  model: Ready;
  control: ControlRow;
  files: ControlFiles | null;
  notice: ChangeNotice | null;
  /** The plan requirements each file serves (evidence-workspace-model.fileServes). */
  serves?: Map<
    string,
    Array<{ label: string; via: "REQUEST" | "LINK" | "SHARED" }>
  >;
  /** The files shown on their evidence items' lines, with their actions there; they are
   * not listed again here (evidence-workspace-model.placedFiles). */
  placed?: Set<string>;
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
  const listed = files.files.filter((file) => !placed?.has(file.id));
  const under = files.files.length - listed.length;
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
      {under > 0 ? (
        <p className="form-hint evidence-under">
          {under === files.files.length
            ? under === 1
              ? "The file is"
              : `All ${under} files are`
            : under === 1
              ? "1 file is"
              : `${under} files are`}{" "}
          shown under the evidence{" "}
          {under === 1 ? "item it serves" : "items they serve"} above, where{" "}
          {under === 1 ? "it is" : "each is"} previewed, downloaded, replaced,
          or withdrawn.
        </p>
      ) : null}
      {listed.length > 0 || under === 0 || reading ? (
        <h4>
          {under > 0 ? "Serving no item yet" : "Evidence received"}
          <span className="view-count">{listed.length}</span>
          {reading ? (
            <span className="pill pill-dot tone-info">
              <span className="spinner small" aria-hidden="true" /> The agents
              are reading new files
            </span>
          ) : null}
        </h4>
      ) : null}
      {files.files.length === 0 ? (
        <p className="form-hint">
          No files yet. Add evidence to a request above, or drop a folder on the
          Evidence page.
        </p>
      ) : listed.length === 0 ? null : (
        <div className="app-groups">
          {byApplicationOf(
            listed,
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
                        <li key={file.id} className="evidence-file-item">
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
                                            `${item.label}${item.via === "LINK" ? " (linked)" : item.via === "SHARED" ? " (shared)" : ""}`,
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
                            </div>
                          </details>
                          {/* On the row, not inside it: a file added by mistake is
                              withdrawn or replaced (its record stays), never deleted. */}
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
