import Link from "next/link";
import type { ReactNode } from "react";
import { reviewForStep, sheetForStep } from "./agent-says-model";
import { analysisFor, reviewFor } from "./analysis-model";
import { AnalysisPanel } from "./analysis-view";
import { AppIdentity } from "./app-identity";
import { assistantBrief, stepAnchor } from "./assistant-model";
import { AutoRefresh } from "./auto-refresh";
import { ControlConclusionWork } from "./control-conclusion-panel";
import {
  BLOCKING_STATES,
  CLASSIFICATIONS,
  untailored as untailoredCount,
} from "./control-context-model";
import {
  AttributesPanel,
  Classifications,
  DesignPanel,
  DocumentsPanel,
  ProcessPanel,
} from "./control-context-view";
import { ControlDetails } from "./control-details";
import type { DetailRow } from "./control-details-model";
import { needsYou, STEPS } from "./control-journey-model";
import { PhasePanel, type PhaseState, PhaseStep } from "./control-phases";
import {
  ControlBar,
  ControlContextCard,
  PlanVersionsCard,
} from "./control-rail";
import {
  activitiesOn,
  contextRows,
  GOVERNING_KINDS,
  lowestConfidence,
} from "./control-rail-model";
import { RiskScoping } from "./control-risk";
import { ControlSetup } from "./control-setup";
import {
  SETUP_HOLDS,
  type SetupInput,
  type SetupStepKey,
  setupSteps,
} from "./control-setup-model";
import {
  approvalRows,
  STEP_TAB,
  WORKSPACE_TABS,
  type WorkspaceTab,
} from "./control-tabs-model";
import { ControlWorkflow, WorkflowPanel } from "./control-workflow";
import {
  KIND_LABELS,
  NOT_YET_BUILT,
  openedFrom,
  SECTION_OF,
  type StepKey,
  STEPS as WORKFLOW_STEPS,
  type WorkflowInput,
  workflowOf,
} from "./control-workflow-model";
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
import { DesignConclusionPanel } from "./design-conclusion-panel";
import { DesignEvidence } from "./design-evidence";
import { carriersOf, evidenceList } from "./design-evidence-model";
import { showsEvidenceWorkspace } from "./design-release-model";
import { DesignRequests } from "./design-requests";
import { requestsView } from "./design-requests-model";
import { firstNameFrom } from "./engagement-guide-model";
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
import { mappingSummary } from "./evidence-mapping-model";
import { EvidenceMappingPanel } from "./evidence-mapping-view";
import {
  agentStatus,
  byApplicationOf,
  isReading,
  uploadBlocked,
} from "./evidence-model";
import { populationWaiting } from "./evidence-plan-model";
import { PreviewButton } from "./evidence-preview";
import { phaseWindow } from "./evidence-requests-model";
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
import { NextStepCard } from "./next-step";
import { nextStep, nodeFlags, journey as stagesOf } from "./next-step-model";
import { FREQUENCIES, NATURES } from "./onboarding-model";
import { phaseStatus, planningHref, planVersions } from "./planning-model";
import { PlanReview, type PlanWorkspace, ReviewActions } from "./planning-view";
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
import { receiptText, reopenText } from "./signoff-model";
import { StepFrame } from "./step-frame";
import { agentNote, PREPARED_TITLE, panelFrame } from "./step-panel-model";
import { TestBasisCard } from "./test-basis-view";
import { testFor } from "./testing-model";
import { TestPlanCard } from "./testing-view";
import { type TraceRound, traceOf, traceRows } from "./trace-model";
import { TraceRail } from "./trace-rail";
import { UiIcon } from "./ui-icon";
import { canDecide, canRequestEvidence } from "./workflow-model";
import { WorkpapersTab } from "./workpaper-view";
import { EmptyState, PageHeader, sectionHref } from "./workspace-view";

type Ready = Extract<ShellModel, { status: "ready" }>;
type Keep = Record<string, string | string[] | null>;

const SEVERITY_LABEL: Record<string, string> = Object.fromEntries(SEVERITIES);
const ENVIRONMENT_LABEL: Record<string, string> = {
  PRODUCTION: "Production",
  NON_PRODUCTION: "Non-production",
  BOTH: "Production and non-production",
};
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

const CLASSIFICATION_LABELS: Readonly<Record<string, string>> =
  Object.fromEntries(CLASSIFICATIONS);

function frequencyText(control: ControlRow): string {
  return (
    control.frequencyLabel ||
    control.frequency.replaceAll("_", " ").toLowerCase()
  );
}

/** "event driven" as "Event driven". */
/** Step 01 shows the control's full record folded under its details (10 November 2026);
 * every other step shows its section as it is. */
function RecordFold({
  folded,
  children,
}: {
  folded: boolean;
  children: ReactNode;
}) {
  return folded ? (
    <details className="stp-fold cd-more">
      <summary>
        <span>
          <strong>The full record</strong>
          <small>
            Risk and objective, scope, and why each testing phase applies
          </small>
        </span>
        <UiIcon name="chevron" size={14} />
      </summary>
      <div className="stp-fold-body">{children}</div>
    </details>
  ) : (
    <>{children}</>
  );
}

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
  const guided = true;
  // One row of tabs (product owner's reference, 2 November 2026): ?step= names the tab,
  // and an earlier link to a step or a classic tab opens the tab that holds its work.
  // The steps above the tabs show where the control stands.
  // The workflow is the control's workspace (product owner, 8 November 2026): ?step= opens a
  // step's panel, and an earlier link to a tab opens the step that holds its work. The panel
  // shows the section the tabs held.
  const opened = openedFrom(
    engagement.filters.step,
    engagement.filters.tab === null
      ? null
      : detailTab(control, engagement.filters.tab),
  );
  const section = opened === null ? null : SECTION_OF[opened];
  const tab: WorkspaceTab =
    section === "risk"
      ? "risk"
      : section === "design"
        ? "design"
        : section === "evidence"
          ? "evidence"
          : section === "testing"
            ? "testing"
            : section === "approvals"
              ? "approvals"
              : section === "history"
                ? "history"
                : "flow";
  // OE Testing holds the samples, their results and exceptions, the findings raised from them
  // and the retest (product owner, 8 November 2026): the testing and findings sections together.
  const withFindings = opened === "oetesting";
  const showActivity = tab === "history";
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
  // The step a form posts from, so its route comes back to that step (a D&I one too).
  const formStep = opened === null || opened === "activity" ? null : opened;
  const stepIds = { ...ids, step: formStep };
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
  // Each tab's address: ?step= names it; the Flow view, the default, needs none.
  const wsHrefs = Object.fromEntries(
    WORKSPACE_TABS.map(({ key }) => [
      key,
      href(model, {
        ...keep,
        control: control.id,
        step: key === "flow" ? null : key,
      }),
    ]),
  ) as Record<WorkspaceTab, string>;
  // The classic tabs and the steps, as the tabs that hold their work now.
  const tabHrefs: Record<DetailTab, string> = {
    overview: wsHrefs.overview,
    design: wsHrefs.design,
    evidence: wsHrefs.evidence,
    testing: wsHrefs.testing,
    findings: wsHrefs.findings,
    review: wsHrefs.approvals,
    activity: wsHrefs.history,
  };
  const stepHrefs = Object.fromEntries(
    STEPS.map((key) => [key, wsHrefs[STEP_TAB[key]]]),
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
        // Opened on the D&I Evidence step, it closes back to that step's list.
        closeHref={
          opened === "designevidence"
            ? href(model, {
                ...keep,
                control: control.id,
                step: "designevidence",
              })
            : evidenceHref(tabHrefs.evidence, { view: "requests" })
        }
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
    ids: stepIds,
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
  const askHref = sectionHref(model, "console");
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
      href: wsHrefs.history,
    },
    {
      label: "Back to the controls",
      icon: "back",
      href: href(model, {}, "register"),
    },
  ];
  // What needs a person now, and where it is done.
  const needs = needsYou({
    nextStep: control.nextStep,
    actor: control.actor,
    yours: control.yours,
    journey,
    decideImpact,
    assignees: control.assignees,
  });
  const needsHref = decideImpact
    ? `${wsHrefs.approvals}#cw-work`
    : nextAction.primary !== null
      ? (nextAction.primary.href ??
        `${tabHrefs[nextAction.primary.tab]}#cw-work`)
      : null;
  const masterHere =
    engagement.masterPlan != null &&
    engagement.masterPlan.controlId === control.id
      ? engagement.masterPlan
      : null;
  const requirements = (evidencePlan?.phases ?? []).flatMap(
    (phase) => phase.requirements,
  );
  // The guided setup's facts, for steps 02 to 04 and their screens.
  const setupInput: SetupInput | null =
    context === null
      ? null
      : {
          slots: (context.design?.slots ?? [])
            .filter((slot) => !slot.automatic)
            .map((slot) => ({
              key: slot.key,
              value: slot.value,
              blocks: slot.blocks,
              document: slot.document,
            })),
          processRequired: context.processRequired,
          processPending: definitionWork(context).process,
          approvedAttributes: context.approved.length,
          proposedAttributes: context.proposed.length,
          openQuestions: context.issues.filter((item) => item.status === "OPEN")
            .length,
          documents: context.documents.length,
          unreviewedDocuments: context.documents.filter(
            (item) => !item.reviewed,
          ).length,
          plan: {
            exists:
              masterHere !== null &&
              !["NOT_STARTED", "ANALYZING"].includes(masterHere.state),
            approved:
              masterHere !== null &&
              masterHere.state === "APPROVED" &&
              !masterHere.revisedSinceApproval,
            pendingReview:
              masterHere !== null &&
              ["PENDING_REVIEW", "DRAFT_READY"].includes(masterHere.state),
          },
          canAct,
          canApprove: masterHere?.viewerCanDecide ?? false,
        };
  const controlPapers = (engagement.workpapers ?? []).filter(
    (paper) => paper.controlId === control.id,
  );
  const paperOf = (stage: "DESIGN" | "EFFECTIVENESS") => {
    const paper = controlPapers.find((item) => item.stage === stage);
    return paper === undefined
      ? null
      : { status: paper.status, drafting: paper.drafting };
  };
  const busy = new Set<StepKey>(
    stages.flatMap((item): StepKey[] =>
      !item.agent
        ? []
        : item.key === "design"
          ? ["designassessment"]
          : item.key === "evidence"
            ? ["oeevidence"]
            : item.key === "interim" || item.key === "rollforward"
              ? ["oetesting"]
              : item.key === "review"
                ? ["review"]
                : ["conclusion"],
    ),
  );
  if (sheet?.running === true) {
    busy.add("oetesting");
  }
  // The D&I evidence's own release for this control (phase_release, B1).
  const designPhase = phaseStatus(
    engagement.phaseProgress?.controls.find(
      (row) => row.controlId === control.id,
    ),
    "DESIGN",
  );
  // The D&I requests list, the D&I Evidence step's one list until its requests are drafted
  // (product owner, 12 November 2026: no Release button; the agent proposes, a person
  // accepts, and each request shows the attributes it addresses). The plan says whether
  // the planner is at work and which procedures each request serves; the test plan's own
  // state and records are read only where it does not.
  const designRequests = requestsView({
    status: designPhase,
    approved: context?.approved ?? [],
    requirements:
      evidencePlan?.phases.find((phase) => phase.phase === "DESIGN")
        ?.requirements ?? [],
    summary: evidencePlan?.designRequests ?? null,
    working: masterHere?.state === "ANALYZING",
    procedures:
      masterHere === null
        ? null
        : Object.fromEntries(
            masterHere.evidence.map((item) => [item.id, item.procedureIds]),
          ),
    now: Date.now(),
  });
  const requestsListed =
    designRequests.mode === "list" || designRequests.mode === "drafting";
  // Once the requests are drafted the step stays one list (product owner, 12 November
  // 2026: "This view is again so heavy and a lot of duplicates labels and purpose. Just
  // simplify this"): each request with where it stands and the evidence that came back.
  // Only for a released D&I phase with a plan; anything else keeps the evidence workspace.
  const designWindow = evidencePlan?.phases.find(
    (phase) => phase.phase === "DESIGN",
  );
  const designEvidence =
    designRequests.mode === "hidden" &&
    evidencePlan !== null &&
    evidencePlan.status !== "NOT_PLANNED" &&
    (designPhase?.step === "RELEASED" || designPhase?.step === "COMPLETE")
      ? evidenceList({
          requirements: designWindow?.requirements ?? [],
          approved: context?.approved ?? [],
          // The plan lists the phase's requests with how each reached its owner;
          // the control's list says what kind each is.
          requests: carriersOf(
            designWindow?.requests ?? [],
            control.requests.filter((request) => request.phase === "DESIGN"),
          ),
          // The control records its owner by name and email; no role is on record.
          owner: { name: control.ownerName, role: "" },
          exceptions: evidencePlan.designRequests?.exceptions ?? [],
          liveEmail: evidencePlan.liveEmail ?? null,
          procedures:
            masterHere === null
              ? null
              : Object.fromEntries(
                  masterHere.evidence.map((item) => [
                    item.id,
                    item.procedureIds,
                  ]),
                ),
          period:
            (designWindow === undefined ? "" : phaseWindow(designWindow)) ||
            "The control as currently designed",
          now: Date.now(),
        })
      : null;
  // The planner at work or the requests being drafted: the step is the agents'. An
  // accepted list with nothing at work on it is not: it says what it waits for.
  if (requestsListed && designRequests.working) {
    busy.add("designevidence");
  }
  // Step 01's record (10 November 2026): description, objective and risk come from the
  // library or the RCM; owner, frequency and nature are recorded on this system's control.
  const ownerLine = [control.ownerName, control.ownerEmail]
    .filter((part) => part.trim() !== "")
    .join(" · ");
  const detailRows: DetailRow[] = [
    {
      key: "description",
      label: "Description",
      value: control.activity,
      missing: control.activity.trim() === "",
      editable: false,
    },
    {
      key: "objective",
      label: "Objective",
      value: objective,
      missing: objective === "",
      editable: false,
    },
    {
      key: "risk",
      label: "Risk",
      value: control.risk,
      missing: control.risk.trim() === "",
      editable: false,
    },
    {
      key: "owner",
      label: "Owner",
      value: ownerLine,
      missing: ownerLine === "",
      editable: true,
    },
    {
      key: "frequency",
      label: "Frequency",
      value: sentence(frequencyText(control)),
      missing: frequencyText(control) === "",
      editable: true,
    },
    {
      key: "nature",
      label: "Nature",
      value: sentence(natureText(control)),
      missing: natureText(control) === "",
      editable: true,
    },
  ];
  const workflowInput: WorkflowInput = {
    details: [
      { label: "Description", filled: control.activity.trim() !== "" },
      { label: "Objective", filled: objective !== "" },
      { label: "Frequency", filled: frequencyText(control) !== "" },
      {
        label: "Owner",
        filled: (control.ownerName || control.ownerEmail).trim() !== "",
      },
      { label: "Risk", filled: control.risk.trim() !== "" },
    ],
    setup: setupInput === null ? [] : setupSteps(setupInput),
    attributes: {
      approved: context?.approved.length ?? 0,
      proposed: context?.proposed.length ?? 0,
      untailored: context === null ? 0 : untailoredCount(context),
      questions:
        context?.issues.filter(
          (item) =>
            item.status === "OPEN" &&
            (item.origin === "ATTRIBUTES" || item.origin === "SOURCES"),
        ).length ?? 0,
    },
    plan: setupInput?.plan ?? {
      exists: false,
      approved: false,
      pendingReview: false,
    },
    requirements: requirements.map((item) => ({
      phase: item.phase,
      state: item.state,
    })),
    designRelease: designPhase,
    designRequests: requestsListed ? designRequests.header : null,
    designEvidence: designEvidence?.header ?? null,
    sheet:
      sheet === null
        ? null
        : {
            method: sheet.method,
            status: sheet.status,
            items: sheet.counts.items,
            tested: sheet.counts.tested,
            exceptions: sheet.counts.exceptions,
            running: sheet.running,
            decided:
              sheet.proposalStatus === "LOGGED" ||
              sheet.proposalStatus === "DISMISSED" ||
              sheet.deficiencyReference !== null,
            reference: sheet.deficiencyReference,
          },
    rounds: controlSheets
      .filter((item) => item.id !== sheet?.id && item.roundKind !== null)
      .map((item) => ({
        kind: item.roundKind ?? "RETEST",
        status: item.status,
        conclusion: item.conclusion,
      })),
    findings: findings.map((item) => ({
      reference: item.reference,
      status: item.status,
      type: item.type,
    })),
    reviewStatus: control.reviewStatus ?? "",
    conclusion: control.conclusion,
    proposedConclusion:
      engagement.controlConclusion?.controlId === control.id
        ? engagement.controlConclusion.proposed
        : null,
    designPaper: paperOf("DESIGN"),
    designConclusion:
      engagement.designConclusion === null
        ? null
        : {
            status: engagement.designConclusion.status,
            proposed: engagement.designConclusion.proposed,
            signed: engagement.designConclusion.signed?.verdict ?? null,
          },
    effectivenessPaper: paperOf("EFFECTIVENESS"),
    busy,
  };
  // Governing documents are optional on D&I Evidence: their fold says where they stand.
  const governingLine = `Optional · ${
    workflowInput.setup.find((item) => item.key === "documents")?.summary ??
    "None linked"
  }`;
  const workflow = workflowOf(workflowInput);
  // The control's next step, said above its workflow and marked on its node (product owner,
  // 10 November 2026: "not very clear what the user would do to begin").
  const upNext = nextStep(workflow, workflowInput, {
    ref: control.controlRef,
    system: control.applicationName,
  });
  const flags = nodeFlags(upNext);
  const stepHrefsWf = Object.fromEntries(
    WORKFLOW_STEPS.map((item) => [
      item.key,
      href(model, { ...keep, control: control.id, step: item.key }),
    ]),
  ) as Record<StepKey, string>;
  const openStep =
    opened === null || opened === "activity"
      ? null
      : (workflow.find((item) => item.key === opened) ?? null);
  const around = (by: -1 | 1) => {
    if (openStep === null) {
      return null;
    }
    const at = workflow.indexOf(openStep);
    const step = (
      by < 0 ? workflow.slice(0, at).reverse() : workflow.slice(at + 1)
    ).at(0);
    return step === undefined
      ? null
      : { title: step.title, href: stepHrefsWf[step.key] };
  };
  const approvals = approvalRows({
    planStatus: evidencePlan?.status ?? null,
    approvedRevision: evidencePlan?.approvedRevision ?? null,
    requestsToApprove: control.requests.filter(
      (request) => request.status === "APPROVAL_PENDING",
    ).length,
    sheetStatus: control.sheetStatus,
    sheetSignedBy: sheet?.signedBy ?? "",
    reviewStatus: control.reviewStatus,
    reviewSignedBy: review?.signedBy ?? "",
    conclusion: control.conclusion,
  });
  const contextEdit =
    control.applicationId !== null
      ? `${href(model, {})}&pane=systems&system=${control.applicationId}`
      : null;
  const statusClass = `cr-status cw-stage is-${control.progress.toLowerCase()}${control.yours ? " is-yours" : ""}`;
  // The guided setup's screens, inside steps 02 to 04 (product owner, 8 November 2026): the
  // pop-up is retired, and each step opens its own screens.
  // Control Understanding is a conversation with the engagement planner (product owner,
  // 9 November 2026); the other setup steps keep their panels.
  // Attributes and Scope & Sampling render embedded: the step panel's frame gives their title,
  // status, decision and agent line (product owner, 11 November 2026).
  const setupFor = (
    only: readonly SetupStepKey[],
    conversation = false,
    embedded = false,
  ) =>
    context === null || setupInput === null ? (
      <p className="cs-empty">
        The control's understanding is being prepared. It appears here once the
        agent has read the control's records.
      </p>
    ) : (
      <ControlSetup
        only={only}
        embedded={embedded}
        key={control.id}
        ids={ids}
        conversation={
          conversation
            ? {
                firstName: firstNameFrom(model.email),
                control: [control.controlRef, control.applicationName]
                  .filter((part) => part !== "")
                  .join(" · "),
                documents: walkthrough.documents.length,
                documentsHref: stepHrefsWf.designevidence ?? null,
                attributesHref: stepHrefsWf.attributes ?? null,
              }
            : null
        }
        issues={context.issues}
        input={setupInput}
        readinessBlocked={(SETUP_HOLDS as readonly string[]).includes(
          context.readiness?.state ?? "",
        )}
        holds={(context.readiness?.checks ?? [])
          .filter(
            (check) =>
              check.status === "BLOCKED" &&
              check.key !== "evidence" &&
              check.key !== "scope" &&
              check.key !== "plan",
          )
          .flatMap((check) => check.blockers.map((item) => item.detail))}
        slots={(context.design?.slots ?? [])
          .filter((slot) => !slot.automatic)
          .map((slot) => ({
            key: slot.key,
            question: slot.question,
            label: slot.label,
            value: slot.value,
            blocks: slot.blocks,
            options: slot.options,
            hint: slot.hint,
            document: slot.document,
          }))}
        documents={walkthrough.documents}
        // Each panel keeps its own key: ControlSetup places it beside its other children,
        // and a stable key per step keeps React from warning or remounting it.
        panels={{
          process: (
            <ProcessPanel
              key="process"
              ids={ids}
              context={context}
              canAct={canAct}
              showQuestions={false}
            />
          ),
          attributes: (
            <AttributesPanel
              key="attributes"
              ids={ids}
              context={context}
              canAct={canAct}
              showQuestions={false}
              embedded={embedded}
            />
          ),
          documents: (
            <DocumentsPanel
              key="documents"
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
          ),
          plan:
            masterHere === null ||
            ["NOT_STARTED", "ANALYZING"].includes(masterHere.state) ? (
              <p key="plan-drafting" className="cs-empty">
                The planning agent is drafting the test plan from the control's
                understanding. It appears here to review once drafted.
              </p>
            ) : (
              <div key="plan" className="cs-plan">
                <dl className="cs-plan-facts">
                  <div>
                    <dt>Procedures</dt>
                    <dd>{masterHere.procedures.length}</dd>
                  </div>
                  <div>
                    <dt>Attributes</dt>
                    <dd>{masterHere.attributes.length}</dd>
                  </div>
                  <div>
                    <dt>Evidence items</dt>
                    <dd>{masterHere.evidence.length}</dd>
                  </div>
                  <div>
                    <dt>Revision</dt>
                    <dd>{masterHere.revision}</dd>
                  </div>
                </dl>
                <ReviewActions
                  ids={{
                    organizationId: ids.organizationId,
                    projectId: ids.projectId,
                    section: "testing",
                  }}
                  plan={masterHere}
                />
              </div>
            ),
        }}
      />
    );

  // Each step's panel (product owner, 8 November 2026: decision-first, each panel its own
  // step's work). The parts that belonged to other steps are kept, in the step they serve.
  const planNode = (
    <>
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
          canRelease={engagement.phaseProgress?.viewerCanRelease ?? false}
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
              (item) => item.status === "OPEN" && item.kind !== "CONFLICT",
            ).length ?? 0
          }
          href={planningHref(ids.organizationId, ids.projectId, {
            control: control.id,
          })}
        />
      )}
    </>
  );
  const priorNode = (
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
  );
  const basisNode = (
    <>
      {planWorkspace !== null ? null : (
        <TestBasisCard ids={ids} basis={engagement.testBasis ?? null} />
      )}
    </>
  );
  const definitionNode = (
    <>
      {planWorkspace !== null ? null : context === null ? (
        <p className="form-hint">
          The control's definition could not be loaded. Refresh to try again.
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
  );
  const approvalsNode = (
    <section className="cw-plain ws-section" aria-labelledby="ws-approvals">
      <h2 id="ws-approvals">Approvals and sign-offs</h2>
      <ul className="ws-approvals">
        {approvals.map((row) => (
          <li key={row.key} className={`is-${row.state}`}>
            <span className="ws-approval-mark" aria-hidden="true">
              <UiIcon
                name={
                  row.state === "done"
                    ? "check"
                    : row.state === "waiting"
                      ? "clock"
                      : "minus"
                }
                size={13}
              />
            </span>
            <span className="ws-approval-text">
              <strong>{row.title}</strong>
              <small>{row.detail}</small>
            </span>
            {row.tab !== "approvals" ? (
              <Link href={wsHrefs[row.tab]} scroll={false}>
                Open
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
      {(engagement.signoffs ?? []).length > 0 ? (
        <>
          <h3 className="ws-subhead">On record</h3>
          <ul className="ws-receipts">
            {(engagement.signoffs ?? []).map((item) => (
              <li key={item.id}>
                {receiptText(item)} · {formatDate(item.signedAt)}
                {item.reopenedAt !== null ? (
                  <small>{reopenText(item)}</small>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
  const phaseReasons = (evidencePlan?.phases ?? []).filter(
    (phase) => phase.rationale.trim() !== "",
  );
  const scopeNode = (
    <>
      <dl className="stp-facts">
        <div>
          <dt>Testing phases</dt>
          <dd>
            {(evidencePlan?.phases ?? [])
              .filter((phase) => phase.applicability !== "NOT_APPLICABLE")
              .map((phase) => phase.label)
              .join(", ") || "Set with the test plan"}
          </dd>
        </div>
        <div>
          <dt>Nature</dt>
          <dd>{sentence(natureText(control)) || "Not stated"}</dd>
        </div>
        <div>
          <dt>Frequency</dt>
          <dd>{sentence(frequencyText(control)) || "Not stated"}</dd>
        </div>
        <div>
          <dt>Sample size</dt>
          <dd>
            {control.sampleSize !== null && control.sampleSize !== undefined
              ? String(control.sampleSize)
              : "Set with the test plan"}
          </dd>
        </div>
      </dl>
      {phaseReasons.length > 0 ? (
        <>
          <h4 className="stp-subhead">Why each phase applies</h4>
          <ul className="stp-rows">
            {phaseReasons.map((phase) => (
              <li key={phase.phase}>
                <span className="stp-row-main">
                  <strong>{phase.label}</strong>
                  <small>{phase.rationale}</small>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
  const stepDetails: Array<{
    key: string;
    title: string;
    line: string;
    body: ReactNode;
  }> =
    opened === "understanding"
      ? [
          {
            key: "definition",
            title: "Control definition",
            line: "The control's definition and anything in it to decide",
            body: definitionNode,
          },
          {
            key: "prior",
            title: "Prior year",
            line: "Last year's testing of this control",
            body: priorNode,
          },
        ]
      : opened === "testdesign"
        ? [
            {
              key: "scope",
              title: "Scope and sampling",
              line: "The phases tested, the sample, and why each phase applies",
              body: scopeNode,
            },
            {
              key: "plan",
              title: "The full test plan",
              line: "Understanding, procedures, attributes, evidence and history",
              body: planNode,
            },
            {
              key: "basis",
              title: "Testing basis",
              line: "The methodology and plan revision the testing follows",
              body: basisNode,
            },
          ]
        : opened === "conclusion"
          ? [
              {
                key: "approvals",
                title: "Approvals and sign-offs",
                line: "Every approval on this control, and the sign-offs on record",
                body: approvalsNode,
              },
            ]
          : [];
  const panelContent = (
    <>
      {section === "conclusion" ? (
        engagement.controlConclusion === null ? (
          <p className="cs-empty">
            The control's conclusion could not be loaded. Refresh the page to
            try again.
          </p>
        ) : (
          <ControlConclusionWork
            ids={{
              organizationId: ids.organizationId,
              projectId: ids.projectId,
              controlId: control.id,
            }}
            conclusion={engagement.controlConclusion}
            notice={engagement.controlConclusionNotice}
          />
        )
      ) : null}
      {section === "workpaper" ? (
        <div className="stp-papers">
          <h4 className="stp-subhead">Design and implementation</h4>
          <WorkpapersTab compact {...workpaperProps} stage="DESIGN" />
          <h4 className="stp-subhead">Operating effectiveness</h4>
          <WorkpapersTab compact {...workpaperProps} stage="EFFECTIVENESS" />
        </div>
      ) : null}
      {section === "setup-answers" ? (
        <>
          {/* The understanding shows once: as the planner's draft to review (product owner,
              9 November 2026: "there is already what is understood, then another
              understanding below"). The summary card it replaced is not shown here. */}
          {/* Governing documents moved to D&I Evidence (9 November 2026): nothing here
              waited on them, and the policy is a D&I evidence item. */}
          {setupFor(["answers", "process"], true)}
        </>
      ) : null}
      {/* The attributes have their own step before both branches (11 November 2026);
          Scope & Sampling holds the rest of the test plan. */}
      {section === "setup-attributes"
        ? setupFor(["attributes"], false, true)
        : null}
      {section === "setup-plan" ? setupFor(["plan"], false, true) : null}
      {section === "design-conclusion" ? (
        <DesignConclusionPanel
          ids={{
            organizationId: ids.organizationId,
            projectId: ids.projectId,
            controlId: control.id,
          }}
          conclusion={engagement.designConclusion}
          notice={engagement.designConclusionNotice}
          assessmentHref={stepHrefsWf.designassessment}
        />
      ) : null}
      {openStep !== null && NOT_YET_BUILT[openStep.key] !== undefined ? (
        <p className="wf-not-yet" role="note">
          {NOT_YET_BUILT[openStep.key]}
        </p>
      ) : null}
      {/* Risk & Scoping and Test Design keep the control's context or the assistant
              beside them; the other sections take the panel's width. */}
      {opened === "setup" ? (
        <ControlDetails
          ids={{
            organizationId: ids.organizationId,
            projectId: ids.projectId,
            controlId: control.id,
          }}
          controlRef={control.controlRef}
          system={control.applicationName}
          rows={detailRows}
          frequencies={FREQUENCIES}
          natures={NATURES}
          nextHref={stepHrefsWf.understanding ?? null}
          setupHref={contextEdit}
        />
      ) : null}
      {tab !== "flow" ? (
        <RecordFold folded={opened === "setup"}>
          <div
            className={`cw-layout is-tabbed${tab === "risk" ? "" : " is-wide"}`}
          >
            <div className="cw-main">
              <div className="record-tab cw-body" id="cw-work">
                {tab === "risk" ? (
                  <RiskScoping
                    risk={control.risk}
                    objective={objective}
                    statement={control.activity}
                    scope={[
                      [
                        {
                          label: "Scope",
                          value: control.included ? "In scope" : "Out of scope",
                        },
                        {
                          label: "Nature",
                          value: sentence(natureText(control)) || "Not stated",
                        },
                      ],
                      [
                        {
                          label: "Key control",
                          value: control.keyControl ? "Yes" : "No",
                        },
                        {
                          label: "Testing phases",
                          value:
                            (evidencePlan?.phases ?? [])
                              .filter(
                                (phase) =>
                                  phase.applicability !== "NOT_APPLICABLE",
                              )
                              .map((phase) => phase.label)
                              .join(", ") || "Set with the test plan",
                        },
                      ],
                      [
                        {
                          label: "System",
                          value: control.applicationName || "None",
                        },
                        {
                          label: "Sample size",
                          value:
                            control.sampleSize !== null &&
                            control.sampleSize !== undefined
                              ? String(control.sampleSize)
                              : "Set with the test plan",
                        },
                      ],
                      [
                        {
                          label: "Environment",
                          value:
                            ENVIRONMENT_LABEL[
                              control.applicationEnvironment ?? ""
                            ] || "Not stated",
                        },
                      ],
                      [
                        {
                          label: "Frequency",
                          value:
                            sentence(frequencyText(control)) || "Not stated",
                        },
                      ],
                    ]}
                    phases={[]}
                  />
                ) : null}
                {tab === "design" ? (
                  stages.find((item) => item.key === "design")?.status !==
                  "not_applicable" ? (
                    <PhasePanel
                      number={1}
                      title="Design and walkthrough"
                      summary="Understand the control design and perform a walkthrough."
                      state={lifeState("design")}
                    >
                      <PhaseStep
                        number={1}
                        title="Walkthrough and design workpaper"
                        state={paperState("DESIGN")}
                        waits="Starts when design evidence has been read"
                        keepOpen={keepWorkpaper}
                        plain
                      >
                        <WorkpapersTab
                          compact
                          {...workpaperProps}
                          stage="DESIGN"
                        />
                      </PhaseStep>
                    </PhasePanel>
                  ) : null
                ) : null}
                {/* Until its requests are drafted, the D&I Evidence step is one list:
                  what will be requested, each request with the attributes it addresses
                  and its acceptance, the coverage under it, and the attributes, the
                  optional governing documents and the history as quiet rows (product
                  owner, 12 November 2026: no Release button, no second list). */}
                {tab === "evidence" &&
                opened === "designevidence" &&
                designRequests.mode !== "hidden" ? (
                  <DesignRequests
                    // What is open, typed or just done belongs to this control: a
                    // sibling control opened next starts a fresh list.
                    key={control.id}
                    ids={ids}
                    view={designRequests}
                    canAct={canAct}
                    documents={{
                      line: governingLine,
                      body: setupFor(["documents"]),
                    }}
                  />
                ) : null}
                {/* Once the requests are drafted the step is still one list: the
                    requests, each with where it stands and the evidence that came back
                    (product owner, 12 November 2026). */}
                {tab === "evidence" &&
                opened === "designevidence" &&
                designEvidence !== null &&
                evidencePlan !== null ? (
                  <DesignEvidence
                    key={control.id}
                    ids={stepIds}
                    view={designEvidence}
                    plan={evidencePlan}
                    canAct={canAct}
                    files={(engagement.files?.files ?? []).map((file) => ({
                      id: file.id,
                      fileName: file.fileName,
                      requestId: file.request?.id ?? null,
                      blocked: changeBlocked(file),
                      applicationUnknown: file.applicationScope === "UNKNOWN",
                      createdAt: file.createdAt,
                      sizeBytes: file.sizeBytes,
                      addedBy: file.addedBy,
                    }))}
                    applications={engagement.files?.applications ?? []}
                    system={
                      (engagement.files?.applications ?? []).find(
                        (app) => app.name === control.applicationName,
                      )?.id ?? null
                    }
                    intelligence={{
                      register: engagement.files,
                      mapping:
                        engagement.evidenceMapping != null &&
                        engagement.evidenceMapping.controlId === control.id
                          ? engagement.evidenceMapping
                          : null,
                      attributes:
                        engagement.masterPlan != null &&
                        engagement.masterPlan.controlId === control.id
                          ? engagement.masterPlan.attributes.map((item) => ({
                              code: item.code,
                              text: item.text,
                            }))
                          : [],
                      controlTitle: control.title,
                      askHref,
                      focusFile: engagement.filters.focusFile ?? null,
                      openAdd: engagement.filters.evidenceView === "add",
                      findings: engagement.evidenceFindings ?? null,
                      tests: (engagement.tests ?? []).filter(
                        (entry) => entry.controlId === control.id,
                      ),
                      instances: engagement.walkthroughInstances ?? null,
                    }}
                    controlRef={control.controlRef}
                    activity={engagement.activity ?? null}
                    head={<RequestHead model={model} review={requestReview} />}
                    library={
                      <ControlEvidence
                        model={model}
                        control={control}
                        step={formStep}
                        files={engagement.files}
                        notice={engagement.changeNotice}
                        serves={fileServes(evidencePlan)}
                        placed={placedFiles(evidencePlan)}
                      />
                    }
                    otherFiles={
                      (engagement.files?.files ?? []).filter(
                        (file) => !placedFiles(evidencePlan).has(file.id),
                      ).length
                    }
                    documents={{
                      line: governingLine,
                      body: setupFor(["documents"]),
                    }}
                    stepHref={stepHrefsWf.designevidence}
                    focusView={engagement.filters.evidenceView ?? null}
                  />
                ) : null}
                {/* The requests list is the one list until then; any other step, and a
                    D&I phase the list cannot be read for, keeps the evidence workspace
                    (product owner, 12 November 2026: no duplicated evidence list). */}
                {tab === "evidence" &&
                !(opened === "designevidence" && designEvidence !== null) &&
                showsEvidenceWorkspace(opened, designRequests) ? (
                  <EvidenceWorkspace
                    ids={stepIds}
                    only={
                      opened === "designevidence"
                        ? ["DESIGN"]
                        : opened === "oeevidence"
                          ? ["INTERIM", "ROLLFORWARD"]
                          : null
                    }
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
                    // The evidence workspace (docs/evidence-intelligence.md): the control's
                    // file register and readings, the latest mapping, and the attributes'
                    // codes in the mapping's order.
                    intelligence={{
                      register: engagement.files,
                      mapping:
                        engagement.evidenceMapping != null &&
                        engagement.evidenceMapping.controlId === control.id
                          ? engagement.evidenceMapping
                          : null,
                      attributes:
                        engagement.masterPlan != null &&
                        engagement.masterPlan.controlId === control.id
                          ? engagement.masterPlan.attributes.map((item) => ({
                              code: item.code,
                              text: item.text,
                            }))
                          : [],
                      controlTitle: control.title,
                      askHref,
                      focusFile: engagement.filters.focusFile ?? null,
                      openAdd: engagement.filters.evidenceView === "add",
                      findings: engagement.evidenceFindings ?? null,
                      tests: (engagement.tests ?? []).filter(
                        (entry) => entry.controlId === control.id,
                      ),
                      instances: engagement.walkthroughInstances ?? null,
                    }}
                    files={(engagement.files?.files ?? []).map((file) => ({
                      id: file.id,
                      fileName: file.fileName,
                      requestId: file.request?.id ?? null,
                      blocked: changeBlocked(file),
                      // Only when the coordinator could not tell; a file still being read
                      // has no tag yet, and one on an instance's request takes its application.
                      applicationUnknown: file.applicationScope === "UNKNOWN",
                      createdAt: file.createdAt,
                      sizeBytes: file.sizeBytes,
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
                        (evidencePlan?.phases ?? []).map(
                          (phase) => phase.phase,
                        ),
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
                        head: (
                          <RequestHead model={model} review={requestReview} />
                        ),
                      };
                    })()}
                    library={
                      <ControlEvidence
                        model={model}
                        control={control}
                        step={formStep}
                        files={engagement.files}
                        notice={engagement.changeNotice}
                        serves={fileServes(evidencePlan)}
                        placed={placedFiles(evidencePlan)}
                      />
                    }
                    rcmItems={control.pbcItems}
                  />
                ) : null}
                {/* Optional, so it folds under the evidence once the requests are drafted;
                  before, it is a row under the requests list (11 November 2026; moved here
                  from Control Understanding, 9 November 2026). */}
                {tab === "evidence" &&
                opened === "designevidence" &&
                designEvidence === null &&
                designRequests.mode === "hidden" ? (
                  <details className="stp-fold dr-docs">
                    <summary>
                      <span>
                        <strong>Governing documents</strong>
                        <small>{governingLine}</small>
                      </span>
                      <UiIcon name="chevron" size={14} />
                    </summary>
                    <div className="stp-fold-body">
                      {setupFor(["documents"])}
                    </div>
                  </details>
                ) : null}
                {tab === "testing" ? (
                  // The testing workspace (product owner's reference, 30 October 2026): the
                  // heading, the trace of records, then the phases as cards whose rows
                  // fold to a line until they need a person.
                  <section className="cw-work" aria-labelledby="cw-work-title">
                    <header className="cw-work-head">
                      <div>
                        <h2 id="cw-work-title">Testing workspace</h2>
                        <p>
                          Complete the testing activities for this control using
                          the steps below.
                        </p>
                      </div>
                      <a className="btn-secondary btn-sm" href={stepHrefs.PLAN}>
                        <UiIcon name="file" size={13} />
                        View test plan
                      </a>
                    </header>
                    {trace !== null ? (
                      <TraceRail nodes={trace.nodes} rows={trace.rows} />
                    ) : null}
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
                          <a href={wsHrefs.approvals}>Open the assessment</a>
                        </span>
                      </p>
                    ) : null}
                    <PhasePanel
                      number={1}
                      title="Interim testing"
                      summary="Test control operating effectiveness for the interim period."
                      state={lifeState("interim")}
                    >
                      {test !== null || sheet?.method !== "TEST_OF_ONE" ? (
                        <PhaseStep
                          number={1}
                          title="Population and sample"
                          hint="Define the population and sample for testing."
                          icon="user"
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
                      {engagement.evidenceMapping === undefined
                        ? null
                        : (() => {
                            const run =
                              engagement.evidenceMapping !== null &&
                              engagement.evidenceMapping.controlId ===
                                control.id
                                ? engagement.evidenceMapping
                                : null;
                            return (
                              <PhaseStep
                                number={2}
                                title="Evidence mapping"
                                hint="Map evidence to the control attributes."
                                icon="database"
                                state={
                                  run === null
                                    ? "todo"
                                    : run.stale
                                      ? "issue"
                                      : "done"
                                }
                                note={
                                  run === null ? undefined : mappingSummary(run)
                                }
                                waits="Not mapped yet"
                              >
                                <EvidenceMappingPanel
                                  run={run}
                                  ids={{
                                    organizationId: ids.organizationId,
                                    projectId: ids.projectId,
                                    controlId: control.id,
                                  }}
                                  back={stepHrefs.TEST ?? ""}
                                  canMap={true}
                                />
                              </PhaseStep>
                            );
                          })()}
                      <PhaseStep
                        number={3}
                        title="Test results and sign-off"
                        hint="Record test results and obtain sign-off."
                        icon="chart"
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
                        number={4}
                        title="Interim workpaper"
                        hint="Complete the interim testing workpaper."
                        icon="file"
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
                    {stages.find((item) => item.key === "rollforward")
                      ?.status !== "not_applicable" ? (
                      <PhasePanel
                        number={2}
                        title="Roll-forward and retests"
                        summary="Perform roll-forward procedures and any required retesting."
                        state={lifeState("rollforward")}
                      >
                        <PhaseStep
                          number={1}
                          title="Rounds"
                          hint="Test any interim items signed off before year end."
                          icon="retry"
                          state={
                            rounds.length === 0
                              ? "todo"
                              : lifeState("rollforward")
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
                                A roll-forward round starts when interim testing
                                is signed off effective; a retest when a
                                deficiency is marked ready.
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
                          hint="Complete roll-forward testing for the first round."
                          icon="file"
                          state={
                            rounds.length === 0
                              ? "todo"
                              : lifeState("rollforward")
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
                  </section>
                ) : null}
                {withFindings ? (
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
                          that no person has confirmed. They are not audit
                          findings until a person decides them on the test sheet
                          and logs a deficiency.
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
                {tab === "approvals" ? (
                  <>
                    <ImpactPanel
                      assessments={impact}
                      ids={ids}
                      hrefs={{
                        test: stepHrefs.TEST,
                        review: stepHrefs.REVIEW,
                      }}
                    />
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
                            No review of the control's own has opened. It opens
                            when the testing is signed off and the effectiveness
                            workpaper is prepared; the rounds' reviews are
                            listed below.
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
                          The results this review covers await a reviewer's
                          impact decision.
                          <a href={wsHrefs.approvals}>Open the assessment</a>
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
                  </>
                ) : null}
              </div>
              {/* The audit trail opens from History (the section menu, or a control's link
                  in the Controls list); it is not repeated under every step (product owner,
                  26 October 2026), and the Plan step keeps it in its History tab. */}
              {showActivity && masterHere !== null ? (
                <PlanVersionsCard versions={planVersions(masterHere)} />
              ) : null}
              {showActivity ? (
                <details className="cw-fold cw-activity" id="activity" open>
                  <summary>
                    <span>
                      <strong>Activity</strong>
                      <small>
                        The audit trail: agents' work, people's decisions, and
                        the workspace's steps.
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
            {tab === "risk" ? (
              <aside className="cw-rail" aria-label="Control context">
                <ControlContextCard
                  editHref={contextEdit}
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
              </aside>
            ) : null}
          </div>
        </RecordFold>
      ) : null}
    </>
  );
  // Control Understanding's review carries its own header, with the agent and the progress
  // (mock-up approved 9 November 2026): the frame's need card and the drawer's count are not
  // repeated around it.
  const ownHeader =
    openStep?.key === "setup" ||
    (openStep?.key === "understanding" &&
      context !== null &&
      setupInput !== null);
  const stepPanel =
    openStep === null ? (
      panelContent
    ) : (
      <StepFrame
        frame={panelFrame(
          openStep.key,
          workflow,
          engagement.designConclusion?.status === "SIGNED_OFF"
            ? (engagement.designConclusion.signed?.verdict ?? null)
            : null,
        )}
        stepHrefs={stepHrefsWf}
        askHref={askHref}
        about={{ ref: control.controlRef, title: control.title }}
        agent={agentNote(openStep, workflowInput)}
        preparedTitle={PREPARED_TITLE[openStep.key]}
        prepared={panelContent}
        details={stepDetails}
        bare={ownHeader}
      />
    );

  return (
    <div className="page record-page cx cw">
      <HashScroll />
      <ControlBar
        heroId="cw-hero"
        controlRef={control.controlRef}
        title={control.title}
        status={stage.label}
        statusClass={statusClass}
        step={WORKSPACE_TABS.find((item) => item.key === tab)?.label ?? ""}
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
            {CATEGORY_LABEL[control.category] ? (
              <>
                <UiIcon name="chevron" size={12} />
                <span>{CATEGORY_LABEL[control.category]}</span>
              </>
            ) : null}
            {control.applicationName !== "" &&
            control.applicationId !== null ? (
              <>
                <UiIcon name="chevron" size={12} />
                <span>
                  System:{" "}
                  <a
                    href={`${href(model, {})}&pane=systems&system=${control.applicationId}`}
                  >
                    {control.applicationName}
                  </a>
                </span>
              </>
            ) : null}
          </nav>
          <h1>
            <span className="cw-ref">{control.controlRef}</span>
            <span className="cw-title">{control.title}</span>
            <span className={statusClass}>
              <span className="sr-only">Status: </span>
              {stage.label}
            </span>
            {source !== "" ? <span className="cw-source">{source}</span> : null}
          </h1>
          {objective !== "" ? (
            <p className="cw-objective">{objective}</p>
          ) : null}
        </div>
        <div className="cw-hero-actions">
          {needs.mine && needsHref !== null ? (
            <a className="cw-needs-badge" href={needsHref} title={needs.title}>
              <UiIcon name="info" size={15} />
              Needs you
            </a>
          ) : null}
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
      <NextStepCard
        next={upNext}
        stages={stagesOf(workflow)}
        hrefs={stepHrefsWf}
        askHref={askHref}
      />
      <ControlWorkflow
        steps={workflow}
        hrefs={stepHrefsWf}
        opened={openStep?.key ?? null}
        activityHref={wsHrefs.history}
        flags={flags}
      />
      {opened !== null ? (
        <WorkflowPanel
          key={opened}
          step={openStep?.key ?? null}
          kicker={
            openStep !== null
              ? `${String(openStep.number).padStart(2, "0")} · ${KIND_LABELS[openStep.kind]}`
              : "Record"
          }
          title={openStep?.title ?? "Activity"}
          tone={openStep?.tone ?? null}
          status={
            ownHeader
              ? ""
              : (openStep?.status ??
                "Everything done on this control, and by whom.")
          }
          closeHref={wsHrefs.flow}
          previous={around(-1)}
          next={around(1)}
        >
          {stepPanel}
        </WorkflowPanel>
      ) : null}
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
  step,
  files,
  notice,
  serves,
  placed,
}: {
  model: Ready;
  control: ControlRow;
  /** The workflow step the files show on, posted so the page comes back to it. */
  step: string | null;
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
                                  {step ? (
                                    <input
                                      type="hidden"
                                      name="step"
                                      value={step}
                                    />
                                  ) : null}
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
                                step={step}
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
