import type { ReactNode } from "react";
import {
  analysisFor,
  analysisInProgress,
  type EvidenceAnalysis,
  type EvidenceReview,
  reviewFor,
} from "./analysis-model";
import {
  ANALYSIS_NOTICES,
  AnalysisPanel,
  EvidenceReadingCard,
} from "./analysis-view";
import { AutoRefresh } from "./auto-refresh";
import { ChoiceForm } from "./choice-form";
import { ClientsTable } from "./clients-table";
import { ConfirmAction } from "./confirm-action";
import {
  type ConsoleState,
  EMPTY_CONSOLE,
  type WaitingItem,
  waitingHref,
} from "./console-model";
import { ConsoleMain } from "./console-view";
import {
  type DirectoryQuery,
  directoryHref,
  EMPTY_DIRECTORY,
  filterTasks,
  PRIORITIES,
  paginate,
  TASK_STATUSES,
  upcomingDeadlines,
} from "./directory";
import {
  createEngagementHref,
  EngagementCreatePage,
  editEngagementHref,
} from "./engagement-create";
import {
  archiveConsequence,
  COMPLETE_CONSEQUENCE,
  canCloseOut,
  closedNotice,
  deleteConsequence,
  detailsEditable,
  requestsClosedReason,
  statusActions,
  statusMeaning,
} from "./engagement-lifecycle";
import { EMPTY_ENGAGEMENT, type EngagementState } from "./engagement-model";
import {
  ControlsMain,
  DeficienciesMain,
  EngagementDashboard,
  PlanMain,
  TimelineMain,
} from "./engagement-view";
import { EngagementsBoard } from "./engagements-board";
import {
  cardEntry,
  type EngagementsView,
  openEngagements,
  portfolioLine,
} from "./engagements-model";
import { EvidenceCenter } from "./evidence-center";
import { centerHref, DEFAULT_QUERY, exportHref } from "./evidence-center-model";
import {
  DEFAULT_EVIDENCE_VIEW,
  type EvidenceView,
  fileCounts,
  uploadBlocked,
} from "./evidence-model";
import { EvidenceFiles } from "./evidence-view";
import {
  agentMonogram,
  formatBytes,
  formatDate,
  formatDuration,
  initials,
  monogram,
} from "./format";
import type { EvidenceCenterState } from "./load-evidence-center";
import type { PlanningPageState } from "./load-planning";
import { LoadingScreen } from "./loading-screen";
import { NavScroll } from "./nav-scroll";
import {
  EMPTY_SETUP,
  type Onboarding,
  type SetupState,
  uniqueKeys,
} from "./onboarding-model";
import { PlanMissingButton } from "./plan-missing";
import { PlanningPage } from "./planning-view";
import type { RecipientLink } from "./portal-model";
import { RecordDialog } from "./record-dialog";
import { SetupForm } from "./setup-form";
import { SetupCallout, SetupMain, showsSetupCallout } from "./setup-view";
import {
  type AgentDetail,
  type AgentNotice,
  canManageProjects,
  LAUNCHED_SECTIONS,
  lockedBeforeLaunch,
  type Organization,
  type Project,
  type ProjectDetail,
  type ProjectNotice,
  projectLabels,
  roleLabel,
  type SectionId,
  type ShellModel,
  showsSignInPrompt,
  type TaskDetail,
  type TaskNotice,
  taskStatusChoices,
  workspaceHref,
} from "./shell-model";
import { type IconName, UiIcon } from "./ui-icon";
import { VisitRecorder } from "./visit-recorder";
import {
  type ApprovalItem,
  type AttentionItem,
  actionLabel,
  approvalRequestId,
  approvalState,
  attentionQueue,
  auditPhase,
  canDecide,
  canFollowUpNow,
  canRequestEvidence,
  canRetryDelivery,
  type DecisionNotice,
  type DeliveryTone,
  deliveryLabel,
  EMPTY_WORKFLOW,
  type EvidenceContacts,
  type EvidenceFile,
  type EvidenceNotice,
  type EvidenceRequest,
  evidenceFileFor,
  type InboundReply,
  isLateEvidence,
  isOutstandingEvidence,
  latestOutbound,
  type MailboxMode,
  pendingApprovals,
  type ReminderStep,
  readyToSend,
  relativeTime,
  reminderStep,
  remindersSent,
  repliesToReview,
  supersededSend,
  unmatchedLabel,
  unmatchedReplies,
  type WorkflowState,
} from "./workflow-model";

type Ready = Extract<ShellModel, { status: "ready" }>;

type NavItem = {
  id: SectionId;
  label: string;
  detail: string;
  icon: IconName;
};

const NAV_GROUPS: ReadonlyArray<{ label: string; items: NavItem[] }> = [
  {
    label: "Engagement",
    items: [
      {
        id: "console",
        label: "Agent console",
        detail: "Ask the workforce and confirm its work",
        icon: "sparkles",
      },
      {
        id: "overview",
        label: "Dashboard",
        detail: "Health at a glance",
        icon: "grid",
      },
      {
        id: "controls",
        label: "Controls",
        detail: "The controls register",
        icon: "shield",
      },
      {
        id: "planning",
        label: "Test plans",
        detail: "Review and approve",
        icon: "check",
      },
      {
        id: "plan",
        label: "Project plan",
        detail: "Work by phase",
        icon: "activity",
      },
      {
        id: "timeline",
        label: "Timeline",
        detail: "Phases and milestones",
        icon: "clock",
      },
      {
        id: "evidence",
        label: "Evidence",
        detail: "Requests and responses",
        icon: "inbox",
      },
      {
        id: "deficiencies",
        label: "Deficiencies",
        detail: "Findings and remediation",
        icon: "risk",
      },
      {
        id: "approvals",
        label: "Approvals",
        detail: "Human decisions",
        icon: "check",
      },
    ],
  },
  {
    label: "Setup",
    items: [
      {
        id: "setup",
        label: "Engagement settings",
        detail: "Scope, team, RCM, and PBC",
        icon: "sparkles",
      },
      {
        id: "agents",
        label: "AI workforce",
        detail: "Roles and limits",
        icon: "agents",
      },
      {
        id: "projects",
        label: "Engagements",
        detail: "Portfolio and scope",
        icon: "briefcase",
      },
    ],
  },
];

const NAV = NAV_GROUPS.flatMap((group) => group.items);

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const STATUS_TONES: Record<string, Tone> = {
  ACTIVE: "success",
  COMPLETED: "info",
  SUCCEEDED: "success",
  READY: "info",
  QUEUED: "info",
  RUNNING: "info",
  WAITING: "info",
  REVIEW: "info",
  PAUSED: "warning",
  HIGH: "warning",
  MODERATE: "warning",
  BLOCKED: "danger",
  FAILED: "danger",
  URGENT: "danger",
};

function toneClass(tone: Tone): string {
  return tone === "neutral" ? "" : `tone-${tone}`;
}

function statusTone(status: string): Tone {
  return STATUS_TONES[status] ?? "neutral";
}

export function WorkspaceView({
  model,
  directory = EMPTY_DIRECTORY,
  workflow = EMPTY_WORKFLOW,
  now = 0,
  creatingAgent = false,
  creatingEngagement = false,
  editingEngagement = false,
  managingEngagement = false,
  engagementsView = "engagements",
  setup = EMPTY_SETUP,
  engagement = EMPTY_ENGAGEMENT,
  logFor = null,
  consoleState = EMPTY_CONSOLE,
  evidenceView = DEFAULT_EVIDENCE_VIEW,
  evidenceCenter = null,
  planning = null,
}: {
  model: ShellModel;
  directory?: DirectoryQuery;
  workflow?: WorkflowState;
  now?: number;
  creatingAgent?: boolean;
  creatingEngagement?: boolean;
  editingEngagement?: boolean;
  /** `manage=engagement`: an engagement's status and close-out, opened from its card. */
  managingEngagement?: boolean;
  engagementsView?: EngagementsView;
  setup?: SetupState;
  engagement?: EngagementState;
  logFor?: string | null;
  consoleState?: ConsoleState;
  evidenceView?: EvidenceView;
  evidenceCenter?: EvidenceCenterState | null;
  planning?: PlanningPageState | null;
}) {
  const waiting =
    workflow.approvals === null
      ? null
      : pendingApprovals(workflow.approvals, now).length;
  return (
    <div className="shell">
      <a className="skip" href="#content">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <UiIcon name="logo" size={16} />
          </span>
          <span className="brand-text">
            <strong>AI Workforce</strong>
            <small>
              {model.status === "ready"
                ? model.organization.name
                : "IT audit delivery"}
            </small>
          </span>
        </div>
        {model.status === "ready" ? (
          <nav aria-label="Workspace">
            <NavScroll />
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="nav-group">
                <p className="nav-label">{group.label}</p>
                <ul>
                  {group.items.map((item) => {
                    const locked = lockedBeforeLaunch(
                      item.id,
                      model.selectedProject,
                    );
                    return (
                      <li key={item.id}>
                        <a
                          href={workspaceHref(
                            item.id,
                            model.organization.id,
                            model.selectedProject?.id ?? null,
                          )}
                          title={
                            locked
                              ? "Opens once the engagement is launched"
                              : item.detail
                          }
                          className={locked ? "nav-locked" : undefined}
                          aria-current={
                            model.section === item.id ? "page" : undefined
                          }
                        >
                          <UiIcon name={item.icon} size={16} />
                          <span>{item.label}</span>
                          {item.id === "approvals" &&
                          waiting !== null &&
                          waiting > 0 ? (
                            <span
                              className="nav-badge"
                              role="status"
                              aria-label={`${waiting} waiting`}
                            >
                              {waiting}
                            </span>
                          ) : null}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        ) : !showsSignInPrompt(model) ? (
          // Still loading, not signed out: placeholders, never the sign-in prompt.
          <div className="sidebar-loading" aria-hidden="true">
            {[72, 56, 64, 48, 60, 52].map((width) => (
              <span key={width} style={{ width: `${width}%` }} />
            ))}
          </div>
        ) : (
          <p className="sidebar-note">Navigation appears after sign-in.</p>
        )}
        {model.status === "ready" ? (
          <SidebarControls
            waiting={waiting}
            mailboxMode={workflow.mailboxMode}
          />
        ) : null}
      </aside>
      <div className="workspace">
        <header className="topbar">
          {model.status === "ready" ? (
            <WorkspaceControls model={model} />
          ) : showsSignInPrompt(model) ? (
            <p className="topbar-title">Sign in to open an engagement</p>
          ) : null}
        </header>
        <main
          id="content"
          className="content"
          aria-busy={model.status === "loading"}
        >
          {model.status === "ready" &&
          model.selectedProject !== null &&
          model.section !== "projects" ? (
            <VisitRecorder projectId={model.selectedProject.id} />
          ) : null}
          {model.status === "ready" &&
          model.selectedProject !== null &&
          LAUNCHED_SECTIONS.includes(model.section) &&
          closedNotice(model.selectedProject.status) !== null ? (
            <p className="closed-strip" role="status">
              <UiIcon name="shield" size={14} />
              <span>{closedNotice(model.selectedProject.status)}</span>
            </p>
          ) : null}
          <WorkspaceMain
            model={model}
            directory={directory}
            workflow={workflow}
            now={now}
            creatingAgent={creatingAgent}
            creatingEngagement={creatingEngagement}
            editingEngagement={editingEngagement}
            managingEngagement={managingEngagement}
            engagementsView={engagementsView}
            setup={setup}
            engagement={engagement}
            logFor={logFor}
            consoleState={consoleState}
            evidenceView={evidenceView}
            evidenceCenter={evidenceCenter}
            planning={planning}
          />
        </main>
      </div>
    </div>
  );
}

function SidebarControls({
  waiting,
  mailboxMode,
}: {
  waiting: number | null;
  mailboxMode: MailboxMode | null;
}) {
  return (
    <section className="sidebar-foot" aria-label="Safeguards">
      {waiting === null ? null : (
        <div className="guard-row">
          <span>Approvals</span>
          <span
            className={`pill pill-dot ${waiting > 0 ? "tone-warning" : "tone-success"}`}
          >
            {waiting === 0 ? "Clear" : `${waiting} waiting`}
          </span>
        </div>
      )}
      {mailboxMode === "live" || mailboxMode === "test" ? (
        <div className="guard-row">
          <span>Live email</span>
          <span
            className={`pill pill-dot ${mailboxMode === "live" ? "tone-warning" : ""}`}
          >
            {mailboxMode === "live" ? "On" : "Off"}
          </span>
        </div>
      ) : null}
      <p>Agents propose. People approve every sensitive action.</p>
    </section>
  );
}

function WorkspaceControls({ model }: { model: Ready }) {
  const sectionLabel =
    NAV.find((item) => item.id === model.section)?.label ?? "Dashboard";
  return (
    <>
      <nav aria-label="Breadcrumb">
        <ol className="crumbs">
          <li className="crumb-org">
            {model.organizations.length > 1 ? (
              <div className="crumb-select">
                <ChoiceForm
                  label="Firm"
                  name="organization"
                  value={model.organization.id}
                  options={model.organizations.map((organization) => ({
                    value: organization.id,
                    label: organization.name,
                  }))}
                  hidden={[{ name: "section", value: model.section }]}
                />
              </div>
            ) : (
              <span className="crumb">{model.organization.name}</span>
            )}
          </li>
          <li>
            <ProjectSelector
              organization={model.organization}
              projects={model.projects}
              selectedProject={model.selectedProject}
              section={model.section}
            />
          </li>
          <li className="crumb-section">
            <span className="crumb crumb-current" aria-current="page">
              {sectionLabel}
            </span>
          </li>
        </ol>
      </nav>
      <div className="topbar-actions">
        <details className="menu">
          <summary className="icon-button" aria-label="Notifications">
            <UiIcon name="bell" size={17} />
          </summary>
          <div id="notifications" className="menu-panel">
            <div className="menu-heading">
              <strong>Notifications</strong>
            </div>
            {model.notifications === "empty" ? (
              <p>You're all caught up.</p>
            ) : (
              <p role="alert">Notifications could not be loaded.</p>
            )}
          </div>
        </details>
        <details className="menu">
          <summary className="profile-trigger" aria-label="Account">
            <span className="avatar" aria-hidden="true">
              {initials(model.email)}
            </span>
            <span className="profile-copy">
              <strong>{model.email.split("@")[0]}</strong>
              <small>{roleLabel(model.organization.role)}</small>
            </span>
            <UiIcon name="chevron" size={14} />
          </summary>
          <div className="menu-panel">
            <div className="menu-heading">
              <strong>{model.email}</strong>
              <span>
                {roleLabel(model.organization.role)} · {model.organization.name}
              </span>
            </div>
            <form autoComplete="off" method="post" action="/sign-out">
              <button type="submit" className="btn-secondary btn-block">
                Sign out
              </button>
            </form>
          </div>
        </details>
      </div>
    </>
  );
}

function ProjectSelector({
  organization,
  projects,
  selectedProject,
  section,
}: {
  organization: Organization;
  projects: Project[];
  selectedProject: Project | null;
  section: SectionId;
}) {
  const first = projects[0];
  if (first === undefined) {
    return <span className="crumb">No engagements</span>;
  }
  const labels = projectLabels(projects);
  return (
    <div className="crumb-select">
      <ChoiceForm
        label="Engagement"
        name="project"
        value={selectedProject?.id ?? first.id}
        options={projects.map((project) => ({
          value: project.id,
          label: labels.get(project.id) ?? project.name,
        }))}
        hidden={[
          { name: "organization", value: organization.id },
          { name: "section", value: section },
        ]}
      />
    </div>
  );
}

function WorkspaceMain({
  model,
  directory,
  workflow,
  now,
  creatingAgent,
  creatingEngagement,
  editingEngagement,
  managingEngagement,
  engagementsView,
  setup,
  engagement,
  logFor,
  consoleState,
  evidenceView,
  evidenceCenter,
  planning,
}: {
  model: ShellModel;
  directory: DirectoryQuery;
  workflow: WorkflowState;
  now: number;
  creatingAgent: boolean;
  creatingEngagement: boolean;
  editingEngagement: boolean;
  managingEngagement: boolean;
  engagementsView: EngagementsView;
  setup: SetupState;
  engagement: EngagementState;
  logFor: string | null;
  consoleState: ConsoleState;
  evidenceView: EvidenceView;
  evidenceCenter: EvidenceCenterState | null;
  planning: PlanningPageState | null;
}) {
  if (model.status === "loading") {
    return <LoadingScreen />;
  }
  if (model.status === "denied") {
    return (
      <section className="state-panel">
        <span className="brand-mark" aria-hidden="true">
          <UiIcon name="logo" size={16} />
        </span>
        <h1>Sign in required</h1>
        <p>Sign in to open your firm's workspace.</p>
        <a className="btn" href="/sign-in">
          Sign in
        </a>
      </section>
    );
  }
  if (model.status === "error") {
    return (
      <section className="state-panel">
        <h1>Workspace unavailable</h1>
        <p>The workspace could not be loaded. Wait a moment and try again.</p>
        <a className="btn btn-secondary" href="/">
          Try again
        </a>
      </section>
    );
  }
  if (model.status === "empty") {
    return (
      <section className="state-panel">
        <h1>No organization yet</h1>
        <p>
          {model.email} is signed in and is not a member of an organization.
        </p>
      </section>
    );
  }
  if (lockedBeforeLaunch(model.section, model.selectedProject)) {
    return <NotLaunched model={model} />;
  }
  if (model.section === "projects") {
    return (
      <ProjectsMain
        model={model}
        creating={creatingEngagement}
        editing={editingEngagement}
        managing={managingEngagement}
        view={engagementsView}
      />
    );
  }
  if (model.section === "agents") {
    return (
      <AgentsMain model={model} workflow={workflow} creating={creatingAgent} />
    );
  }
  if (model.section === "tasks") {
    return <TasksMain model={model} directory={directory} />;
  }
  if (model.section === "evidence") {
    return (
      <EvidenceMain
        model={model}
        workflow={workflow}
        now={now}
        view={evidenceView}
        center={evidenceCenter}
      />
    );
  }
  if (model.section === "setup") {
    return <SetupMain model={model} setup={setup} />;
  }
  if (model.section === "approvals") {
    return <ApprovalsMain model={model} workflow={workflow} now={now} />;
  }
  if (model.section === "controls") {
    return <ControlsMain model={model} engagement={engagement} />;
  }
  if (model.section === "planning") {
    return <PlanningMain model={model} planning={planning} />;
  }
  if (model.section === "console") {
    return <ConsoleMain model={model} console={consoleState} />;
  }
  if (model.section === "plan") {
    return <PlanMain model={model} engagement={engagement} />;
  }
  if (model.section === "timeline") {
    return <TimelineMain model={model} engagement={engagement} />;
  }
  if (model.section === "deficiencies") {
    return (
      <DeficienciesMain model={model} engagement={engagement} logFor={logFor} />
    );
  }
  if (engagement.dashboard?.started === true) {
    return (
      <EngagementDashboard
        model={model}
        engagement={engagement}
        attention={
          <AttentionCard model={model} workflow={workflow} now={now} />
        }
      />
    );
  }
  return (
    <CommandCenter
      model={model}
      workflow={workflow}
      now={now}
      onboarding={setup.onboarding}
    />
  );
}

export function PageHeader({
  context,
  title,
  badge,
  description,
  actions,
}: {
  context?: ReactNode;
  title: string;
  badge?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {context === undefined ? null : (
          <p className="page-context">{context}</p>
        )}
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

export function CardHeader({
  title,
  titleId,
  description,
  aside,
}: {
  title: ReactNode;
  titleId?: string;
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="card-header">
      <div>
        <h2 id={titleId}>{title}</h2>
        {description === undefined ? null : (
          <p className="card-desc">{description}</p>
        )}
      </div>
      {aside === undefined ? null : <div className="card-aside">{aside}</div>}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`pill pill-dot ${toneClass(statusTone(status))}`}>
      {labelStatus(status)}
    </span>
  );
}

export function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning";
  children: ReactNode;
}) {
  return (
    <p
      className={`banner ${tone === "warning" ? "banner-warning" : ""}`}
      role="status"
    >
      <UiIcon name={tone === "warning" ? "risk" : "info"} size={16} />
      <span>{children}</span>
    </p>
  );
}

export function sectionHref(
  model: Ready,
  section: SectionId,
  taskStatus: string | null = null,
): string {
  if (taskStatus === null) {
    return workspaceHref(
      section,
      model.organization.id,
      model.selectedProject?.id ?? null,
    );
  }
  return directoryHref({
    section,
    organizationId: model.organization.id,
    projectId: model.selectedProject?.id ?? null,
    taskStatus,
  });
}

function nextStep(
  model: Ready,
  queueLength: number,
  outstandingEvidence: number,
): { lede: string; action: string; href: string } {
  const project = model.selectedProject;
  if (project === null) {
    return {
      lede: "Start by creating an engagement. Its scope, work, evidence, and decisions all live in one place.",
      action: "Create an engagement",
      href: createEngagementHref(model),
    };
  }
  if (project.status === "DRAFT") {
    return {
      lede: "This engagement is still being set up. Finish setup to start the work.",
      action: "Finish scoping",
      href: sectionHref(model, "projects"),
    };
  }
  if (queueLength > 0) {
    return {
      lede: `${queueLength} item${queueLength === 1 ? " is" : "s are"} waiting on a person. Agents keep working on everything else.`,
      action: "Work the queue",
      href: "#decision-queue",
    };
  }
  if (model.tasks.length === 0) {
    return {
      lede: "Nothing is planned yet. Add the first task and assign it to a person or an agent.",
      action: "Plan the work",
      href: sectionHref(model, "tasks"),
    };
  }
  if (outstandingEvidence === 0) {
    return {
      lede: "No action is currently required. Request evidence for each control to progress fieldwork.",
      action: "Request evidence",
      href: sectionHref(model, "evidence"),
    };
  }
  return {
    lede: "You're all caught up. Nothing is waiting on you.",
    action: "Open the work",
    href: sectionHref(model, "tasks"),
  };
}

function CommandCenter({
  model,
  workflow,
  now,
  onboarding,
}: {
  model: Ready;
  workflow: WorkflowState;
  now: number;
  onboarding: Onboarding | null;
}) {
  const project = model.selectedProject;
  const evidence = workflow.evidence ?? [];
  const approvals = workflow.approvals ?? [];
  const queue = attentionQueue({
    tasks: model.tasks,
    evidence,
    approvals,
    now,
    inbound: workflow.inbound ?? [],
    followUps: workflow.followUps ?? [],
  });
  const waiting = pendingApprovals(approvals, now).length;
  const outstanding = evidence.filter(isOutstandingEvidence).length;
  const late = evidence.filter((item) => isLateEvidence(item, now)).length;
  const open = model.tasks.filter(
    (task) => task.status !== "SUCCEEDED" && task.status !== "CANCELLED",
  ).length;
  const blocked = model.tasks.filter(
    (task) => task.status === "BLOCKED",
  ).length;
  const step = nextStep(model, queue.length, outstanding);
  return (
    <div className="page">
      <PageHeader
        context="Dashboard"
        title={project?.name ?? model.organization.name}
        badge={
          project === null ? undefined : <StatusPill status={project.status} />
        }
        description={step.lede}
        actions={
          <a className="btn" href={step.href}>
            {step.action}
            <UiIcon name="arrow" size={15} />
          </a>
        }
      />
      {project === null ? null : (
        <>
          {onboarding !== null && showsSetupCallout(onboarding) ? (
            <SetupCallout model={model} onboarding={onboarding} />
          ) : null}
          <section className="kpis" aria-label="Engagement metrics">
            <Metric
              icon="shield"
              label="Waiting on you"
              value={queue.length}
              detail={queue.length === 0 ? "Queue is clear" : "Need a person"}
              tone={queue.length > 0 ? "risk" : "positive"}
            />
            <Metric
              icon="activity"
              label="Open work"
              value={open}
              detail={blocked === 0 ? "None blocked" : `${blocked} blocked`}
              tone={blocked > 0 ? "risk" : "default"}
            />
            <Metric
              icon="inbox"
              label="Evidence outstanding"
              value={workflow.evidence === null ? null : outstanding}
              detail={late === 0 ? "Nothing overdue" : `${late} overdue`}
              tone={late > 0 ? "risk" : "default"}
            />
            <Metric
              icon="check"
              label="Approvals waiting"
              value={workflow.approvals === null ? null : waiting}
              detail={waiting === 0 ? "No decisions due" : "Decide to unblock"}
            />
          </section>
          <Lifecycle model={model} phase={auditPhase(model.tasks, evidence)} />
          <div className="layout-main">
            <DecisionQueue model={model} queue={queue} workflow={workflow} />
            <ControlLoop model={model} workflow={workflow} waiting={waiting} />
          </div>
          <div className="layout-two">
            <UpcomingCard model={model} />
            <ActivityCard model={model} />
          </div>
        </>
      )}
    </div>
  );
}

const QUEUE_META: Record<
  AttentionItem["kind"],
  { label: string; icon: IconName; action: string; tone: Tone }
> = {
  triage: {
    label: "Unmatched mail",
    icon: "mail",
    action: "Triage",
    tone: "warning",
  },
  reply: { label: "Reply", icon: "mail", action: "Review", tone: "info" },
  reminder: {
    label: "Reminder",
    icon: "clock",
    action: "Prepare",
    tone: "warning",
  },
  approval: {
    label: "Approval",
    icon: "shield",
    action: "Decide",
    tone: "info",
  },
  blocked: {
    label: "Blocked",
    icon: "risk",
    action: "Unblock",
    tone: "danger",
  },
  evidence: {
    label: "Evidence",
    icon: "inbox",
    action: "Follow up",
    tone: "warning",
  },
  review: { label: "Review", icon: "check", action: "Review", tone: "neutral" },
};

/** What needs a person now, for the dashboard. */
function AttentionCard({
  model,
  workflow,
  now,
}: {
  model: Ready;
  workflow: WorkflowState;
  now: number;
}) {
  // The API's inbox is the one list; the older client-side list stands in only
  // when it cannot be read.
  if (workflow.inbox !== null) {
    return <InboxQueue model={model} items={workflow.inbox.waiting} />;
  }
  const queue = attentionQueue({
    tasks: model.tasks,
    evidence: workflow.evidence ?? [],
    approvals: workflow.approvals ?? [],
    now,
    inbound: workflow.inbound ?? [],
    followUps: workflow.followUps ?? [],
  });
  return <DecisionQueue model={model} queue={queue} workflow={workflow} />;
}

const INBOX_META: Record<
  string,
  { label: string; icon: IconName; action: string; tone: Tone }
> = {
  approval: {
    label: "Approval",
    icon: "shield",
    action: "Decide",
    tone: "info",
  },
  results: { label: "Testing", icon: "check", action: "Open", tone: "warning" },
  samples: { label: "Samples", icon: "table", action: "Review", tone: "info" },
  review: {
    label: "Evidence review",
    icon: "file",
    action: "Sign off",
    tone: "info",
  },
  control_review: {
    label: "Independent review",
    icon: "shield",
    action: "Open",
    tone: "info",
  },
  replies: { label: "Mailbox", icon: "mail", action: "Read", tone: "info" },
  reminders: {
    label: "Reminder",
    icon: "clock",
    action: "Prepare",
    tone: "warning",
  },
  late: { label: "Evidence", icon: "clock", action: "Chase", tone: "danger" },
  blocked: { label: "Blocked", icon: "risk", action: "Open", tone: "danger" },
  task_review: {
    label: "Agent work",
    icon: "agents",
    action: "Review",
    tone: "info",
  },
  drafts: {
    label: "Evidence",
    icon: "inbox",
    action: "Review",
    tone: "neutral",
  },
  planning: {
    label: "Evidence plan",
    icon: "sparkles",
    action: "Plan",
    tone: "warning",
  },
  contacts: {
    label: "Evidence",
    icon: "mail",
    action: "Set",
    tone: "warning",
  },
};
const INBOX_DEFAULT = {
  label: "Waiting",
  icon: "info" as IconName,
  action: "Open",
  tone: "neutral" as Tone,
};

/** What waits on the team: the API's inbox, the same list the agent console shows. */
function InboxQueue({ model, items }: { model: Ready; items: WaitingItem[] }) {
  return (
    <section id="decision-queue" className="card" aria-labelledby="queue-title">
      <CardHeader
        title="Waiting on you"
        titleId="queue-title"
        description="Approvals, results to decide, replies to read, and anything an agent cannot finish alone. The agent console shows the same list."
        aside={
          <span
            className={`count ${items.length > 0 ? "tone-danger" : ""}`}
            role="status"
            aria-label={`${items.length} waiting`}
          >
            {items.length}
          </span>
        }
      />
      {items.length === 0 ? (
        <div className="queue-clear">
          <span className="queue-clear-icon" aria-hidden="true">
            <UiIcon name="check" size={14} />
          </span>
          <p>
            <strong>Nothing is waiting on you.</strong> The agents keep working;
            anything that needs a person appears here.
          </p>
        </div>
      ) : (
        <ul className="queue">
          {items.slice(0, 10).map((item) => {
            const meta = INBOX_META[item.kind] ?? INBOX_DEFAULT;
            return (
              <li key={`${item.kind}-${item.title}`}>
                <span className={`queue-icon pill ${toneClass(meta.tone)}`}>
                  <UiIcon name={meta.icon} size={15} />
                </span>
                <span className="queue-copy">
                  <strong>{item.title}</strong>
                  <small>
                    <span className="queue-kind">{meta.label}</span>
                    {item.detail !== "" ? ` · ${item.detail}` : ""}
                  </small>
                </span>
                <a
                  className="btn btn-secondary btn-sm"
                  href={waitingHref(
                    item,
                    model.organization.id,
                    model.selectedProject?.id ?? null,
                  )}
                >
                  {meta.action}
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > 10 ? (
        <p className="card-note">
          {items.length - 10} more in the{" "}
          <a href={sectionHref(model, "console")}>agent console</a>.
        </p>
      ) : null}
    </section>
  );
}

function DecisionQueue({
  model,
  queue,
  workflow,
}: {
  model: Ready;
  queue: ReturnType<typeof attentionQueue>;
  workflow: WorkflowState;
}) {
  return (
    <section id="decision-queue" className="card" aria-labelledby="queue-title">
      <CardHeader
        title="Waiting on you"
        titleId="queue-title"
        description="Approvals, blocked work, late evidence, and reviews that need a person."
        aside={
          <span
            className={`count ${queue.length > 0 ? "tone-danger" : ""}`}
            role="status"
            aria-label={`${queue.length} waiting`}
          >
            {queue.length}
          </span>
        }
      />
      {workflow.approvals === null || workflow.evidence === null ? (
        <div className="card-body">
          <Banner tone="warning">
            Some approvals or evidence could not be loaded, so this list may be
            incomplete.
          </Banner>
        </div>
      ) : null}
      {queue.length === 0 ? (
        <div className="queue-clear">
          <span className="queue-clear-icon" aria-hidden="true">
            <UiIcon name="check" size={14} />
          </span>
          <p>
            <strong>No approvals, blocked work, or late evidence.</strong>{" "}
            Drafted requests and proposed samples wait in the agent console's
            inbox.
          </p>
          <a className="text-link" href={sectionHref(model, "console")}>
            Open the agent console
          </a>
        </div>
      ) : (
        <ul className="queue">
          {queue.slice(0, 8).map((item) => {
            const meta = QUEUE_META[item.kind];
            const href =
              item.kind === "approval"
                ? sectionHref(model, "approvals")
                : item.kind === "reply" || item.kind === "triage"
                  ? `${sectionHref(model, "evidence")}&tab=mailbox#replies`
                  : item.kind === "evidence" || item.kind === "reminder"
                    ? sectionHref(model, "evidence")
                    : directoryHref({
                        section: "tasks",
                        organizationId: model.organization.id,
                        projectId: model.selectedProject?.id ?? null,
                        taskId: item.id,
                      });
            return (
              <li key={`${item.kind}-${item.id}`}>
                <span className={`queue-icon pill ${toneClass(meta.tone)}`}>
                  <UiIcon name={meta.icon} size={15} />
                </span>
                <span className="queue-copy">
                  <strong>{item.title}</strong>
                  <small>
                    <span className="queue-kind">{meta.label}</span> ·{" "}
                    {item.detail}
                  </small>
                </span>
                <a className="btn btn-secondary btn-sm" href={href}>
                  {meta.action}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ControlLoop({
  model,
  workflow,
  waiting,
}: {
  model: Ready;
  workflow: WorkflowState;
  waiting: number;
}) {
  const steps: ReadonlyArray<[string, string]> = [
    ["Agent proposes", "An agent drafts work or asks to take an action."],
    ["Firm rules apply", "Actions your firm has not allowed are refused."],
    ["Person approves", "Sensitive actions wait for an approver."],
    ["Runs as approved", "Only what was approved runs, and only once."],
    ["Recorded", "Every step lands in the audit trail."],
  ];
  return (
    <section className="card" aria-labelledby="loop-title">
      <CardHeader
        title="Agent controls"
        titleId="loop-title"
        description={
          workflow.activeAgents === null
            ? "AI workforce"
            : `${workflow.activeAgents} active agent${workflow.activeAgents === 1 ? "" : "s"}`
        }
        aside={<UiIcon name="shield" size={16} />}
      />
      <div className="card-body">
        <ol className="steps">
          {steps.map(([title, detail], index) => (
            <li
              key={title}
              className={index === 2 && waiting > 0 ? "step-hot" : undefined}
            >
              <span className="step-index">{index + 1}</span>
              <div>
                <strong>{title}</strong>
                <small>
                  {index === 2 && waiting > 0
                    ? `${waiting} waiting for a decision now.`
                    : detail}
                </small>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="card-footer">
        <a className="text-link" href={sectionHref(model, "agents")}>
          Manage the workforce
        </a>
      </div>
    </section>
  );
}

function Lifecycle({ model, phase }: { model: Ready; phase: number }) {
  const phases: ReadonlyArray<{
    title: string;
    detail: string;
    section: SectionId | null;
  }> = [
    { title: "Scope", detail: "Define the engagement", section: "projects" },
    { title: "Evidence", detail: "Request and collect", section: "evidence" },
    { title: "Test", detail: "Run control work", section: "tasks" },
    { title: "Review", detail: "Approve and resolve", section: "approvals" },
    { title: "Report", detail: "Close and sign off", section: null },
  ];
  return (
    <section className="card" aria-labelledby="lifecycle-title">
      <CardHeader
        title="Audit lifecycle"
        titleId="lifecycle-title"
        aside={
          <span className="num">
            Phase {phase + 1} of {phases.length}
          </span>
        }
      />
      <ol className="lifecycle">
        {phases.map((item, index) => {
          const body = (
            <>
              <span className="phase-bar" aria-hidden="true" />
              <span className="phase-copy">
                <span>
                  {index < phase
                    ? "Complete"
                    : index === phase
                      ? "In progress"
                      : `Step ${index + 1}`}
                </span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
            </>
          );
          return (
            <li
              key={item.title}
              className={
                index < phase
                  ? "phase-complete"
                  : index === phase
                    ? "phase-current"
                    : undefined
              }
              aria-current={index === phase ? "step" : undefined}
            >
              {item.section === null ? (
                <span className="phase-link">{body}</span>
              ) : (
                <a
                  className="phase-link"
                  href={sectionHref(model, item.section)}
                >
                  {body}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function UpcomingCard({ model }: { model: Ready }) {
  const deadlines = upcomingDeadlines(model.tasks);
  return (
    <section className="card" aria-labelledby="upcoming-title">
      <CardHeader
        title="Coming up"
        titleId="upcoming-title"
        description="Open work in deadline order"
        aside={<UiIcon name="clock" size={16} />}
      />
      {deadlines.length === 0 ? (
        <EmptyState
          icon="clock"
          title="No open deadlines"
          detail="Work with a deadline appears here in date order."
        />
      ) : (
        <ul className="rows">
          {deadlines.map((task) => (
            <li key={task.id}>
              <a
                href={directoryHref({
                  section: "tasks",
                  organizationId: model.organization.id,
                  projectId: model.selectedProject?.id ?? null,
                  taskId: task.id,
                })}
              >
                {task.title}
              </a>
              <time dateTime={task.deadline ?? undefined}>
                {task.deadline === null ? "" : formatDate(task.deadline)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityCard({ model }: { model: Ready }) {
  const activity = model.projectDetail?.activity ?? [];
  return (
    <section className="card" aria-labelledby="activity-title">
      <CardHeader
        title="Recent activity"
        titleId="activity-title"
        description="From the audit trail"
        aside={<UiIcon name="activity" size={16} />}
      />
      {activity.length === 0 ? (
        <EmptyState
          icon="activity"
          title="No activity yet"
          detail="Every change to this engagement is recorded here."
        />
      ) : (
        <ActivityRows activity={activity.slice(0, 6)} />
      )}
    </section>
  );
}

function ActivityRows({
  activity,
}: {
  activity: ReadonlyArray<{
    action: string;
    occurredAt: string;
    actorName: string;
  }>;
}) {
  return (
    <ul className="rows">
      {activity.map((item) => (
        <li key={`${item.occurredAt}-${item.action}`}>
          <span className="row-text">
            <span>{plainAction(item.action)}</span>
            <small>{item.actorName}</small>
          </span>
          <time dateTime={item.occurredAt}>{formatDate(item.occurredAt)}</time>
        </li>
      ))}
    </ul>
  );
}

export function Metric({
  icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: IconName;
  label: string;
  value: number | null;
  detail: string;
  tone?: "default" | "positive" | "risk";
}) {
  return (
    <article className={`kpi kpi-${value === null ? "default" : tone}`}>
      <p className="kpi-label">
        <UiIcon name={icon} size={15} />
        {label}
      </p>
      <strong className="kpi-value">{value === null ? "–" : value}</strong>
      <span className="kpi-detail">
        {value === null ? "Unavailable" : detail}
      </span>
    </article>
  );
}

/** How an agent's model setting reads to the team. */
function modelTierLabel(tier: string): string {
  if (tier === "reasoning") {
    return "advanced model";
  }
  if (tier === "standard") {
    return "standard model";
  }
  return tier;
}

function labelStatus(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: "Draft",
    ACTIVE: "Active",
    PAUSED: "Paused",
    COMPLETED: "Completed",
    ARCHIVED: "Archived",
    READY: "Ready",
    QUEUED: "Queued",
    RUNNING: "Running",
    WAITING: "Waiting",
    BLOCKED: "Blocked",
    REVIEW: "In review",
    SUCCEEDED: "Complete",
    PENDING: "Not started",
    FAILED: "Failed",
    CANCELLED: "Cancelled",
    LOW: "Low",
    NORMAL: "Normal",
    MODERATE: "Moderate",
    HIGH: "High",
    URGENT: "Urgent",
    DISABLED: "Disabled",
  };
  return labels[status] ?? status;
}

function plainAction(action: string): string {
  const words = action
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^pbc\b/, "PBC request");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const NOTICES: Record<ProjectNotice, string> = {
  saved: "Engagement saved.",
  invalid: "Check the engagement fields and try again.",
  conflict: "This engagement changed. Refresh it and try again.",
  slug: "This client already has an engagement with that name.",
  status: "That status change is not available.",
  "completed-done":
    "Engagement completed. It is read-only now; an owner or admin can reopen it.",
  reopened: "Engagement reopened. The reason is kept with it.",
  deleted: "Draft deleted. Only its audit record is kept.",
  completed:
    "This engagement is completed, so it is read-only. An owner or admin can reopen it first.",
  "open-work":
    "Work is still open, so the engagement was not completed. The list shows what is left.",
  launched:
    "This engagement has launched, so it cannot be deleted. Archive it instead.",
  "setup-running":
    "The planner or the system agent is still working on this draft. Try again in a moment.",
  "work-on-record":
    "This draft has work on record, so it cannot be deleted. Archive it instead.",
  reason: "Say why the engagement is reopened, in at least three characters.",
  "delete-name": "Type the engagement's name exactly to delete it.",
  locked:
    "The client and the period end are part of the launched plan, so they no longer change.",
  rollforward:
    "An engagement can start only from an earlier engagement of the same client.",
  "client-renamed":
    "Client renamed. Every engagement for it shows the new name.",
  "client-exists": "Another client already has that name.",
  "client-changed": "This client changed. Refresh and try again.",
  launch:
    "A draft becomes active only by launching it. Finish setup and launch it from there.",
  archived: "This engagement is archived. It is closed and cannot change.",
  denied: "You cannot change this engagement.",
  unavailable: "The engagement could not be saved.",
};

/** An engagement section opened before launch: setup is the work until then. */
function NotLaunched({ model }: { model: Ready }) {
  const label =
    NAV.find((item) => item.id === model.section)?.label ?? "This section";
  return (
    <div className="page">
      <section className="card">
        <EmptyState
          icon="sparkles"
          title="This engagement has not launched yet"
          detail={`${label} opens once the engagement is launched. Finish the setup and launch. The controls register, project plan, timeline, evidence, deficiencies, and approvals then open together.`}
          action={
            <a className="btn" href={sectionHref(model, "setup")}>
              Continue setup <UiIcon name="arrow" size={15} />
            </a>
          }
        />
      </section>
    </div>
  );
}

/** Test plans: the planning review queue, and one control's master test plan for review. */
function PlanningMain({
  model,
  planning,
}: {
  model: Ready;
  planning: PlanningPageState | null;
}) {
  const project = model.selectedProject;
  if (project === null) {
    return <NoEngagement model={model} what="Test plans" />;
  }
  return (
    <PlanningPage
      ids={{ organizationId: model.organization.id, projectId: project.id }}
      projectName={project.name}
      state={planning}
    />
  );
}

function NoEngagement({ model, what }: { model: Ready; what: string }) {
  return (
    <div className="page">
      <section className="card">
        <EmptyState
          icon="briefcase"
          title="Choose an engagement first"
          detail={`${what} belong to one engagement. Create or select one to continue.`}
          action={
            <a className="btn" href={sectionHref(model, "projects")}>
              Open engagements <UiIcon name="arrow" size={15} />
            </a>
          }
        />
      </section>
    </div>
  );
}

const EVIDENCE_NOTICES: Record<EvidenceNotice, string> = {
  saved: "Evidence request saved as a draft. Nothing was sent.",
  invalid: "Check the request fields and try again.",
  inactive: "Evidence can be requested only while the engagement is active.",
  duplicate: "That request was already submitted.",
  denied: "Your role cannot request evidence.",
  unavailable: "The request could not be saved. Try again.",
  submitted:
    "Approval requested. An approver now confirms the exact message before anything is sent.",
  sent: "Request sent. Delivery is not confirmed yet.",
  failed:
    "The request was not sent because email sending is turned off for this workspace.",
  uncertain:
    "We could not confirm whether the request was sent. Retrying is safe; it will not be sent twice.",
  recipient: "Evidence requests cannot be sent to that address.",
  changed:
    "The request changed after it was approved. Request approval for the new version.",
  awaiting: "That request is not ready to send yet.",
  "reply-assigned":
    "Reply linked to the request. Review it, then update the request's status.",
  "reply-dismissed": "Email dismissed. It is kept on file with your reason.",
  "reply-reviewed":
    "Reply marked as reviewed. The request status did not change.",
  "reply-changed":
    "That reply was already handled or changed. Refresh to see its current state.",
  "reminder-submitted":
    "Reminder approval requested. A second person confirms the exact message before it goes out.",
  "reminder-sent":
    "The reminder went out in the original thread. Delivery is not confirmed yet.",
  "reminder-skipped":
    "Reminder skipped. The next one falls due after the usual interval.",
  redrafting:
    "The evidence coordinator is drafting the request again. Refresh in a moment to see it.",
  "redraft-failed":
    "Only a draft that has not been submitted for approval can be redrafted.",
  "reminder-failed":
    "The reminder was not sent. It will be offered again later.",
  "reminder-closed":
    "That reminder is no longer open. The request may have been resolved.",
  "reminder-open":
    "A reminder for this request already waits for approval, or the most reminders are sent.",
  "reminder-held":
    "Reminder approved. Email sending is off, so it goes out once email sending is on.",
  stored:
    "File saved. It cannot be altered, and every download is checked against the original.",
  mismatch:
    "That file does not match the attachment. Check that you chose the right file.",
  classified: ANALYSIS_NOTICES.classified,
  reading: ANALYSIS_NOTICES.reading,
  "analysis-changed": ANALYSIS_NOTICES["analysis-changed"],
  "signed-off": ANALYSIS_NOTICES["signed-off"],
  "review-changed": ANALYSIS_NOTICES["review-changed"],
  "links-revoked":
    "The owner's upload links are turned off, and any open session ended. A new request email gives them a new link.",
  "preview-unavailable":
    "Opening the owner's page from here works only in a local setup, where no email is sent.",
};

function EvidenceMain({
  model,
  workflow,
  now,
  view,
  center,
}: {
  model: Ready;
  workflow: WorkflowState;
  now: number;
  view: EvidenceView;
  center: EvidenceCenterState | null;
}) {
  const project = model.selectedProject;
  if (project === null) {
    return <NoEngagement model={model} what="Evidence requests" />;
  }
  const live = workflow.mailboxMode === "live";
  const files = workflow.evidenceRegister?.files ?? [];
  const counts = fileCounts(files);
  const inbound = workflow.inbound ?? [];
  const toReview =
    repliesToReview(inbound).length + unmatchedReplies(inbound).length;
  const ids = { organizationId: model.organization.id, projectId: project.id };
  const tabHref = (tab: string | null) => {
    const params = new URLSearchParams({
      organization: model.organization.id,
      project: project.id,
      section: "evidence",
    });
    if (tab !== null) {
      params.set("tab", tab);
    }
    return `/?${params.toString()}`;
  };
  const list = center?.list ?? null;
  const query = center?.query ?? DEFAULT_QUERY;
  const canCreate =
    canRequestEvidence(model.organization.role) &&
    requestsClosedReason(project.status) === null;
  const generate = list?.canAct && list.unplanned + list.unrequested > 0;
  const portalHref = tabHref("mailbox");
  const total = list?.kpis.total ?? workflow.evidence?.length ?? 0;
  return (
    <div className="page evidence-page">
      <PageHeader
        context={project.name}
        title="Evidence Management"
        description="Manage evidence requests, client submissions, and AI-powered validation across the engagement."
        actions={
          <span className="ec-head-actions">
            {canCreate ? (
              <a
                className="btn btn-sm"
                href={centerHref(ids, query, { creating: true, request: null })}
              >
                <UiIcon name="plus" size={13} />
                New request
              </a>
            ) : null}
            {generate && list !== null ? (
              <PlanMissingButton
                organizationId={model.organization.id}
                projectId={project.id}
                unplanned={list.unplanned}
                unrequested={list.unrequested}
                title="Generate requests with AI"
              />
            ) : null}
            <details className="ec-more">
              <summary className="btn btn-sm btn-ghost">More actions</summary>
              <div className="ec-more-pop">
                <a href={exportHref(ids, query)}>Export requests</a>
                <a href={portalHref}>Client communication settings</a>
                <a href={tabHref("files")}>Evidence library</a>
              </div>
            </details>
            <span
              className={`pill ${live ? "tone-warning" : "tone-neutral"}`}
              title={
                live
                  ? "Approved requests are emailed when sent."
                  : "Requests are saved and approved; no email leaves."
              }
            >
              <UiIcon name="mail" size={13} />
              {live ? "Live email on" : "Email sending off"}
            </span>
          </span>
        }
      />
      {analysisInProgress(workflow.evidenceAnalyses) || counts.reading > 0 ? (
        <AutoRefresh />
      ) : null}
      {workflow.evidenceNotice !== null ? (
        <Banner>
          {workflow.evidenceNotice === "sent" && workflow.mailboxMode !== "live"
            ? "Request saved with its reference. Email sending is off, so nothing was sent."
            : EVIDENCE_NOTICES[workflow.evidenceNotice]}
        </Banner>
      ) : null}
      <nav className="page-tabs" aria-label="Evidence views">
        <a
          href={tabHref(null)}
          aria-current={view.tab === "requests" ? "page" : undefined}
        >
          Requests <span className="view-count">{total}</span>
        </a>
        <a
          href={tabHref("files")}
          aria-current={view.tab === "files" ? "page" : undefined}
        >
          Evidence Library <span className="view-count">{counts.total}</span>
        </a>
        <a
          href={tabHref("mailbox")}
          aria-current={view.tab === "mailbox" ? "page" : undefined}
          className={toReview > 0 ? "is-alert" : undefined}
        >
          Client Portal <span className="view-count">{toReview}</span>
        </a>
      </nav>
      {view.tab === "requests" &&
      uploadBlocked(project.status, model.organization.role) !== null ? (
        <p className="upload-blocked" role="status">
          <UiIcon name="info" size={15} />
          <span>{uploadBlocked(project.status, model.organization.role)}</span>
        </p>
      ) : null}
      {view.tab === "requests" ? (
        center !== null ? (
          <EvidenceCenter
            ids={ids}
            state={center}
            delivery={
              center.query.request === null ? null : (
                <RequestDelivery
                  model={model}
                  workflow={workflow}
                  requestId={center.query.request}
                  requestStatus={center.details?.request.status ?? ""}
                  now={now}
                />
              )
            }
            setupHref={portalHref}
            coordinatorMissing={
              workflow.evidenceContacts !== null &&
              workflow.evidenceContacts.coordinatorEmail === ""
            }
          />
        ) : (
          <Banner tone="warning">
            Evidence requests could not be loaded. Refresh to try again.
          </Banner>
        )
      ) : null}
      {view.tab === "files" ? (
        <EvidenceFiles model={model} workflow={workflow} view={view} />
      ) : null}
      {view.tab === "mailbox" ? (
        <>
          <ContactsCard model={model} contacts={workflow.evidenceContacts} />
          <UploadLinksCard
            model={model}
            links={workflow.portalLinks}
            testMailbox={workflow.mailboxMode === "test"}
          />
          <RepliesCard model={model} workflow={workflow} />
        </>
      ) : null}
    </div>
  );
}

const DELIVERY_TONES: Record<DeliveryTone, Tone> = {
  positive: "success",
  neutral: "info",
  risk: "danger",
};

const REMINDER_LABELS: Record<
  ReminderStep["kind"],
  (sequence: number) => string
> = {
  prepare: (sequence) => `Reminder ${sequence} due`,
  awaiting: (sequence) => `Reminder ${sequence} awaiting approval`,
  send: (sequence) => `Reminder ${sequence} approved`,
  retry: (sequence) => `Reminder ${sequence}: outcome unknown`,
  settling: (sequence) => `Reminder ${sequence} closing`,
};

/** A sent request's delivery and its reminders, beside it on the Evidence page: the
 * delivery outcome, a check and retry when the outcome is unknown, and the reminder that
 * is due (prepared for approval, sent once approved, or skipped). */
function RequestDelivery({
  model,
  workflow,
  requestId,
  requestStatus = "",
  now,
}: {
  model: Ready;
  workflow: WorkflowState;
  requestId: string;
  /** The request's own status, to offer a reminder now while it is with the recipient. */
  requestStatus?: string;
  now: number;
}) {
  const outbound = workflow.outbound ?? [];
  const approvals = workflow.approvals ?? [];
  const followUps = workflow.followUps ?? [];
  const record = latestOutbound(outbound, requestId);
  const delivery =
    record === null
      ? null
      : supersededSend(record, approvals)
        ? {
            label: "An earlier send was refused · submitted again",
            tone: "neutral" as const,
          }
        : deliveryLabel(record, workflow.mailboxMode);
  const reminder = reminderStep({
    followUps,
    approvals,
    outbound,
    requestId,
    now,
  });
  const sent = remindersSent(followUps, requestId);
  const canAct =
    canRequestEvidence(model.organization.role) &&
    model.selectedProject?.status === "ACTIVE" &&
    workflow.outbound !== null &&
    workflow.approvals !== null;
  const followUpNow =
    canAct && canFollowUpNow(requestStatus, reminder !== null);
  if (record === null && reminder === null && sent === 0 && !followUpNow) {
    return null;
  }
  return (
    <section className="ec-delivery" aria-label="Delivery and reminders">
      {record !== null && delivery !== null ? (
        <span
          className={`pill pill-dot ${toneClass(DELIVERY_TONES[delivery.tone])}`}
          title={`${record.reference} · delivery ${record.deliveryConfirmed ? "confirmed" : "not confirmed"}`}
        >
          {delivery.label}
        </span>
      ) : null}
      {sent > 0 ? (
        <span className="pill">
          {sent} reminder{sent === 1 ? "" : "s"} sent
        </span>
      ) : null}
      {canAct && record !== null && canRetryDelivery(record) ? (
        <OutboundAction
          model={model}
          requestId={requestId}
          intent="send"
          approvalId={record.approvalId}
          label="Check and retry"
          detail="Checks the mailbox before any resend"
        />
      ) : reminder === null ? (
        followUpNow ? (
          <ReminderAction
            model={model}
            requestId={requestId}
            followUpId=""
            intent="now"
            label="Follow up now"
            detail="Sends a reminder now, in the request's email thread"
          />
        ) : null
      ) : canAct ? (
        <ReminderNextStep model={model} requestId={requestId} step={reminder} />
      ) : (
        <span className="pill">
          {REMINDER_LABELS[reminder.kind](reminder.followUp.sequence)}
        </span>
      )}
    </section>
  );
}

function ReminderNextStep({
  model,
  requestId,
  step,
}: {
  model: Ready;
  requestId: string;
  step: ReminderStep;
}) {
  const sequence = step.followUp.sequence;
  if (step.kind === "send" || step.kind === "retry") {
    return (
      <ReminderAction
        model={model}
        requestId={requestId}
        followUpId={step.followUp.id}
        intent="send"
        approvalId={step.approvalId}
        label={
          step.kind === "send" ? `Send reminder ${sequence}` : "Check and retry"
        }
        detail={
          step.kind === "send"
            ? "Approved · replies in the original thread"
            : "Checks the mailbox before any resend"
        }
      />
    );
  }
  if (step.kind === "settling") {
    return (
      <span className="cell-note">
        <UiIcon name="clock" size={13} /> Closes at the next schedule check
      </span>
    );
  }
  return (
    <span className="reminder-actions">
      {step.kind === "prepare" ? (
        <ReminderAction
          model={model}
          requestId={requestId}
          followUpId={step.followUp.id}
          intent="remind"
          label={`Send reminder ${sequence}`}
          detail="Sends now, in the request's email thread"
        />
      ) : (
        <span className="cell-note">
          <UiIcon name="clock" size={13} /> Awaiting an approver
        </span>
      )}
      <ReminderAction
        model={model}
        requestId={requestId}
        followUpId={step.followUp.id}
        intent="skip"
        version={step.followUp.version}
        label="Skip this reminder"
        quiet
      />
    </span>
  );
}

function ReminderAction({
  model,
  requestId,
  followUpId,
  intent,
  approvalId,
  version,
  label,
  detail,
  quiet = false,
}: {
  model: Ready;
  requestId: string;
  followUpId: string;
  intent: "submit" | "send" | "skip" | "now" | "remind";
  approvalId?: string;
  version?: number;
  label: string;
  detail?: string;
  quiet?: boolean;
}) {
  return (
    <form
      method="post"
      action="/workspace/follow-ups"
      className="row-action"
      autoComplete="off"
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
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="follow_up_id" value={followUpId} />
      <input type="hidden" name="intent" value={intent} />
      {intent === "send" ? (
        <input type="hidden" name="approval_id" value={approvalId ?? ""} />
      ) : null}
      {intent === "skip" ? (
        <input type="hidden" name="version" value={version ?? 0} />
      ) : null}
      <button
        type="submit"
        className={`btn-sm ${quiet ? "btn-quiet" : intent === "send" ? "" : "btn-secondary"}`}
      >
        {quiet ? null : (
          <UiIcon name={intent === "send" ? "arrow" : "mail"} size={14} />
        )}
        {label}
      </button>
      {detail === undefined ? null : <small>{detail}</small>}
    </form>
  );
}

const OPEN_FOR_REPLIES = new Set([
  "SENT",
  "WAITING_FOR_RESPONSE",
  "PARTIALLY_RECEIVED",
  "OVERDUE",
  "ESCALATED",
  "RECEIVED",
]);

function replyOrder(item: InboundReply): number {
  if (item.matchStatus === "UNMATCHED") {
    return 0;
  }
  return item.reviewState === "NEEDS_REVIEW" ? 1 : 2;
}

function RepliesCard({
  model,
  workflow,
}: {
  model: Ready;
  workflow: WorkflowState;
}) {
  const inbound = workflow.inbound;
  const items = [...(inbound ?? [])].sort(
    (left, right) => replyOrder(left) - replyOrder(right),
  );
  const toReview = repliesToReview(items).length;
  const unmatched = unmatchedReplies(items).length;
  const canAct = canRequestEvidence(model.organization.role);
  const evidence = workflow.evidence ?? [];
  const open = evidence.filter((item) => OPEN_FOR_REPLIES.has(item.status));
  return (
    <section id="replies" className="card" aria-labelledby="replies-title">
      <CardHeader
        title="Replies"
        titleId="replies-title"
        description="Email received in the shared mailbox. A reply never changes a request's status on its own."
        aside={
          inbound === null ? undefined : (
            <>
              {unmatched > 0 ? (
                <span className="pill pill-dot tone-warning">
                  {unmatched} unmatched
                </span>
              ) : null}
              {toReview > 0 ? (
                <span className="pill pill-dot tone-info">
                  {toReview} to review
                </span>
              ) : null}
            </>
          )
        }
      />
      {inbound === null ? (
        <div className="card-body">
          <Banner tone="warning">
            Replies could not be loaded. Refresh to try again.
          </Banner>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="mail"
          title="No replies yet"
          detail="Replies from control owners appear here, matched to their request when the sender and reference agree."
        />
      ) : (
        <ul className="replies">
          {items.slice(0, 30).map((item) => (
            <ReplyItem
              key={item.id}
              model={model}
              item={item}
              request={
                evidence.find((request) => request.id === item.requestId) ??
                null
              }
              open={open}
              canAct={canAct}
              files={workflow.evidenceFiles ?? []}
              analyses={workflow.evidenceAnalyses ?? []}
              reviews={workflow.evidenceReviews ?? []}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReplyItem({
  model,
  item,
  request,
  open,
  canAct,
  files,
  analyses,
  reviews,
}: {
  model: Ready;
  item: InboundReply;
  request: EvidenceRequest | null;
  open: readonly EvidenceRequest[];
  canAct: boolean;
  files: readonly EvidenceFile[];
  analyses: readonly EvidenceAnalysis[];
  reviews: readonly EvidenceReview[];
}) {
  const state =
    item.matchStatus === "UNMATCHED"
      ? { label: "Unmatched", tone: "warning" as Tone }
      : item.matchStatus === "DISMISSED"
        ? { label: "Dismissed", tone: "neutral" as Tone }
        : item.reviewState === "NEEDS_REVIEW"
          ? { label: "To review", tone: "info" as Tone }
          : { label: "Reviewed", tone: "success" as Tone };
  const hidden = (
    <>
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
      <input type="hidden" name="inbound_id" value={item.id} />
      <input type="hidden" name="version" value={item.version} />
    </>
  );
  const suggested =
    item.suggestedRequestId !== null &&
    open.some((candidate) => candidate.id === item.suggestedRequestId)
      ? item.suggestedRequestId
      : "";
  return (
    <li className="reply">
      <div className="reply-head">
        <span className={`queue-icon pill ${toneClass(state.tone)}`}>
          <UiIcon name="mail" size={15} />
        </span>
        <div>
          <strong>{item.subject === "" ? "(no subject)" : item.subject}</strong>
          <small>
            From {item.sender} · {formatDate(item.receivedAt)}
            {request !== null
              ? ` · ${request.controlRef}`
              : item.reference !== null
                ? ` · ${item.reference}`
                : ""}
          </small>
        </div>
        <span className={`pill pill-dot ${toneClass(state.tone)}`}>
          {state.label}
        </span>
      </div>
      {item.matchStatus === "UNMATCHED" ? (
        <p className="reply-reason">
          Not matched: {unmatchedLabel(item.unmatchedReason)}.
        </p>
      ) : item.triageReason !== "" ? (
        <p className="reply-reason">
          {item.matchStatus === "DISMISSED" ? "Dismissed" : "Assigned"}:{" "}
          {item.triageReason}
        </p>
      ) : null}
      <details className="reply-body">
        <summary>Show message</summary>
        <p className="untrusted-note">
          <UiIcon name="info" size={13} /> Untrusted content, shown as plain
          text. Links are not clickable and attachments are not opened.
          {item.contentRedacted
            ? " Passwords and keys found in it were hidden."
            : ""}
          {item.bodyTruncated ? " The message was shortened." : ""}
        </p>
        <pre className="untrusted-text">
          {item.bodyText === "" ? "(empty message)" : item.bodyText}
        </pre>
      </details>
      {item.attachments.length > 0 ? (
        <p className="form-hint">
          Attachments on a reply are not taken as evidence. The owner uploads
          evidence through the secure link in the request.
        </p>
      ) : null}
      {item.attachments.length > 0 ? (
        <ul className="file-list">
          {item.attachments.map((file) => {
            const stored = evidenceFileFor(files, file.id);
            return (
              <li key={file.id}>
                <span className="file-name">
                  {file.fileName}
                  <span className="muted">{formatBytes(file.sizeBytes)}</span>
                </span>
                {stored === null ? (
                  <span
                    className="pill tone-neutral"
                    title="Evidence comes in through the owner's secure upload link."
                  >
                    Not taken as evidence
                  </span>
                ) : (
                  <span className="file-custody">
                    <span
                      className="pill pill-dot tone-success"
                      title={stored.contentSha256}
                    >
                      In custody
                    </span>
                    <a
                      className="btn btn-secondary btn-sm"
                      href={`/workspace/evidence-files/${stored.id}?organization=${model.organization.id}&project=${model.selectedProject?.id ?? ""}`}
                    >
                      Download
                    </a>
                  </span>
                )}
                {stored === null ? null : (
                  <AnalysisPanel
                    analysis={analysisFor(analyses, stored.id)}
                    review={reviewFor(reviews, stored.id)}
                    organizationId={model.organization.id}
                    projectId={model.selectedProject?.id ?? ""}
                    canAct={canAct}
                  />
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {!canAct ? null : item.reviewState === "NEEDS_REVIEW" ? (
        <form
          autoComplete="off"
          method="post"
          action="/workspace/inbound"
          className="reply-actions"
        >
          {hidden}
          <input type="hidden" name="intent" value="review" />
          <button type="submit" className="btn-sm">
            <UiIcon name="check" size={14} /> Mark reviewed
          </button>
          <small>The request status stays as it is.</small>
        </form>
      ) : item.matchStatus === "UNMATCHED" ? (
        <div className="reply-triage">
          {open.length === 0 ? (
            <p className="form-hint">
              No open request can take this reply. Dismiss it, or send the
              request first.
            </p>
          ) : (
            <form
              autoComplete="off"
              method="post"
              action="/workspace/inbound"
              className="toolbar"
            >
              {hidden}
              <input type="hidden" name="intent" value="assign" />
              <label htmlFor={`assign-${item.id}`}>
                Request
                <select
                  id={`assign-${item.id}`}
                  name="pbc_request_id"
                  defaultValue={suggested}
                  required
                >
                  <option value="" disabled>
                    Choose a request
                  </option>
                  {open.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.controlRef} · {candidate.recipient}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor={`assign-reason-${item.id}`}>
                Reason
                <input
                  id={`assign-reason-${item.id}`}
                  name="reason"
                  required
                  maxLength={500}
                  placeholder="Why this reply belongs to the request"
                />
              </label>
              <button type="submit" className="btn-sm">
                Assign
              </button>
            </form>
          )}
          <form
            autoComplete="off"
            method="post"
            action="/workspace/inbound"
            className="toolbar"
          >
            {hidden}
            <input type="hidden" name="intent" value="dismiss" />
            <label htmlFor={`dismiss-reason-${item.id}`}>
              Reason
              <input
                id={`dismiss-reason-${item.id}`}
                name="reason"
                required
                maxLength={500}
                placeholder="Why this mail is not evidence"
              />
            </label>
            <button type="submit" className="btn-danger btn-sm">
              Dismiss
            </button>
          </form>
        </div>
      ) : null}
    </li>
  );
}

function OutboundAction({
  model,
  requestId,
  version,
  intent,
  approvalId,
  label,
  detail,
}: {
  model: Ready;
  requestId: string;
  version?: number;
  intent: "submit" | "send";
  approvalId?: string;
  label: string;
  detail?: string;
}) {
  return (
    <form
      autoComplete="off"
      method="post"
      action="/workspace/outbound"
      className="row-action"
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
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="intent" value={intent} />
      {intent === "submit" ? (
        <input type="hidden" name="version" value={version ?? 0} />
      ) : (
        <input type="hidden" name="approval_id" value={approvalId ?? ""} />
      )}
      <button
        type="submit"
        className={`btn-sm ${intent === "send" ? "" : "btn-secondary"}`}
      >
        <UiIcon name={intent === "send" ? "arrow" : "shield"} size={14} />
        {label}
      </button>
      {detail === undefined ? null : <small>{detail}</small>}
    </form>
  );
}

const DECISION_NOTICES: Record<DecisionNotice, string> = {
  decided: "Decision recorded.",
  invalid: "Add a reason for the decision and try again.",
  self: "You asked for this action, so another approver must decide.",
  expired: "This approval expired. The requester must ask again.",
  closed: "This approval was already decided.",
  denied: "Your role cannot decide approvals for this engagement.",
  unavailable: "The decision could not be saved. Try again.",
};

const EXECUTION_LABELS: Record<string, string> = {
  NOT_STARTED: "Not run yet",
  SUCCEEDED: "Ran once",
  REFUSED: "Refused at run time",
};

const DECISION_TONES: Record<"approved" | "rejected" | "expired", Tone> = {
  approved: "success",
  rejected: "danger",
  expired: "neutral",
};

const RISK_TONES: Record<string, Tone> = {
  LOW: "success",
  MODERATE: "warning",
  HIGH: "danger",
};

function ApprovalsMain({
  model,
  workflow,
  now,
}: {
  model: Ready;
  workflow: WorkflowState;
  now: number;
}) {
  const project = model.selectedProject;
  if (project === null) {
    return <NoEngagement model={model} what="Approvals" />;
  }
  const approvals = workflow.approvals;
  const pending = approvals === null ? [] : pendingApprovals(approvals, now);
  const history =
    approvals === null
      ? []
      : approvals
          .filter((item) => approvalState(item, now) !== "pending")
          .reverse();
  return (
    <div className="page">
      <PageHeader
        context={project.name}
        title="Approvals"
        description="Sensitive actions wait here for a person to approve. Each approval covers exactly the request shown, needs a reason, and expires after 24 hours."
      />
      {workflow.decisionNotice !== null ? (
        <Banner>{DECISION_NOTICES[workflow.decisionNotice]}</Banner>
      ) : null}
      {approvals === null ? (
        <Banner tone="warning">
          Approvals could not be loaded. Refresh to try again.
        </Banner>
      ) : null}
      <section className="card" aria-labelledby="pending-title">
        <CardHeader
          title="Waiting for approval"
          titleId="pending-title"
          description="Check the details before you decide."
          aside={
            <span
              className={`count ${pending.length > 0 ? "tone-danger" : ""}`}
            >
              {pending.length}
            </span>
          }
        />
        {pending.length === 0 ? (
          <EmptyState
            icon="shield"
            title="No decisions waiting"
            detail="When an agent or a teammate asks to take a sensitive action, it appears here."
          />
        ) : (
          <ul className="approvals">
            {pending.map((item) => (
              <ApprovalCard
                key={item.id}
                model={model}
                item={item}
                userId={workflow.userId}
                now={now}
              />
            ))}
          </ul>
        )}
      </section>
      <section className="card" aria-labelledby="history-title">
        <CardHeader
          title="Decision log"
          titleId="history-title"
          description="Approved, rejected, and expired requests"
          aside={<span className="num">{history.length} decided</span>}
        />
        {history.length === 0 ? (
          <EmptyState
            icon="activity"
            title="No decisions yet"
            detail="Approved, rejected, and expired requests are kept here."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Decision</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Reason</th>
                  <th scope="col" className="cell-end">
                    Outcome
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => {
                  const state = approvalState(item, now);
                  const requestId = approvalRequestId(item);
                  const sendable =
                    requestId !== null &&
                    workflow.outbound !== null &&
                    canRequestEvidence(model.organization.role) &&
                    project.status === "ACTIVE" &&
                    readyToSend([item], workflow.outbound, requestId, now) !==
                      null;
                  const decided =
                    state === "approved"
                      ? "approved"
                      : state === "rejected"
                        ? "rejected"
                        : "expired";
                  return (
                    <tr key={item.id}>
                      <td>
                        <span
                          className={`pill pill-dot ${toneClass(DECISION_TONES[decided])}`}
                        >
                          {decided === "approved"
                            ? "Approved"
                            : decided === "rejected"
                              ? "Rejected"
                              : "Expired"}
                        </span>
                      </td>
                      <td className="cell-primary">
                        <strong>{actionLabel(item.actionId)}</strong>
                      </td>
                      <td>
                        <span className="mono cell-sub">
                          {item.targetResource}
                        </span>
                      </td>
                      <td className="cell-wrap">
                        {item.decisionReason ?? (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="cell-end">
                        {sendable && requestId !== null ? (
                          <OutboundAction
                            model={model}
                            requestId={requestId}
                            intent="send"
                            approvalId={item.id}
                            label="Send request"
                          />
                        ) : (
                          <span className="cell-sub">
                            {state === "approved"
                              ? (EXECUTION_LABELS[item.executionStatus] ??
                                item.executionStatus)
                              : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ApprovalCard({
  model,
  item,
  userId,
  now,
}: {
  model: Ready;
  item: ApprovalItem;
  userId: string | null;
  now: number;
}) {
  const own = userId !== null && item.requestingUserId === userId;
  return (
    <li className="approval">
      <div className="approval-head">
        <span className="queue-icon pill tone-info">
          <UiIcon name="shield" size={15} />
        </span>
        <div>
          <strong>{actionLabel(item.actionId)}</strong>
          <small>
            {item.requestedByAgent
              ? "Requested by an agent"
              : "Requested by a person"}
            {own ? " · you" : ""} · expires {relativeTime(item.expiresAt, now)}
          </small>
        </div>
        <span
          className={`pill pill-dot ${toneClass(RISK_TONES[item.risk] ?? "neutral")}`}
        >
          {labelStatus(item.risk)} risk
        </span>
      </div>
      <dl className="params">
        <div>
          <dt>Target</dt>
          <dd className="mono">{item.targetResource}</dd>
        </div>
        {item.parameters.map(([key, value]) => (
          <div key={key}>
            <dt>{key.replaceAll("_", " ")}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {!canDecide(model.organization.role) ? (
        <p className="decision-note">
          Your role can see this request. A project manager, admin, or owner
          decides.
        </p>
      ) : own ? (
        <p className="decision-note">
          You asked for this action, so another approver must decide.
        </p>
      ) : (
        <form
          autoComplete="off"
          method="post"
          action="/workspace/approvals"
          className="decision-form"
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
          <input type="hidden" name="approval_id" value={item.id} />
          <label htmlFor={`reason-${item.id}`}>
            Reason
            <input
              id={`reason-${item.id}`}
              name="reason"
              required
              maxLength={500}
              placeholder="Why you are approving or rejecting this request"
            />
          </label>
          <div className="form-actions">
            <button type="submit" name="decision" value="APPROVED">
              <UiIcon name="check" size={15} /> Approve
            </button>
            <button
              type="submit"
              name="decision"
              value="REJECTED"
              className="btn-danger"
            >
              <UiIcon name="x" size={15} /> Reject
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon: IconName;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <UiIcon name={icon} size={17} />
      </span>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  );
}

function ProjectsMain({
  model,
  creating,
  editing,
  managing: manageRequested,
  view,
}: {
  model: Ready;
  creating: boolean;
  editing: boolean;
  managing: boolean;
  view: EngagementsView;
}) {
  if (creating && model.canManageProjects) {
    return <EngagementCreatePage model={model} notice={model.notice} />;
  }
  // Editing uses the form the engagement was created with (Milestone 8.15).
  if (
    editing &&
    model.canManageProjects &&
    model.projectDetail !== null &&
    detailsEditable(model.projectDetail.status)
  ) {
    return (
      <EngagementCreatePage
        model={model}
        notice={model.notice}
        editing={model.projectDetail}
      />
    );
  }
  const detail = model.projectDetail;
  const clientsView = view === "clients" && model.canManageProjects;
  // An engagement chosen from its card's menu opens its status and close-out over the page.
  const managing =
    manageRequested &&
    detail !== null &&
    model.canManageProjects &&
    !clientsView &&
    model.projects.length > 0;
  const viewHref = (next: EngagementsView) => {
    const params = new URLSearchParams({
      organization: model.organization.id,
      section: "projects",
    });
    if (next === "clients") {
      params.set("view", "clients");
    } else if (model.selectedProject !== null) {
      params.set("project", model.selectedProject.id);
    }
    return `/?${params}`;
  };
  return (
    <div className="page eg">
      <PageHeader
        context={model.organization.name}
        title="Engagements"
        description={portfolioLine(model.projects)}
        actions={
          model.canManageProjects ? (
            <a className="btn" href={createEngagementHref(model)}>
              <UiIcon name="plus" size={15} />
              New engagement
            </a>
          ) : undefined
        }
      />
      {model.notice !== null && !managing ? (
        <Banner>{NOTICES[model.notice]}</Banner>
      ) : null}
      {model.canManageProjects ? (
        <nav className="eg-views" aria-label="Engagements or clients">
          <a
            href={viewHref("engagements")}
            aria-current={clientsView ? undefined : "page"}
          >
            Engagements <span>{openEngagements(model.projects).length}</span>
          </a>
          <a
            href={viewHref("clients")}
            aria-current={clientsView ? "page" : undefined}
          >
            Clients <span>{model.clients.length}</span>
          </a>
        </nav>
      ) : null}
      {clientsView ? (
        model.clients.length === 0 ? (
          <section className="card">
            <EmptyState
              icon="briefcase"
              title="No clients yet"
              detail="A client is added with its first engagement."
              action={
                <a className="btn" href={createEngagementHref(model)}>
                  New engagement
                  <UiIcon name="arrow" size={15} />
                </a>
              }
            />
          </section>
        ) : (
          <ClientsTable
            clients={model.clients}
            organizationId={model.organization.id}
            canRename={canCloseOut(model.organization.role)}
            newHref={createEngagementHref(model)}
          />
        )
      ) : model.projects.length === 0 ? (
        <section className="card">
          <EmptyState
            icon="briefcase"
            title="No engagements yet"
            detail="Create the first audit for this firm. Scope, work, evidence, and decisions will live on it."
            action={
              model.canManageProjects ? (
                <a className="btn" href={createEngagementHref(model)}>
                  New engagement
                  <UiIcon name="arrow" size={15} />
                </a>
              ) : undefined
            }
          />
        </section>
      ) : (
        <>
          <EngagementsBoard
            projects={model.projects}
            selectedId={managing && detail !== null ? detail.id : null}
            organizationId={model.organization.id}
            now={new Date().toISOString()}
            canManage={model.canManageProjects}
            newHref={createEngagementHref(model)}
          />
          {/* An engagement's status and close-out open over the page, from its card's
              menu; the page underneath stays as it was. */}
          {managing && detail !== null ? (
            <RecordDialog
              eyebrow={
                detail.clientName !== "" ? detail.clientName : "No client"
              }
              title={detail.name}
              description={`Period end ${detail.periodEnd !== null ? formatDate(detail.periodEnd) : "not set"} · Lead ${detail.ownerName}`}
              closeHref={`/?${new URLSearchParams({ organization: model.organization.id, section: "projects", project: detail.id })}`}
            >
              <div className="eg-manage">
                {model.notice !== null ? (
                  <Banner>{NOTICES[model.notice]}</Banner>
                ) : null}
                <EngagementSettings model={model} detail={detail} />
                <EngagementCloseOut model={model} detail={detail} />
                <a
                  className="eg-manage-open"
                  href={workspaceHref(
                    cardEntry(detail.status).section,
                    model.organization.id,
                    detail.id,
                  )}
                >
                  {cardEntry(detail.status).label}
                  <UiIcon name="arrow" size={14} />
                </a>
              </div>
            </RecordDialog>
          ) : null}
        </>
      )}
    </div>
  );
}

function EngagementSettings({
  model,
  detail,
}: {
  model: Ready;
  detail: ProjectDetail;
}) {
  // The details are edited with the form the engagement was created with (Milestone
  // 8.15). The status moves only by its own actions: launching from setup, then pause,
  // resume, complete, and archive (engagement-lifecycle.ts).
  const editable = detailsEditable(detail.status);
  const actions = statusActions(detail.status);
  return (
    <section
      className="card eg-card-plain"
      aria-labelledby="engagement-settings-title"
    >
      <CardHeader
        title="Status"
        titleId="engagement-settings-title"
        description={statusMeaning(detail.status)}
        aside={<StatusPill status={detail.status} />}
      />
      <div className="card-body">
        <form
          autoComplete="off"
          method="post"
          action="/workspace/projects"
          className="form"
        >
          <input
            type="hidden"
            name="organization_id"
            value={model.organization.id}
          />
          <input type="hidden" name="project_id" value={detail.id} />
          <input type="hidden" name="version" value={detail.version} />
          <input type="hidden" name="status" value={detail.status} />
          {/* A status change sends the details as they are. */}
          <input type="hidden" name="name" value={detail.name} />
          <input type="hidden" name="slug" value={detail.slug} />
          <input type="hidden" name="scope" value={detail.scope} />
          <input
            type="hidden"
            name="owner_user_id"
            value={detail.ownerUserId}
          />
          <input type="hidden" name="starts_on" value={detail.startsOn ?? ""} />
          <input type="hidden" name="ends_on" value={detail.endsOn ?? ""} />
          {editable || actions.length > 0 ? (
            <div className="form-actions">
              {editable ? (
                <a className="btn" href={editEngagementHref(model, detail.id)}>
                  Edit details
                </a>
              ) : null}
              {detail.status === "DRAFT" ? (
                <a
                  className="btn btn-secondary"
                  href={workspaceHref(
                    "setup",
                    model.organization.id,
                    detail.id,
                  )}
                >
                  Continue setup
                </a>
              ) : null}
              {actions.includes("pause") ? (
                <button
                  type="submit"
                  name="intent"
                  value="pause"
                  className="btn-secondary"
                >
                  Pause
                </button>
              ) : null}
              {actions.includes("resume") ? (
                <button
                  type="submit"
                  name="intent"
                  value="resume"
                  className="btn-secondary"
                >
                  Resume
                </button>
              ) : null}
              {actions.includes("archive") ? (
                <ConfirmAction
                  label="Archive"
                  intent="archive"
                  title={`Archive ${detail.name}?`}
                  consequence={archiveConsequence(detail.status !== "DRAFT")}
                  confirmLabel="Archive engagement"
                />
              ) : null}
            </div>
          ) : (
            <p className="form-hint">
              Its details are kept as they were when it closed.
            </p>
          )}
        </form>
      </div>
    </section>
  );
}

/**
 * Completing, reopening, and deleting an engagement (Milestone 8.14). Completing waits
 * until the work is done and lists what is still open; reopening and deleting are for an
 * owner or admin. The API decides each; this card only offers what it would allow.
 */
function EngagementCloseOut({
  model,
  detail,
}: {
  model: Ready;
  detail: ProjectDetail;
}) {
  const completion = detail.completion;
  const running = detail.status === "ACTIVE" || detail.status === "PAUSED";
  const ownerOrAdmin = canCloseOut(model.organization.role);
  const deletable = completion?.deletable === true && ownerOrAdmin;
  if (!running && detail.status !== "COMPLETED" && !deletable) {
    return null;
  }
  const identity = (
    <>
      <input
        type="hidden"
        name="organization_id"
        value={model.organization.id}
      />
      <input type="hidden" name="project_id" value={detail.id} />
      <input type="hidden" name="version" value={detail.version} />
    </>
  );
  const controlHref = (controlId: string) =>
    `${workspaceHref("controls", model.organization.id, detail.id)}&control=${controlId}`;
  return (
    <section
      className="card eg-card-plain"
      aria-labelledby="engagement-closeout-title"
    >
      <CardHeader
        title={deletable ? "Delete draft" : "Completion"}
        titleId="engagement-closeout-title"
        description={
          deletable
            ? "This engagement never launched, so it can be deleted."
            : detail.status === "COMPLETED"
              ? "The work is done and the engagement is read-only."
              : "Complete the engagement once its work is done."
        }
      />
      <div className="card-body closeout">
        {running && completion === null ? (
          <p className="form-hint">
            Where the work stands could not be loaded. Refresh to try again.
          </p>
        ) : null}
        {running && completion?.canComplete ? (
          <form
            autoComplete="off"
            method="post"
            action="/workspace/projects"
            className="closeout-row"
          >
            {identity}
            <p>
              Every control in scope is tested, reviewed, and signed off, and
              nothing else is open.
            </p>
            <ConfirmAction
              label="Complete engagement"
              intent="complete"
              className=""
              tone="neutral"
              title={`Complete ${detail.name}?`}
              consequence={COMPLETE_CONSEQUENCE}
              confirmLabel="Complete engagement"
            />
          </form>
        ) : null}
        {running && completion !== null && !completion.canComplete ? (
          <div className="closeout-open">
            <p>
              <strong>
                {completion.openCount}{" "}
                {completion.openCount === 1 ? "item is" : "items are"} still
                open.
              </strong>{" "}
              The engagement can be completed once they are done.
            </p>
            <ul className="closeout-list">
              {uniqueKeys(
                completion.openItems,
                (item) => `${item.kind}-${item.label}`,
              ).map(([key, item]) => (
                <li key={key}>
                  {item.controlId !== null ? (
                    <a href={controlHref(item.controlId)}>{item.label}</a>
                  ) : (
                    <span>{item.label}</span>
                  )}
                </li>
              ))}
            </ul>
            {completion.openCount > completion.openItems.length ? (
              <p className="form-hint">
                And {completion.openCount - completion.openItems.length} more.
              </p>
            ) : null}
          </div>
        ) : null}
        {detail.status === "COMPLETED" ? (
          <form
            autoComplete="off"
            method="post"
            action="/workspace/projects"
            className="closeout-row"
          >
            {identity}
            <p>
              Completed
              {completion?.completedAt
                ? ` on ${formatDate(completion.completedAt.slice(0, 10))}`
                : ""}
              {completion?.completedBy ? ` by ${completion.completedBy}` : ""}.
            </p>
            {ownerOrAdmin ? (
              <ConfirmAction
                label="Reopen"
                intent="reopen"
                className="btn-secondary"
                tone="neutral"
                title={`Reopen ${detail.name}?`}
                consequence="Reopening makes the engagement active again so its work can change. Say why; the reason is kept with the engagement."
                confirmLabel="Reopen engagement"
                field={{
                  name: "reason",
                  label: "Reason for reopening",
                  kind: "reason",
                  minLength: 3,
                  maxLength: 500,
                }}
              />
            ) : (
              <p className="form-hint">An owner or admin can reopen it.</p>
            )}
          </form>
        ) : null}
        {deletable ? (
          <form
            autoComplete="off"
            method="post"
            action="/workspace/projects"
            className="closeout-row"
          >
            {identity}
            <p>
              Deleting removes it and its setup. Only the audit record is kept.
            </p>
            <ConfirmAction
              label="Delete draft"
              intent="delete"
              title={`Delete ${detail.name}?`}
              consequence={deleteConsequence(detail.name)}
              confirmLabel="Delete draft"
              field={{
                name: "confirm_name",
                label: `Type ${detail.name} to confirm`,
                kind: "match",
                match: detail.name,
              }}
            />
          </form>
        ) : null}
        {completion !== null && completion.reopenings.length > 0 ? (
          <div className="closeout-history">
            <h3 className="card-subhead">Reopened</h3>
            <ul>
              {completion.reopenings.map((item) => (
                <li key={item.reopenedAt}>
                  <span>{item.reason}</span>
                  <small>
                    {item.reopenedBy},{" "}
                    {formatDate(item.reopenedAt.slice(0, 10))}
                  </small>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

const AGENT_NOTICES: Record<AgentNotice, string> = {
  saved: "Agent saved.",
  invalid: "Check the agent fields and try again.",
  conflict: "This agent changed. Refresh it and try again.",
  key: "That key is already in use.",
  status: "That status change is not available.",
  denied: "You cannot change this agent.",
  unavailable: "The agent could not be saved.",
  secret: "Agents cannot store passwords or keys. Remove it and try again.",
  locked:
    "Standard agents cannot be edited. Create a custom agent to change how one works.",
  reserved:
    "That key belongs to a standard agent. Choose another key for the custom agent.",
  "ocr-saved": ANALYSIS_NOTICES["ocr-saved"],
  "ocr-changed": ANALYSIS_NOTICES["ocr-changed"],
};

const EMPTY_SCHEMA = `{
  "type": "object",
  "properties": {}
}`;

function TaskBoard({
  model,
  directory,
}: {
  model: Ready;
  directory: DirectoryQuery;
}) {
  const projectId = model.selectedProject?.id ?? "";
  const filtered = filterTasks(model.tasks, directory);
  const page = paginate(filtered, directory.taskPage);
  const lanes = TASK_STATUSES.map((status) => ({
    status,
    tasks: page.items.filter((task) => task.status === status),
  })).filter((lane) => lane.tasks.length > 0);
  return (
    <section className="card" aria-labelledby="board-title">
      <CardHeader
        title="Board"
        titleId="board-title"
        description={`${page.total} item${page.total === 1 ? "" : "s"}${
          directory.taskStatus !== null || directory.taskPriority !== null
            ? " match these filters"
            : ""
        }`}
        aside={
          <form autoComplete="off" method="get" action="/" className="toolbar">
            <input
              type="hidden"
              name="organization"
              value={model.organization.id}
            />
            <input type="hidden" name="project" value={projectId} />
            <input type="hidden" name="section" value="tasks" />
            <label htmlFor="task-filter-status">
              Status
              <select
                id="task-filter-status"
                name="taskStatus"
                defaultValue={directory.taskStatus ?? ""}
              >
                <option value="">All</option>
                {TASK_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {labelStatus(status)}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="task-filter-priority">
              Priority
              <select
                id="task-filter-priority"
                name="taskPriority"
                defaultValue={directory.taskPriority ?? ""}
              >
                <option value="">All</option>
                {PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {labelStatus(priority)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn-secondary btn-sm">
              Filter
            </button>
          </form>
        }
      />
      {model.tasks.length === 0 ? (
        <EmptyState
          icon="activity"
          title="No work planned yet"
          detail={`No tasks in ${model.selectedProject?.name ?? "this engagement"}. Add the first task to get started.`}
        />
      ) : page.total === 0 ? (
        <EmptyState
          icon="activity"
          title="No matches"
          detail="No tasks match this filter."
        />
      ) : (
        <div className="board">
          {lanes.map((lane) => (
            <section key={lane.status} className="lane">
              <h3 className="lane-head">
                {labelStatus(lane.status)}
                <span className="count">{lane.tasks.length}</span>
              </h3>
              <ul>
                {lane.tasks.map((task) => (
                  <li key={task.id}>
                    <a
                      className="item-card"
                      href={directoryHref({
                        section: "tasks",
                        organizationId: model.organization.id,
                        projectId,
                        taskId: task.id,
                        taskStatus: directory.taskStatus,
                        taskPriority: directory.taskPriority,
                        taskPage: page.page,
                      })}
                      aria-current={
                        model.selectedTask?.id === task.id ? "page" : undefined
                      }
                    >
                      <strong>{task.title}</strong>
                      <small>{task.assigneeName ?? "Unassigned"}</small>
                      <span className="item-meta">
                        <span
                          className={`pill ${toneClass(statusTone(task.priority))}`}
                        >
                          {labelStatus(task.priority)}
                        </span>
                        {task.deadline !== null ? (
                          <time className="pill" dateTime={task.deadline}>
                            Due {formatDate(task.deadline)}
                          </time>
                        ) : null}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <Pager
        page={page}
        hrefFor={(next) =>
          directoryHref({
            section: "tasks",
            organizationId: model.organization.id,
            projectId,
            taskStatus: directory.taskStatus,
            taskPriority: directory.taskPriority,
            taskPage: next,
          })
        }
      />
    </section>
  );
}

function Pager({
  page,
  hrefFor,
}: {
  page: { page: number; pages: number; total: number };
  hrefFor: (page: number) => string;
}) {
  if (page.pages <= 1) {
    return null;
  }
  return (
    <div className="pager">
      <span className="num">
        Page {page.page} of {page.pages}
      </span>
      <span className="pager-links">
        {page.page > 1 ? (
          <a className="btn btn-secondary btn-sm" href={hrefFor(page.page - 1)}>
            Previous
          </a>
        ) : (
          <span>Previous</span>
        )}
        {page.page < page.pages ? (
          <a className="btn btn-secondary btn-sm" href={hrefFor(page.page + 1)}>
            Next
          </a>
        ) : (
          <span>Next</span>
        )}
      </span>
    </div>
  );
}

type AgentRow = {
  id: string | null;
  agentKey: string;
  name: string;
  role: string;
  status: string | null;
  source: "standard" | "custom";
  tools: string[] | null;
  modelTier: string | null;
  staffed: boolean | null;
};

function agentRows(model: Ready, workflow: WorkflowState): AgentRow[] {
  const standard: AgentRow[] =
    workflow.workforce === null
      ? model.agents
          .filter((agent) => agent.source === "standard")
          .map((agent) => ({
            id: agent.id,
            agentKey: agent.agentKey,
            name: agent.name,
            role: agent.role,
            status: agent.status,
            source: "standard",
            tools: null,
            modelTier: null,
            staffed: null,
          }))
      : workflow.workforce.workers.map((worker) => ({
          id:
            model.agents.find((agent) => agent.agentKey === worker.agentKey)
              ?.id ?? null,
          agentKey: worker.agentKey,
          name: worker.name,
          role: worker.role,
          status: worker.definitionStatus,
          source: "standard",
          tools: worker.tools,
          modelTier: worker.modelTier,
          staffed: worker.staffed,
        }));
  const custom: AgentRow[] = model.agents
    .filter((agent) => agent.source !== "standard")
    .map((agent) => ({
      id: agent.id,
      agentKey: agent.agentKey,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      source: "custom",
      tools: null,
      modelTier: null,
      staffed: null,
    }));
  return [...standard, ...custom];
}

function agentHref(model: Ready, agentId: string): string {
  return workspaceHref(
    "agents",
    model.organization.id,
    model.selectedProject?.id ?? null,
    agentId,
  );
}

function AgentsMain({
  model,
  workflow,
  creating,
}: {
  model: Ready;
  workflow: WorkflowState;
  creating: boolean;
}) {
  if (creating && model.canManageAgents) {
    return <NewAgentPage model={model} />;
  }
  if (model.agentDetail !== null) {
    return (
      <AgentPage model={model} workflow={workflow} detail={model.agentDetail} />
    );
  }
  return <AgentListPage model={model} workflow={workflow} />;
}

function AgentListPage({
  model,
  workflow,
}: {
  model: Ready;
  workflow: WorkflowState;
}) {
  const rows = agentRows(model, workflow);
  const standard = rows.filter((row) => row.source === "standard");
  const custom = rows.filter((row) => row.source === "custom");
  const activeStandard = standard.filter((row) => row.status === "ACTIVE");
  const disabled = rows.filter((row) => row.status === "DISABLED").length;
  const project = model.selectedProject;
  const onTeam = standard.filter((row) => row.staffed === true).length;
  const pending = standard.some((row) => row.status === null);
  return (
    <div className="page">
      <PageHeader
        context={model.organization.name}
        title="AI workforce"
        description="Every engagement comes with the standard SOX workforce. Admins can switch an agent off for the firm, or add a custom agent for other work."
        actions={
          model.canManageAgents ? (
            <a className="btn" href={agentHref(model, "new")}>
              <UiIcon name="plus" size={15} /> New custom agent
            </a>
          ) : undefined
        }
      />
      {model.agentNotice !== null ? (
        <Banner>{AGENT_NOTICES[model.agentNotice]}</Banner>
      ) : null}
      <section className="kpis" aria-label="Workforce summary">
        <Metric
          icon="agents"
          label="Standard agents"
          value={standard.length}
          detail={`${activeStandard.length} active`}
          tone={pending ? "risk" : "default"}
        />
        <Metric
          icon="briefcase"
          label={project === null ? "On engagements" : `On ${project.name}`}
          value={
            project === null || workflow.workforce === null ? null : onTeam
          }
          detail={
            onTeam === activeStandard.length
              ? "Full standard team"
              : `${activeStandard.length - onTeam} missing`
          }
          tone={onTeam === activeStandard.length ? "positive" : "risk"}
        />
        <Metric
          icon="sparkles"
          label="Custom agents"
          value={custom.length}
          detail={custom.length === 0 ? "None yet" : "Firm-defined"}
        />
        <Metric
          icon="shield"
          label="Disabled"
          value={disabled}
          detail={disabled === 0 ? "Everything is on" : "Not taking new work"}
        />
      </section>
      {pending ? (
        <Banner tone="warning">
          Some standard agents are not available in this workspace yet.
        </Banner>
      ) : null}
      <section className="card" aria-labelledby="standard-agents-title">
        <CardHeader
          title="Standard workforce"
          titleId="standard-agents-title"
          description="Included in every engagement. Sensitive actions always wait for a person to approve them."
          aside={
            workflow.workforce === null ? undefined : (
              <span className="pill">
                Roster v{workflow.workforce.rosterVersion}
              </span>
            )
          }
        />
        <AgentTable model={model} rows={standard} showTeam={project !== null} />
      </section>
      <section className="card" aria-labelledby="custom-agents-title">
        <CardHeader
          title="Custom agents"
          titleId="custom-agents-title"
          description="Defined by your firm's admins for work the standard roster does not cover."
        />
        {custom.length === 0 ? (
          <EmptyState
            icon="sparkles"
            title="No custom agents"
            detail={
              model.canManageAgents
                ? "Add one when your firm needs a role the standard workforce does not cover."
                : "Only an owner or admin can add custom agents."
            }
            action={
              model.canManageAgents ? (
                <a className="btn btn-secondary" href={agentHref(model, "new")}>
                  <UiIcon name="plus" size={15} /> New custom agent
                </a>
              ) : undefined
            }
          />
        ) : (
          <AgentTable model={model} rows={custom} showTeam={false} />
        )}
      </section>
      <EvidenceReadingCard
        settings={workflow.evidenceSettings}
        organizationId={model.organization.id}
        canManage={model.canManageAgents}
      />
    </div>
  );
}

function AgentTable({
  model,
  rows,
  showTeam,
}: {
  model: Ready;
  rows: readonly AgentRow[];
  showTeam: boolean;
}) {
  const withTools = rows.some((row) => row.tools !== null);
  return (
    <div className="table-wrap">
      <table className="table table-links">
        <thead>
          <tr>
            <th scope="col">Agent</th>
            {withTools ? <th scope="col">Allowed actions</th> : null}
            <th scope="col">Status</th>
            {showTeam ? <th scope="col">Engagement</th> : null}
            <th scope="col" className="cell-end">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.agentKey}>
              <td>
                <div className="agent-cell">
                  <span className="agent-mark" aria-hidden="true">
                    {agentMonogram(row.name)}
                  </span>
                  <span className="cell-primary">
                    {row.id === null ? (
                      <strong>{row.name}</strong>
                    ) : (
                      <a className="row-link" href={agentHref(model, row.id)}>
                        {row.name}
                      </a>
                    )}
                    <small>
                      {row.role}
                      {row.modelTier === null
                        ? ""
                        : ` · ${modelTierLabel(row.modelTier)}`}
                    </small>
                  </span>
                </div>
              </td>
              {withTools ? (
                <td>
                  <ul className="chips">
                    {(row.tools ?? []).map((tool) => (
                      <li key={tool} className="pill mono">
                        {tool}
                      </li>
                    ))}
                  </ul>
                </td>
              ) : null}
              <td>
                {row.status === null ? (
                  <span className="pill">Pending deploy</span>
                ) : (
                  <StatusPill status={row.status} />
                )}
              </td>
              {showTeam ? (
                <td>
                  {row.staffed ? (
                    <span className="pill pill-dot tone-info">On team</span>
                  ) : (
                    <span className="cell-sub">Not on team</span>
                  )}
                </td>
              ) : null}
              <td className="cell-end">
                <UiIcon name="chevron" size={16} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgentPage({
  model,
  workflow,
  detail,
}: {
  model: Ready;
  workflow: WorkflowState;
  detail: AgentDetail;
}) {
  const standard = detail.source === "standard";
  const worker =
    workflow.workforce?.workers.find(
      (item) => item.agentKey === detail.agentKey,
    ) ?? null;
  const project = model.selectedProject;
  const listHref = sectionHref(model, "agents");
  return (
    <div className="page">
      <a className="back-link" href={listHref}>
        <UiIcon name="chevron" size={14} /> AI workforce
      </a>
      <header className="agent-hero">
        <span className="agent-mark agent-mark-lg" aria-hidden="true">
          {agentMonogram(detail.name)}
        </span>
        <div className="agent-hero-copy">
          <div className="page-title">
            <h1>{detail.name}</h1>
            <StatusPill status={detail.status} />
            <span className={`pill ${standard ? "tone-info" : ""}`}>
              {standard ? "Standard" : "Custom"}
            </span>
          </div>
          <p className="page-desc">{detail.role}</p>
        </div>
        {standard && model.canManageAgents ? (
          <div className="page-actions">
            <AgentStatusForm model={model} detail={detail} />
          </div>
        ) : null}
      </header>
      {model.agentNotice !== null ? (
        <Banner>{AGENT_NOTICES[model.agentNotice]}</Banner>
      ) : null}
      <div className="layout-main">
        <div className="stack">
          <section className="card" aria-labelledby="agent-about-title">
            <CardHeader title="What it does" titleId="agent-about-title" />
            <div className="card-body">
              <p className="prose">
                {detail.description === ""
                  ? "No description yet."
                  : detail.description}
              </p>
            </div>
          </section>
          <section className="card" aria-labelledby="agent-actions-title">
            <CardHeader
              title="Allowed actions"
              titleId="agent-actions-title"
              description="What this agent may ask to do. Approvals still apply."
            />
            <div className="card-body">
              {detail.allowedToolIds.length === 0 ? (
                <p className="muted">No actions. It can only propose work.</p>
              ) : (
                <ul className="chips">
                  {detail.allowedToolIds.map((tool) => (
                    <li key={tool} className="pill mono">
                      {tool}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
          {!standard && model.canManageAgents ? (
            <section className="card" aria-labelledby="agent-edit-title">
              <CardHeader
                title="Edit custom agent"
                titleId="agent-edit-title"
                description="Changes apply to new work. Work already under way finishes as it started."
              />
              <div className="card-body">
                <form
                  autoComplete="off"
                  method="post"
                  action="/workspace/agents"
                  className="form"
                >
                  <AgentIdentity model={model} detail={detail} />
                  <AgentFields idPrefix="edit-agent" detail={detail} />
                  <div className="form-actions">
                    <button type="submit" name="intent" value="update">
                      Save changes
                    </button>
                    {detail.status === "ACTIVE" ? (
                      <button
                        type="submit"
                        name="intent"
                        value="disable"
                        className="btn-danger"
                      >
                        Disable
                      </button>
                    ) : (
                      <button
                        type="submit"
                        name="intent"
                        value="enable"
                        className="btn-secondary"
                      >
                        Enable
                      </button>
                    )}
                  </div>
                </form>
              </div>
            </section>
          ) : (
            <section className="card" aria-labelledby="agent-interface-title">
              <CardHeader
                title="Inputs and outputs"
                titleId="agent-interface-title"
                description="What the agent receives and returns. Every result is checked against these before it is used."
              />
              <div className="card-body schema-grid">
                <div>
                  <h3 className="card-subhead">Input</h3>
                  <pre className="code-block">{detail.inputSchema}</pre>
                </div>
                <div>
                  <h3 className="card-subhead">Output</h3>
                  <pre className="code-block">{detail.outputSchema}</pre>
                </div>
              </div>
            </section>
          )}
        </div>
        <div className="stack">
          {standard ? (
            <section className="card">
              <div className="card-body">
                <Banner>
                  A standard agent. It joins every engagement automatically and
                  improves with each product update.{" "}
                  {model.canManageAgents
                    ? "To change how it works, disable it and create a custom agent."
                    : "Only an owner or admin can switch it off."}
                </Banner>
              </div>
            </section>
          ) : null}
          <section className="card" aria-labelledby="agent-details-title">
            <CardHeader title="Details" titleId="agent-details-title" />
            <div className="card-body">
              <dl className="facts facts-single">
                <div>
                  <dt>Key</dt>
                  <dd className="mono">{detail.agentKey}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{modelTierLabel(detail.modelConfigRef)}</dd>
                </div>
                <div>
                  <dt>Limits</dt>
                  <dd>
                    {detail.maxIterations} steps ·{" "}
                    {formatDuration(detail.timeBudgetSeconds)}
                  </dd>
                </div>
                <div>
                  <dt>Revision</dt>
                  <dd className="num">{detail.revision}</dd>
                </div>
                <div>
                  <dt>Definition</dt>
                  <dd className="mono cell-sub">{detail.id}</dd>
                </div>
              </dl>
            </div>
          </section>
          {standard && project !== null && worker !== null ? (
            <section className="card" aria-labelledby="agent-team-title">
              <CardHeader title="Engagement" titleId="agent-team-title" />
              <div className="card-body">
                <div className="team-row">
                  <span className="engagement-mark" aria-hidden="true">
                    {monogram(project.name)}
                  </span>
                  <span className="cell-primary">
                    <strong>{project.name}</strong>
                    <small>
                      {worker.staffed
                        ? "On the team and assignable to tasks"
                        : "Not on the team while disabled"}
                    </small>
                  </span>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AgentIdentity({
  model,
  detail,
}: {
  model: Ready;
  detail: AgentDetail;
}) {
  return (
    <>
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
      <input type="hidden" name="agent_id" value={detail.id} />
      <input type="hidden" name="version" value={detail.version} />
    </>
  );
}

/** A standard agent can only be switched off or on. Its content is sent unchanged. */
function AgentStatusForm({
  model,
  detail,
}: {
  model: Ready;
  detail: AgentDetail;
}) {
  const active = detail.status === "ACTIVE";
  return (
    <form autoComplete="off" method="post" action="/workspace/agents">
      <AgentIdentity model={model} detail={detail} />
      <input type="hidden" name="name" value={detail.name} />
      <input type="hidden" name="agent_key" value={detail.agentKey} />
      <input type="hidden" name="role" value={detail.role} />
      <input type="hidden" name="description" value={detail.description} />
      <input
        type="hidden"
        name="model_config_ref"
        value={detail.modelConfigRef}
      />
      <input
        type="hidden"
        name="allowed_tool_ids"
        value={detail.allowedToolIds.join(", ")}
      />
      <input type="hidden" name="max_iterations" value={detail.maxIterations} />
      <input
        type="hidden"
        name="time_budget_seconds"
        value={detail.timeBudgetSeconds}
      />
      <input type="hidden" name="input_schema" value={detail.inputSchema} />
      <input type="hidden" name="output_schema" value={detail.outputSchema} />
      <input type="hidden" name="status" value={detail.status} />
      <button
        type="submit"
        name="intent"
        value={active ? "disable" : "enable"}
        className={active ? "btn-secondary" : ""}
      >
        {active ? "Disable for the firm" : "Enable for the firm"}
      </button>
    </form>
  );
}

function NewAgentPage({ model }: { model: Ready }) {
  return (
    <div className="page">
      <a className="back-link" href={sectionHref(model, "agents")}>
        <UiIcon name="chevron" size={14} /> AI workforce
      </a>
      <PageHeader
        title="New custom agent"
        description="For work the standard SOX workforce does not cover. Custom agents belong to your firm and only admins can change them."
      />
      {model.agentNotice !== null ? (
        <Banner tone="warning">{AGENT_NOTICES[model.agentNotice]}</Banner>
      ) : null}
      <div className="layout-main">
        <section className="card" aria-labelledby="new-agent-title">
          <CardHeader title="Definition" titleId="new-agent-title" />
          <div className="card-body">
            <form
              autoComplete="off"
              method="post"
              action="/workspace/agents"
              className="form"
            >
              <input type="hidden" name="intent" value="create" />
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
              <AgentFields idPrefix="agent" detail={null} />
              <div className="form-actions">
                <button type="submit">Create agent</button>
                <a
                  className="btn btn-secondary"
                  href={sectionHref(model, "agents")}
                >
                  Cancel
                </a>
              </div>
            </form>
          </div>
        </section>
        <section className="card" aria-labelledby="new-agent-help-title">
          <CardHeader
            title="Before you create it"
            titleId="new-agent-help-title"
          />
          <div className="card-body">
            <ul className="guide">
              <li>
                <strong>Pick a new key.</strong> Standard agent keys are
                reserved.
              </li>
              <li>
                <strong>Grant only what it needs.</strong> Sensitive actions
                still need approval.
              </li>
              <li>
                <strong>Name a model tier, never a secret.</strong> Use
                <span className="mono"> reasoning</span> or
                <span className="mono"> standard</span>.
              </li>
              <li>
                <strong>Describe the job.</strong> People read this when they
                assign work.
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

function AgentFields({
  idPrefix,
  detail,
}: {
  idPrefix: string;
  detail: AgentDetail | null;
}) {
  return (
    <>
      <label htmlFor={`${idPrefix}-name`}>
        Name
        <input
          autoComplete="off"
          id={`${idPrefix}-name`}
          name="name"
          required
          maxLength={200}
          defaultValue={detail?.name ?? ""}
        />
      </label>
      <label htmlFor={`${idPrefix}-key`}>
        Key
        <input
          autoComplete="off"
          id={`${idPrefix}-key`}
          name="agent_key"
          required
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          maxLength={80}
          defaultValue={detail?.agentKey ?? ""}
        />
      </label>
      <label htmlFor={`${idPrefix}-role`}>
        Role
        <input
          autoComplete="off"
          id={`${idPrefix}-role`}
          name="role"
          required
          maxLength={120}
          defaultValue={detail?.role ?? ""}
        />
      </label>
      <label htmlFor={`${idPrefix}-model`}>
        Model tier
        <input
          id={`${idPrefix}-model`}
          name="model_config_ref"
          required
          maxLength={121}
          defaultValue={detail?.modelConfigRef ?? ""}
          autoComplete="off"
          placeholder="standard"
        />
      </label>
      <label htmlFor={`${idPrefix}-description`}>
        Description
        <textarea
          autoComplete="off"
          id={`${idPrefix}-description`}
          name="description"
          rows={3}
          maxLength={4000}
          defaultValue={detail?.description ?? ""}
        />
      </label>
      <label htmlFor={`${idPrefix}-tools`} className="field-wide">
        Allowed actions
        <input
          autoComplete="off"
          id={`${idPrefix}-tools`}
          name="allowed_tool_ids"
          defaultValue={detail?.allowedToolIds.join(", ") ?? ""}
          placeholder="file.read, workpaper.update"
        />
      </label>
      <label htmlFor={`${idPrefix}-iterations`}>
        Maximum iterations
        <input
          autoComplete="off"
          id={`${idPrefix}-iterations`}
          name="max_iterations"
          type="number"
          required
          min={1}
          max={100}
          defaultValue={detail?.maxIterations ?? 4}
        />
      </label>
      <label htmlFor={`${idPrefix}-budget`}>
        Time budget in seconds
        <input
          autoComplete="off"
          id={`${idPrefix}-budget`}
          name="time_budget_seconds"
          type="number"
          required
          min={1}
          max={86400}
          defaultValue={detail?.timeBudgetSeconds ?? 600}
        />
      </label>
      <label htmlFor={`${idPrefix}-input`}>
        Input schema
        <textarea
          autoComplete="off"
          id={`${idPrefix}-input`}
          name="input_schema"
          rows={5}
          required
          defaultValue={detail?.inputSchema ?? EMPTY_SCHEMA}
        />
      </label>
      <label htmlFor={`${idPrefix}-output`}>
        Output schema
        <textarea
          autoComplete="off"
          id={`${idPrefix}-output`}
          name="output_schema"
          rows={5}
          required
          defaultValue={detail?.outputSchema ?? EMPTY_SCHEMA}
        />
      </label>
      <label htmlFor={`${idPrefix}-status`}>
        Status
        <select
          id={`${idPrefix}-status`}
          name="status"
          defaultValue={detail?.status ?? "ACTIVE"}
        >
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
        </select>
      </label>
    </>
  );
}

const TASK_NOTICES: Record<TaskNotice, string> = {
  saved: "Task saved.",
  invalid: "Check the task fields and try again.",
  conflict: "This task changed. Refresh it and try again.",
  status: "That status change is not available.",
  denied: "You cannot change this task.",
  unavailable: "The task could not be saved.",
  dependency: "That dependency is not allowed.",
  agent: "That agent cannot take this task.",
  retry: "This task has no retries remaining.",
};

function TasksMain({
  model,
  directory,
}: {
  model: Ready;
  directory: DirectoryQuery;
}) {
  if (model.selectedProject === null) {
    return <NoEngagement model={model} what="Tasks" />;
  }
  const closeHref = directoryHref({
    section: "tasks",
    organizationId: model.organization.id,
    projectId: model.selectedProject.id,
    taskStatus: directory.taskStatus,
    taskPriority: directory.taskPriority,
    taskPage: directory.taskPage,
  });
  return (
    <div className="page">
      <PageHeader
        context={model.selectedProject.name}
        title="Work"
        description="Tasks move from draft to ready, in progress, and review. A blocked task needs a reason, and a cancelled one stays closed until it is reactivated."
        actions={
          model.taskDetail !== null && model.canManageTasks ? (
            <a className="btn btn-secondary" href={closeHref}>
              <UiIcon name="plus" size={15} /> Add work
            </a>
          ) : undefined
        }
      />
      {model.taskNotice !== null ? (
        <Banner>{TASK_NOTICES[model.taskNotice]}</Banner>
      ) : null}
      <div className="layout-rail">
        <TaskBoard model={model} directory={directory} />
        {model.taskDetail !== null ? (
          <TaskEditor
            model={model}
            detail={model.taskDetail}
            closeHref={closeHref}
          />
        ) : model.canManageTasks ? (
          <CreateTask model={model} />
        ) : (
          <section className="card">
            <CardHeader title="Task access" />
            <div className="card-body">
              <p>
                Your role can review tasks. It cannot create or change them.
              </p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function CreateTask({ model }: { model: Ready }) {
  return (
    <section className="card" aria-labelledby="new-task-title">
      <CardHeader
        title="Add work"
        titleId="new-task-title"
        description="Start in draft. Mark it ready when someone should pick it up."
      />
      <div className="card-body">
        <form
          autoComplete="off"
          method="post"
          action="/workspace/tasks"
          className="form"
        >
          <input type="hidden" name="intent" value="create" />
          <TaskIdentity model={model} taskId="" version="" />
          <TaskFields model={model} detail={null} />
          <div className="form-actions">
            <button type="submit">Add work</button>
          </div>
        </form>
      </div>
    </section>
  );
}

function TaskEditor({
  model,
  detail,
  closeHref,
}: {
  model: Ready;
  detail: TaskDetail;
  closeHref: string;
}) {
  const choices = taskStatusChoices(detail.status);
  return (
    <section className="card" aria-labelledby="task-detail-title">
      <CardHeader
        title={detail.title}
        titleId="task-detail-title"
        description={`Retries ${detail.retryCount} of ${detail.maxRetries} · ${
          detail.assigneeName === null
            ? "Unassigned"
            : `Assigned to ${detail.assigneeName}`
        }`}
        aside={
          <>
            <StatusPill status={detail.status} />
            <a className="text-link is-plain" href={closeHref}>
              Close
            </a>
          </>
        }
      />
      <div className="card-body">
        <h3 className="card-subhead">Execution history</h3>
        {detail.activity.length === 0 ? (
          <p className="muted">No history yet.</p>
        ) : (
          <ActivityRows activity={detail.activity} />
        )}
        {model.canManageTasks ? (
          <form
            autoComplete="off"
            method="post"
            action="/workspace/tasks"
            className="form"
          >
            <h3 className="form-section">Details</h3>
            <TaskIdentity
              model={model}
              taskId={detail.id}
              version={String(detail.version)}
            />
            <TaskFields model={model} detail={detail} />
            <div className="form-actions">
              <button type="submit" name="intent" value="update">
                Save task
              </button>
              {choices.includes("CANCELLED") &&
              detail.status !== "CANCELLED" ? (
                <button
                  type="submit"
                  name="intent"
                  value="cancel"
                  className="btn-danger"
                >
                  Cancel task
                </button>
              ) : null}
              {detail.status === "FAILED" &&
              detail.retryCount < detail.maxRetries ? (
                <button
                  type="submit"
                  name="intent"
                  value="retry"
                  className="btn-secondary"
                >
                  Retry
                </button>
              ) : null}
              {detail.status === "CANCELLED" ? (
                <button
                  type="submit"
                  name="intent"
                  value="reactivate"
                  className="btn-secondary"
                >
                  Reactivate
                </button>
              ) : null}
            </div>
          </form>
        ) : (
          <p>
            {detail.description === "" ? "No description." : detail.description}
          </p>
        )}
      </div>
    </section>
  );
}

function TaskIdentity({
  model,
  taskId,
  version,
}: {
  model: Ready;
  taskId: string;
  version: string;
}) {
  return (
    <>
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
      {taskId !== "" ? (
        <input type="hidden" name="task_id" value={taskId} />
      ) : null}
      {version !== "" ? (
        <input type="hidden" name="version" value={version} />
      ) : null}
    </>
  );
}

function TaskFields({
  model,
  detail,
}: {
  model: Ready;
  detail: TaskDetail | null;
}) {
  const choices =
    detail === null ? ["DRAFT", "READY"] : taskStatusChoices(detail.status);
  const others = model.tasks.filter((task) => task.id !== detail?.id);
  return (
    <>
      <label
        htmlFor={detail === null ? "task-title" : "edit-task-title"}
        className="field-wide"
      >
        Title
        <input
          autoComplete="off"
          id={detail === null ? "task-title" : "edit-task-title"}
          name="title"
          required
          maxLength={200}
          defaultValue={detail?.title ?? ""}
        />
      </label>
      <label
        htmlFor={detail === null ? "task-description" : "edit-task-description"}
      >
        Description
        <textarea
          autoComplete="off"
          id={detail === null ? "task-description" : "edit-task-description"}
          name="description"
          rows={3}
          maxLength={4000}
          defaultValue={detail?.description ?? ""}
        />
      </label>
      <label htmlFor={detail === null ? "task-priority" : "edit-task-priority"}>
        Priority
        <select
          id={detail === null ? "task-priority" : "edit-task-priority"}
          name="priority"
          defaultValue={detail?.priority ?? "NORMAL"}
        >
          <option value="LOW">Low</option>
          <option value="NORMAL">Normal</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>
      </label>
      <label htmlFor={detail === null ? "task-deadline" : "edit-task-deadline"}>
        Deadline
        <input
          autoComplete="off"
          id={detail === null ? "task-deadline" : "edit-task-deadline"}
          name="deadline"
          type="date"
          defaultValue={detail?.deadline ?? ""}
        />
      </label>
      <label htmlFor={detail === null ? "task-assignee" : "edit-task-assignee"}>
        Assignee
        <select
          id={detail === null ? "task-assignee" : "edit-task-assignee"}
          name="assignee_user_id"
          defaultValue={detail?.assigneeUserId ?? ""}
        >
          <option value="">Unassigned</option>
          {model.taskAssignees.map((person) => (
            <option key={person.id} value={person.id}>
              {person.displayName}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={detail === null ? "task-agent" : "edit-task-agent"}>
        Agent
        <select
          id={detail === null ? "task-agent" : "edit-task-agent"}
          name="agent_instance_id"
          defaultValue={detail?.agentInstanceId ?? ""}
        >
          <option value="">No agent</option>
          {model.agentInstances.map((instance) => (
            <option
              key={instance.id}
              value={instance.id}
              disabled={
                instance.definitionStatus === "DISABLED" &&
                instance.id !== detail?.agentInstanceId
              }
            >
              {instance.name} · {labelStatus(instance.status)}
            </option>
          ))}
        </select>
        {model.agentInstances.length === 0 ? (
          <span className="form-hint">
            Standard agents join every engagement automatically. If none are
            listed, an admin has switched them off in{" "}
            <a href={sectionHref(model, "agents")}>AI workforce</a>.
          </span>
        ) : null}
      </label>
      <label htmlFor={detail === null ? "task-status" : "edit-task-status"}>
        Status
        <select
          id={detail === null ? "task-status" : "edit-task-status"}
          name="status"
          defaultValue={detail?.status ?? "DRAFT"}
        >
          {choices.map((status) => (
            <option key={status} value={status}>
              {labelStatus(status)}
            </option>
          ))}
        </select>
      </label>
      {detail === null ? null : (
        <TaskControls detail={detail} others={others} />
      )}
    </>
  );
}

function TaskControls({
  detail,
  others,
}: {
  detail: TaskDetail;
  others: Ready["tasks"];
}) {
  return (
    <>
      <h3 className="form-section">Controls</h3>
      <label htmlFor="edit-task-blocker" className="field-wide">
        Blocker
        <input
          autoComplete="off"
          id="edit-task-blocker"
          name="blocker"
          maxLength={2000}
          defaultValue={detail.blocker}
        />
      </label>
      <label htmlFor="edit-task-escalation" className="field-wide">
        Escalation
        <input
          autoComplete="off"
          id="edit-task-escalation"
          name="escalation"
          maxLength={2000}
          defaultValue={detail.escalation}
        />
      </label>
      <label htmlFor="edit-task-reason" className="field-wide">
        Cancellation reason
        <input
          autoComplete="off"
          id="edit-task-reason"
          name="cancellation_reason"
          maxLength={2000}
          defaultValue={detail.cancellationReason}
        />
      </label>
      <label htmlFor="edit-task-retries">
        Maximum retries
        <input
          autoComplete="off"
          id="edit-task-retries"
          name="max_retries"
          type="number"
          required
          min={0}
          max={20}
          defaultValue={detail.maxRetries}
        />
      </label>
      <label htmlFor="edit-task-artifacts">
        Artifact references
        <input
          autoComplete="off"
          id="edit-task-artifacts"
          name="artifact_refs"
          defaultValue={detail.artifactRefs.join(", ")}
        />
      </label>
      <label htmlFor="edit-task-depends">
        Depends on
        <select
          id="edit-task-depends"
          name="depends_on"
          multiple
          defaultValue={detail.dependsOn}
        >
          {others.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** The owners' secure upload links (8.12): who holds them, when they last opened or
 * uploaded, and the way to turn a recipient's links off. */
function UploadLinksCard({
  model,
  links,
  testMailbox,
}: {
  model: Ready;
  links: RecipientLink[] | null;
  testMailbox: boolean;
}) {
  const project = model.selectedProject;
  if (project === null || links === null) {
    return null;
  }
  const editable = canManageProjects(model.organization.role);
  const hidden = (recipient: string, intent: "revoke" | "preview") => (
    <>
      <input
        type="hidden"
        name="organization_id"
        value={model.organization.id}
      />
      <input type="hidden" name="project_id" value={project.id} />
      <input type="hidden" name="recipient" value={recipient} />
      <input type="hidden" name="intent" value={intent} />
    </>
  );
  return (
    <section className="card" aria-labelledby="upload-links-title">
      <CardHeader
        title="Secure upload links"
        titleId="upload-links-title"
        description="Each request email carries a link for its owner. They confirm a code sent to their address and upload to their open requests; files go straight to the request's control. Email attachments are not taken as evidence."
        aside={
          <span className="num">
            {links.length} owner{links.length === 1 ? "" : "s"}
          </span>
        }
      />
      {links.length === 0 ? (
        <p className="card-note">
          No links yet. Every evidence request that is sent carries one.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Owner</th>
                <th scope="col">Open requests</th>
                <th scope="col">Last opened</th>
                <th scope="col">Last upload</th>
                <th scope="col">Link</th>
                {editable ? (
                  <th scope="col" className="cell-end">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.recipient}>
                  <td>{link.recipient}</td>
                  <td className="num">{link.openRequests}</td>
                  <td>
                    {link.lastOpenedAt === null
                      ? "Not yet"
                      : formatDate(link.lastOpenedAt)}
                  </td>
                  <td>
                    {link.lastUploadAt === null
                      ? "None"
                      : formatDate(link.lastUploadAt)}
                  </td>
                  <td>
                    {link.activeLinks > 0 ? (
                      <span className="pill pill-dot tone-success">Active</span>
                    ) : (
                      <span className="pill pill-dot tone-neutral">
                        Turned off
                      </span>
                    )}
                  </td>
                  {editable ? (
                    <td className="cell-end">
                      <span className="row-actions">
                        {testMailbox ? (
                          <form
                            autoComplete="off"
                            method="post"
                            action="/workspace/evidence-portal"
                            target="_blank"
                            rel="noopener"
                          >
                            {hidden(link.recipient, "preview")}
                            <button
                              type="submit"
                              className="btn-ghost btn-sm"
                              title="Local setup only: no email is sent here"
                            >
                              Open as owner
                            </button>
                          </form>
                        ) : null}
                        {link.activeLinks > 0 ? (
                          <form
                            autoComplete="off"
                            method="post"
                            action="/workspace/evidence-portal"
                          >
                            {hidden(link.recipient, "revoke")}
                            <button
                              type="submit"
                              className="btn-ghost btn-sm is-danger"
                            >
                              Turn off
                            </button>
                          </form>
                        ) : null}
                      </span>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Who at the client receives evidence requests: set here, any time, not during setup. */
function ContactsCard({
  model,
  contacts,
}: {
  model: Ready;
  contacts: EvidenceContacts | null;
}) {
  const project = model.selectedProject;
  if (project === null || contacts === null) {
    return null;
  }
  // The same people who run setup: owners, admins, and project managers.
  const editable = canManageProjects(model.organization.role);
  // Once the contact is set, the card is one line; the form opens on request.
  const settled = contacts.coordinatorEmail !== "" && contacts.waiting === 0;
  const body = (
    <div className="card-body">
      {contacts.waiting > 0 ? (
        <p className="form-hint contacts-waiting">
          {contacts.waiting} draft request
          {contacts.waiting === 1 ? " is" : "s are"} waiting for a coordinator.
          Once one is saved, they go to the coordinator. Nothing is sent until
          each request is approved.
        </p>
      ) : null}
      <SetupForm className="form">
        <input
          type="hidden"
          name="organization_id"
          value={model.organization.id}
        />
        <input type="hidden" name="project_id" value={project.id} />
        <input type="hidden" name="intent" value="evidence-contacts" />
        <input type="hidden" name="step" value="launch" />
        <label htmlFor="contacts-name">
          PBC coordinator
          <input
            id="contacts-name"
            name="client_coordinator_name"
            maxLength={200}
            defaultValue={contacts.coordinatorName}
            disabled={!editable}
            placeholder="Pat Lee"
          />
        </label>
        <label htmlFor="contacts-email">
          Coordinator email
          <input
            id="contacts-email"
            name="client_coordinator_email"
            type="email"
            defaultValue={contacts.coordinatorEmail}
            disabled={!editable}
            placeholder="pbc@client.example"
          />
        </label>
        <label htmlFor="contacts-domains" className="field-wide">
          Client email domains
          <input
            id="contacts-domains"
            name="client_domains"
            defaultValue={contacts.clientDomains.join(", ")}
            disabled={!editable}
            placeholder="client.example, client-it.example"
          />
        </label>
        {editable ? (
          <div className="form-actions">
            <button type="submit">Save contact</button>
          </div>
        ) : null}
      </SetupForm>
    </div>
  );
  return (
    <section className="card" aria-labelledby="contacts-title">
      <CardHeader
        title="Client PBC contact"
        titleId="contacts-title"
        description={
          settled
            ? [
                contacts.coordinatorName,
                contacts.coordinatorEmail,
                contacts.clientDomains.length > 0
                  ? `Domains: ${contacts.clientDomains.join(", ")}`
                  : "",
              ]
                .filter((part) => part !== "")
                .join(" · ")
            : "Receives the requests for controls without an owner, and any escalations. Requests only go to the client's email domains, when they are set."
        }
        aside={
          contacts.coordinatorEmail === "" ? (
            <span className="pill pill-dot tone-warning">Not set</span>
          ) : (
            <span className="pill pill-dot tone-success">Set</span>
          )
        }
      />
      {settled ? (
        <details className="card-disclosure">
          <summary>
            {editable ? "Change the contact" : "Show the contact"}
          </summary>
          {body}
        </details>
      ) : (
        body
      )}
    </section>
  );
}
