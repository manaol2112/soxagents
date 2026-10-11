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
import { type ConsoleState, EMPTY_CONSOLE } from "./console-model";
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
  DRAFT_KIND_LABELS,
  draftLabel,
  type RequestDraft,
  requestTitle,
} from "./draft-model";
import { EMPTY_ENGAGEMENT, type EngagementState } from "./engagement-model";
import {
  ControlsMain,
  DeficienciesMain,
  EngagementDashboard,
  PlanMain,
  TimelineMain,
} from "./engagement-view";
import {
  agentMonogram,
  formatBytes,
  formatDate,
  formatDuration,
  formatPeriod,
  initials,
  monogram,
} from "./format";
import {
  EMPTY_SETUP,
  type Onboarding,
  type SetupState,
} from "./onboarding-model";
import { SetupCallout, SetupMain } from "./onboarding-view";
import {
  type AgentDetail,
  type AgentNotice,
  type Organization,
  type Project,
  type ProjectDetail,
  type ProjectNotice,
  roleLabel,
  type SectionId,
  type ShellModel,
  statusChoices,
  type TaskDetail,
  type TaskNotice,
  taskStatusChoices,
  workspaceHref,
} from "./shell-model";
import { type IconName, UiIcon } from "./ui-icon";
import {
  type ApprovalItem,
  type AttentionItem,
  actionLabel,
  approvalRequestId,
  approvalState,
  attentionQueue,
  auditPhase,
  awaitingDecision,
  canDecide,
  canRequestEvidence,
  canRetryDelivery,
  type DecisionNotice,
  type DeliveryTone,
  deliveryLabel,
  EMPTY_WORKFLOW,
  EVIDENCE_STAGES,
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

const DELIVERY_TONES: Record<DeliveryTone, Tone> = {
  positive: "success",
  neutral: "info",
  risk: "danger",
};

export function WorkspaceView({
  model,
  directory = EMPTY_DIRECTORY,
  workflow = EMPTY_WORKFLOW,
  now = 0,
  creatingAgent = false,
  setup = EMPTY_SETUP,
  engagement = EMPTY_ENGAGEMENT,
  logFor = null,
  consoleState = EMPTY_CONSOLE,
}: {
  model: ShellModel;
  directory?: DirectoryQuery;
  workflow?: WorkflowState;
  now?: number;
  creatingAgent?: boolean;
  setup?: SetupState;
  engagement?: EngagementState;
  logFor?: string | null;
  consoleState?: ConsoleState;
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
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="nav-group">
                <p className="nav-label">{group.label}</p>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <a
                        href={workspaceHref(
                          item.id,
                          model.organization.id,
                          model.selectedProject?.id ?? null,
                        )}
                        title={item.detail}
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
                  ))}
                </ul>
              </div>
            ))}
          </nav>
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
          ) : (
            <p className="topbar-title">Sign in to open an engagement</p>
          )}
        </header>
        <main
          id="content"
          className="content"
          aria-busy={model.status === "loading"}
        >
          <WorkspaceMain
            model={model}
            directory={directory}
            workflow={workflow}
            now={now}
            creatingAgent={creatingAgent}
            setup={setup}
            engagement={engagement}
            logFor={logFor}
            consoleState={consoleState}
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
    NAV.find((item) => item.id === model.section)?.label ?? "Command center";
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
            <form method="post" action="/sign-out">
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
  return (
    <div className="crumb-select">
      <ChoiceForm
        label="Engagement"
        name="project"
        value={selectedProject?.id ?? first.id}
        options={projects.map((project) => ({
          value: project.id,
          label: project.name,
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
  setup,
  engagement,
  logFor,
  consoleState,
}: {
  model: ShellModel;
  directory: DirectoryQuery;
  workflow: WorkflowState;
  now: number;
  creatingAgent: boolean;
  setup: SetupState;
  engagement: EngagementState;
  logFor: string | null;
  consoleState: ConsoleState;
}) {
  if (model.status === "loading") {
    return (
      <section className="state-panel" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <h1>Loading workspace</h1>
        <p>Checking your session and assignments.</p>
      </section>
    );
  }
  if (model.status === "denied") {
    return (
      <section className="state-panel">
        <span className="brand-mark" aria-hidden="true">
          <UiIcon name="logo" size={16} />
        </span>
        <h1>Sign in required</h1>
        <p>
          This workspace is available to signed-in members of an organization.
        </p>
        {process.env.PREVIEW_LOGIN_ENABLED === "true" ? (
          <a className="btn" href={`${apiOrigin()}/auth/preview`}>
            Open the local preview
          </a>
        ) : (
          <a className="btn" href={`${apiOrigin()}/auth/login`}>
            Sign in
          </a>
        )}
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
  if (model.section === "projects") {
    return <ProjectsMain model={model} />;
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
    return <EvidenceMain model={model} workflow={workflow} now={now} />;
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
      href: sectionHref(model, "projects"),
    };
  }
  if (project.status === "DRAFT") {
    return {
      lede: "This engagement is still in scoping. Activate it when the team and the agents should start work.",
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
      lede: "Nothing is planned yet. Add the first control procedure, then assign it to a person or an agent.",
      action: "Plan the work",
      href: sectionHref(model, "tasks"),
    };
  }
  if (outstandingEvidence === 0) {
    return {
      lede: "Work is in motion and nothing needs you. Request the evidence each control needs to keep fieldwork moving.",
      action: "Request evidence",
      href: sectionHref(model, "evidence"),
    };
  }
  return {
    lede: "Work is in motion and nothing is waiting on you right now.",
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
        context="Command center"
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
          {onboarding !== null && !onboarding.started ? (
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
        <EmptyState
          icon="check"
          title="Nothing is waiting on you"
          detail="Items appear here as soon as they need a person. Agents keep working on everything else."
        />
      ) : (
        <ul className="queue">
          {queue.slice(0, 8).map((item) => {
            const meta = QUEUE_META[item.kind];
            const href =
              item.kind === "approval"
                ? sectionHref(model, "approvals")
                : item.kind === "reply" || item.kind === "triage"
                  ? `${sectionHref(model, "evidence")}#replies`
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
    ["Policy checks", "Unregistered or disallowed actions are refused."],
    ["Person approves", "Sensitive actions wait for an approver."],
    ["Runs once", "Only the exact approved request can run."],
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
          Manage the workforce <UiIcon name="arrow" size={14} />
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

function labelStatus(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: "Draft",
    ACTIVE: "Active",
    PAUSED: "Paused",
    ARCHIVED: "Archived",
    READY: "Ready",
    QUEUED: "Queued",
    RUNNING: "Running",
    WAITING: "Waiting",
    BLOCKED: "Blocked",
    REVIEW: "In review",
    SUCCEEDED: "Complete",
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
  slug: "That slug is already used in this organization.",
  status: "That status change is not available.",
  denied: "You cannot change this engagement.",
  unavailable: "The engagement could not be saved.",
};

const PORTFOLIO_ORDER: Record<string, number> = {
  ACTIVE: 0,
  DRAFT: 1,
  PAUSED: 2,
  ARCHIVED: 3,
};

function sortPortfolio(projects: readonly Project[]): Project[] {
  return [...projects].sort((left, right) => {
    const rank =
      (PORTFOLIO_ORDER[left.status] ?? 9) -
      (PORTFOLIO_ORDER[right.status] ?? 9);
    if (rank !== 0) {
      return rank;
    }
    return left.name.localeCompare(right.name);
  });
}

function portfolioSummary(projects: readonly Project[]): string {
  const counts = new Map<string, number>();
  for (const project of projects) {
    counts.set(project.status, (counts.get(project.status) ?? 0) + 1);
  }
  const parts = ["ACTIVE", "DRAFT", "PAUSED", "ARCHIVED"]
    .map((status) => {
      const count = counts.get(status) ?? 0;
      if (count === 0) {
        return null;
      }
      const label = labelStatus(status).toLowerCase();
      return `${count} ${label}`;
    })
    .filter((part): part is string => part !== null);
  return parts.length === 0 ? "No engagements" : parts.join(" · ");
}

function workSummary(
  progress: ReadonlyArray<{ status: string; count: number }>,
): string {
  const total = progress.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) {
    return "No tasks yet";
  }
  return `${total} task${total === 1 ? "" : "s"}`;
}

function recentEngagementActivity(
  activity: ProjectDetail["activity"],
): ProjectDetail["activity"] {
  const notable = activity.filter(
    (item) => !item.action.endsWith("agent_instance.staffed"),
  );
  return (notable.length > 0 ? notable : activity).slice(0, 6);
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
  inactive: "Activate the engagement before requesting evidence.",
  duplicate: "That request was already submitted.",
  denied: "Your role cannot request evidence.",
  unavailable: "The request could not be saved. Try again.",
  submitted:
    "Approval requested. An approver now confirms the exact message before anything is sent.",
  sent: "The mail service accepted the request. Delivery is not confirmed yet.",
  failed: "The request was not sent. Live email is switched off here.",
  uncertain:
    "The send outcome is unknown. Retrying checks the mailbox first, so the request cannot go out twice.",
  recipient: "That recipient is not allowed to receive evidence requests.",
  changed:
    "The request changed after it was approved. Request approval for the new version.",
  awaiting: "That request is not ready to send yet.",
  "reply-assigned":
    "Reply linked to the request. Review it, then update the request status yourself.",
  "reply-dismissed": "Mail dismissed. It stays in the record with your reason.",
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
    "That request can no longer be redrafted. Only a draft that has not been submitted for approval can be.",
  "reminder-failed":
    "The reminder was not sent. The schedule offers it again at the next check.",
  "reminder-closed":
    "That reminder is no longer open. The request may have been resolved.",
  stored:
    "File stored. The record is immutable, and a download checks the hash before it opens.",
  mismatch:
    "That file does not match the attachment. The size or the declared hash differs.",
  classified: ANALYSIS_NOTICES.classified,
  reading: ANALYSIS_NOTICES.reading,
  "analysis-changed": ANALYSIS_NOTICES["analysis-changed"],
  "signed-off": ANALYSIS_NOTICES["signed-off"],
  "review-changed": ANALYSIS_NOTICES["review-changed"],
};

function EvidenceMain({
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
    return <NoEngagement model={model} what="Evidence requests" />;
  }
  const evidence = workflow.evidence;
  const items = evidence ?? [];
  const outstanding = items.filter(isOutstandingEvidence).length;
  const late = items.filter((item) => isLateEvidence(item, now)).length;
  const received = items.filter(
    (item) => item.status === "RECEIVED" || item.status === "CLOSED",
  ).length;
  const live = workflow.mailboxMode === "live";
  return (
    <div className="page">
      <PageHeader
        context={project.name}
        title="Evidence"
        description="Ask control owners for what each control needs, then track every response to closure. Requests start as drafts and go out from an approved template only after an approver confirms the exact message."
        actions={
          <span className={`pill ${live ? "tone-warning" : ""}`}>
            <UiIcon name="mail" size={13} />
            {live
              ? "Live email is on"
              : "Live email is off · test mailbox only"}
          </span>
        }
      />
      {analysisInProgress(workflow.evidenceAnalyses) ? <AutoRefresh /> : null}
      {workflow.evidenceNotice !== null ? (
        <Banner>
          {workflow.evidenceNotice === "sent" && workflow.mailboxMode !== "live"
            ? "Request recorded in the test mailbox with its reference. No email left this workspace."
            : EVIDENCE_NOTICES[workflow.evidenceNotice]}
        </Banner>
      ) : null}
      <section className="kpis" aria-label="Evidence metrics">
        <Metric
          icon="inbox"
          label="Outstanding"
          value={evidence === null ? null : outstanding}
          detail="Still open"
        />
        <Metric
          icon="risk"
          label="Overdue"
          value={evidence === null ? null : late}
          detail={late === 0 ? "On schedule" : "Needs follow-up"}
          tone={late > 0 ? "risk" : "positive"}
        />
        <Metric
          icon="check"
          label="Received"
          value={evidence === null ? null : received}
          detail="Ready to test"
        />
        <Metric
          icon="grid"
          label="All requests"
          value={evidence === null ? null : items.length}
          detail="This engagement"
        />
      </section>
      <div className="layout-rail">
        <section className="card" aria-labelledby="evidence-board">
          <CardHeader
            title="Request tracker"
            titleId="evidence-board"
            description="Every request, by stage"
            aside={
              evidence === null ? undefined : (
                <span className="num">
                  {items.length} request{items.length === 1 ? "" : "s"}
                </span>
              )
            }
          />
          {evidence === null ? (
            <div className="card-body">
              <Banner tone="warning">
                Evidence requests could not be loaded. Refresh to try again.
              </Banner>
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="No evidence requested yet"
              detail="Create the first request for a control. It starts as a draft, and nothing is sent."
            />
          ) : (
            <>
              <ul className="stage-strip" aria-label="Requests by stage">
                {EVIDENCE_STAGES.map((stage) => (
                  <li key={stage.id}>
                    <span>{stage.label}</span>
                    <strong className="num">
                      {
                        items.filter((item) =>
                          stage.statuses.includes(item.status),
                        ).length
                      }
                    </strong>
                  </li>
                ))}
              </ul>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Request</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="cell-end">
                        Next step
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {EVIDENCE_STAGES.flatMap((stage) =>
                      items
                        .filter((item) => stage.statuses.includes(item.status))
                        .map((item) => (
                          <EvidenceRow
                            key={item.id}
                            model={model}
                            workflow={workflow}
                            item={item}
                            stage={stage.label}
                            now={now}
                          />
                        )),
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
        {!canRequestEvidence(model.organization.role) ? (
          <section className="card">
            <CardHeader title="Evidence access" />
            <div className="card-body">
              <p>
                Your role can follow evidence requests. It cannot create them.
              </p>
            </div>
          </section>
        ) : project.status !== "ACTIVE" ? (
          <section className="card">
            <CardHeader title="Requests are paused" />
            <div className="card-body">
              <p>
                Activate the engagement to request evidence. Existing requests
                stay visible.
              </p>
            </div>
          </section>
        ) : (
          <EvidenceForm model={model} workflow={workflow} />
        )}
      </div>
      <RepliesCard model={model} workflow={workflow} />
    </div>
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
        description="Mail received in the shared mailbox. A reply never changes a request's status on its own."
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
          {item.contentRedacted ? " Secret-looking values were redacted." : ""}
          {item.bodyTruncated ? " The message was shortened." : ""}
        </p>
        <pre className="untrusted-text">
          {item.bodyText === "" ? "(empty message)" : item.bodyText}
        </pre>
      </details>
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
                  canAct ? (
                    <form
                      method="post"
                      action="/workspace/evidence-files"
                      encType="multipart/form-data"
                      className="file-store"
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
                        name="attachment_id"
                        value={file.id}
                      />
                      <input
                        type="file"
                        name="content"
                        required
                        aria-label={`File for ${file.fileName}`}
                      />
                      <button type="submit" className="btn-secondary btn-sm">
                        Store file
                      </button>
                    </form>
                  ) : (
                    <span className="pill">Not stored</span>
                  )
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
            <form method="post" action="/workspace/inbound" className="toolbar">
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
          <form method="post" action="/workspace/inbound" className="toolbar">
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

function EvidenceRow({
  model,
  workflow,
  item,
  stage,
  now,
}: {
  model: Ready;
  workflow: WorkflowState;
  item: EvidenceRequest;
  stage: string;
  now: number;
}) {
  const late = isLateEvidence(item, now);
  const outbound = workflow.outbound ?? [];
  const approvals = workflow.approvals ?? [];
  const record = latestOutbound(outbound, item.id);
  const delivery =
    record === null ? null : deliveryLabel(record, workflow.mailboxMode);
  const canAct =
    canRequestEvidence(model.organization.role) &&
    model.selectedProject?.status === "ACTIVE" &&
    workflow.outbound !== null &&
    workflow.approvals !== null;
  const ready = canAct ? readyToSend(approvals, outbound, item.id, now) : null;
  const waiting = awaitingDecision(approvals, item.id, now);
  const sendable =
    item.status === "DRAFT" || item.status === "APPROVAL_PENDING";
  const followUps = workflow.followUps ?? [];
  const reminder = reminderStep({
    followUps,
    approvals,
    outbound,
    requestId: item.id,
    now,
  });
  const reminded = remindersSent(followUps, item.id);
  const draft = workflow.drafts?.get(item.id);
  const drafted = draftLabel(draft);
  return (
    <tr>
      <td>
        <div className="cell-request">
          <span className="mono item-ref">{item.controlRef}</span>
          <strong>{requestTitle(item.description, draft)}</strong>
          <small>
            {item.recipient}
            {item.attachmentCount > 0
              ? ` · ${item.attachmentCount} file${item.attachmentCount === 1 ? "" : "s"}`
              : ""}
          </small>
          {drafted !== null ? (
            <span className={`pill pill-dot tone-${drafted.tone} draft-pill`}>
              {drafted.label}
            </span>
          ) : null}
          <RequestDetails
            model={model}
            item={item}
            draft={draft}
            canRedraft={canAct && item.status === "DRAFT"}
          />
        </div>
      </td>
      <td>
        <span className="cell-stack">
          <span className="pill">{stage}</span>
          {repliesToReview(workflow.inbound ?? []).some(
            (reply) => reply.requestId === item.id,
          ) ? (
            <a className="pill pill-dot tone-info" href="#replies">
              Reply to review
            </a>
          ) : null}
          <time
            dateTime={item.dueAt}
            className={late ? "pill pill-dot tone-danger" : "num cell-sub"}
          >
            {late ? "Overdue · " : "Due "}
            {formatDate(item.dueAt)}
          </time>
          {record !== null && delivery !== null ? (
            <span
              className={`pill pill-dot ${toneClass(DELIVERY_TONES[delivery.tone])}`}
              title={`${record.reference} · delivery ${record.deliveryConfirmed ? "confirmed" : "not confirmed"}`}
            >
              {delivery.label}
            </span>
          ) : null}
          {reminder !== null ? (
            <span
              className={`pill pill-dot ${reminder.kind === "prepare" ? "tone-warning" : "tone-info"}`}
              title={`Reminder ${reminder.followUp.sequence} fell due ${formatDate(reminder.followUp.dueAt)}`}
            >
              {REMINDER_LABELS[reminder.kind](reminder.followUp.sequence)}
            </span>
          ) : reminded > 0 ? (
            <span className="pill">
              {reminded} reminder{reminded === 1 ? "" : "s"} sent
            </span>
          ) : null}
        </span>
      </td>
      <td className="cell-end">
        <EvidenceNextStep
          model={model}
          item={item}
          canAct={canAct}
          record={record}
          ready={ready}
          waiting={waiting}
          sendable={sendable}
          reminder={reminder}
        />
      </td>
    </tr>
  );
}

function RequestDetails({
  model,
  item,
  draft,
  canRedraft,
}: {
  model: Ready;
  item: EvidenceRequest;
  draft: RequestDraft | undefined;
  canRedraft: boolean;
}) {
  const structured =
    draft !== undefined && draft.status === "DRAFTED" && draft.items.length > 0;
  return (
    <details className="request-details">
      <summary>Request details</summary>
      {structured ? (
        <div className="request-draft">
          <ol>
            {draft.items.map((entry) => (
              <li key={`${entry.kind}-${entry.title}`}>
                <span className="pill">
                  {DRAFT_KIND_LABELS[entry.kind] ?? entry.kind}
                </span>
                <strong>{entry.title}</strong>
                <p>{entry.detail}</p>
                <dl>
                  {entry.period !== "" ? (
                    <div>
                      <dt>Period</dt>
                      <dd>{entry.period}</dd>
                    </div>
                  ) : null}
                  {entry.fields.length > 0 ? (
                    <div>
                      <dt>Include</dt>
                      <dd>{entry.fields.join("; ")}</dd>
                    </div>
                  ) : null}
                  {entry.format !== "" ? (
                    <div>
                      <dt>Format</dt>
                      <dd>{entry.format}</dd>
                    </div>
                  ) : null}
                  {entry.parameters !== "" ? (
                    <div>
                      <dt>Show</dt>
                      <dd>{entry.parameters}</dd>
                    </div>
                  ) : null}
                  {entry.completeness !== "" ? (
                    <div>
                      <dt>Completeness</dt>
                      <dd>{entry.completeness}</dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            ))}
          </ol>
          {draft.questions.length > 0 ? (
            <div>
              <h4>Questions for the owner</h4>
              <ul>
                {draft.questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {draft.assumptions.length > 0 || draft.note !== "" ? (
            <div className="request-notes">
              <h4>Coordinator notes · not emailed</h4>
              <ul>
                {draft.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
                {draft.note !== "" ? <li>{draft.note}</li> : null}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="request-text">{item.description}</p>
      )}
      {canRedraft ? (
        <form
          method="post"
          action="/workspace/evidence/redraft"
          className="request-redraft"
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
          <input type="hidden" name="request_id" value={item.id} />
          <button type="submit" className="btn-secondary btn-sm">
            <UiIcon name="sparkles" size={14} /> Redraft
          </button>
          <span className="form-hint">
            The evidence coordinator drafts it again from the control. Nothing
            is sent.
          </span>
        </form>
      ) : null}
    </details>
  );
}

function EvidenceNextStep({
  model,
  item,
  canAct,
  record,
  ready,
  waiting,
  sendable,
  reminder,
}: {
  model: Ready;
  item: EvidenceRequest;
  canAct: boolean;
  record: ReturnType<typeof latestOutbound>;
  ready: ReturnType<typeof readyToSend>;
  waiting: boolean;
  sendable: boolean;
  reminder: ReminderStep | null;
}) {
  return (
    <>
      {!canAct ? null : record !== null && canRetryDelivery(record) ? (
        <OutboundAction
          model={model}
          requestId={item.id}
          intent="send"
          approvalId={record.approvalId}
          label="Check and retry"
          detail="Checks the mailbox before any resend"
        />
      ) : !sendable ? (
        reminder === null ? null : (
          <ReminderNextStep model={model} item={item} step={reminder} />
        )
      ) : ready !== null ? (
        <OutboundAction
          model={model}
          requestId={item.id}
          intent="send"
          approvalId={ready.id}
          label="Send request"
          detail="Approved · uses the approved template"
        />
      ) : waiting ? (
        <span className="cell-note">
          <UiIcon name="clock" size={13} /> Waiting for an approver
        </span>
      ) : (
        <OutboundAction
          model={model}
          requestId={item.id}
          version={item.version}
          intent="submit"
          label={item.status === "DRAFT" ? "Request approval" : "Ask again"}
          detail="An approver checks the exact message first"
        />
      )}
    </>
  );
}

const REMINDER_LABELS: Record<
  ReminderStep["kind"],
  (sequence: number) => string
> = {
  prepare: (sequence) => `Reminder ${sequence} due`,
  awaiting: (sequence) => `Reminder ${sequence} · awaiting approval`,
  send: (sequence) => `Reminder ${sequence} · approved`,
  retry: (sequence) => `Reminder ${sequence} · outcome unknown`,
  settling: (sequence) => `Reminder ${sequence} · closing`,
};

function ReminderNextStep({
  model,
  item,
  step,
}: {
  model: Ready;
  item: EvidenceRequest;
  step: ReminderStep;
}) {
  const sequence = step.followUp.sequence;
  if (step.kind === "send" || step.kind === "retry") {
    return (
      <ReminderAction
        model={model}
        requestId={item.id}
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
          requestId={item.id}
          followUpId={step.followUp.id}
          intent="submit"
          label={`Prepare reminder ${sequence}`}
          detail="An approver checks the exact message first"
        />
      ) : (
        <span className="cell-note">
          <UiIcon name="clock" size={13} /> Waiting for an approver
        </span>
      )}
      <ReminderAction
        model={model}
        requestId={item.id}
        followUpId={step.followUp.id}
        intent="skip"
        version={step.followUp.version}
        label="Skip this one"
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
  intent: "submit" | "send" | "skip";
  approvalId?: string;
  version?: number;
  label: string;
  detail?: string;
  quiet?: boolean;
}) {
  return (
    <form method="post" action="/workspace/follow-ups" className="row-action">
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
    <form method="post" action="/workspace/outbound" className="row-action">
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

function EvidenceForm({
  model,
  workflow,
}: {
  model: Ready;
  workflow: WorkflowState;
}) {
  return (
    <section className="card" aria-labelledby="evidence-form">
      <CardHeader
        title="Request evidence"
        titleId="evidence-form"
        description="Saved as a draft for review. Nothing is emailed."
      />
      <div className="card-body">
        <form method="post" action="/workspace/evidence" className="form">
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
            name="operation_key"
            value={workflow.operationKey}
          />
          <label htmlFor="evidence-control">
            Control
            <input
              id="evidence-control"
              name="control_ref"
              required
              maxLength={200}
              pattern="[A-Za-z0-9][A-Za-z0-9._:/\-]*"
              placeholder="ITGC-AC-01"
            />
          </label>
          <label htmlFor="evidence-due">
            Due date
            <input id="evidence-due" name="due_date" type="date" required />
          </label>
          <label htmlFor="evidence-recipient" className="field-wide">
            Control owner email
            <input
              id="evidence-recipient"
              name="recipient"
              type="email"
              required
              placeholder="owner@client.example"
            />
          </label>
          <label htmlFor="evidence-description">
            What is needed
            <textarea
              id="evidence-description"
              name="evidence_description"
              required
              rows={4}
              maxLength={4000}
              placeholder="User access listing for the in-scope application, as of the period end."
            />
          </label>
          <label htmlFor="evidence-follow-up">
            Follow up after (days)
            <input
              id="evidence-follow-up"
              name="follow_up_after_days"
              type="number"
              min={1}
              max={30}
              defaultValue={3}
              required
            />
          </label>
          <div className="form-actions">
            <button type="submit">Save draft request</button>
          </div>
        </form>
      </div>
    </section>
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
        description="Agents and people ask before a sensitive action. Each approval covers only the exact request shown, needs a reason, and expires after 24 hours."
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
          description="Review the exact parameters before you decide."
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

function ProjectsMain({ model }: { model: Ready }) {
  const portfolio = sortPortfolio(model.projects);
  return (
    <div className="page">
      <PageHeader
        context={model.organization.name}
        title="Engagements"
        description="The audits this firm is delivering. Open one to review its scope, owner, and fieldwork window."
        actions={
          model.canManageProjects ? (
            <a className="btn" href="#new-engagement">
              <UiIcon name="plus" size={15} />
              New engagement
            </a>
          ) : undefined
        }
      />
      {model.notice !== null ? <Banner>{NOTICES[model.notice]}</Banner> : null}
      <section className="card" aria-labelledby="portfolio-title">
        <CardHeader
          title="Portfolio"
          titleId="portfolio-title"
          description={
            model.projects.length === 0
              ? `No audits in ${model.organization.name} yet.`
              : `${model.projects.length} engagement${
                  model.projects.length === 1 ? "" : "s"
                } in this firm.`
          }
          aside={
            model.projects.length === 0 ? undefined : (
              <span className="num">{portfolioSummary(model.projects)}</span>
            )
          }
        />
        {model.projects.length === 0 ? (
          <EmptyState
            icon="briefcase"
            title="No engagements yet"
            detail="Create the first audit for this firm. Scope, work, evidence, and decisions will live on it."
            action={
              model.canManageProjects ? (
                <a className="btn" href="#new-engagement">
                  New engagement
                  <UiIcon name="arrow" size={15} />
                </a>
              ) : undefined
            }
          />
        ) : (
          <ul className="engagement-list">
            {portfolio.map((project) => {
              const selected = model.selectedProject?.id === project.id;
              const detail =
                selected && model.projectDetail?.id === project.id
                  ? model.projectDetail
                  : null;
              return (
                <li key={project.id}>
                  <a
                    className="engagement-item"
                    href={workspaceHref(
                      "projects",
                      model.organization.id,
                      project.id,
                    )}
                    aria-current={selected ? "true" : undefined}
                  >
                    <span className="engagement-mark" aria-hidden="true">
                      {monogram(project.name)}
                    </span>
                    <span className="engagement-copy">
                      <strong>{project.name}</strong>
                      {detail === null ? null : (
                        <span className="engagement-meta">
                          {detail.scope === "" ? null : (
                            <span className="engagement-scope">
                              {detail.scope}
                            </span>
                          )}
                          <span>{detail.ownerName}</span>
                          <span className="num">
                            {formatPeriod(detail.startsOn, detail.endsOn)}
                          </span>
                        </span>
                      )}
                    </span>
                    <StatusPill status={project.status} />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {model.projectDetail !== null ? (
        <div className="layout-rail">
          <EngagementBrief model={model} detail={model.projectDetail} />
          {model.canManageProjects ? (
            <EngagementSettings model={model} detail={model.projectDetail} />
          ) : (
            <section className="card">
              <CardHeader title="Engagement access" />
              <div className="card-body">
                <p>
                  Your role can review engagements. It cannot create or change
                  them.
                </p>
              </div>
            </section>
          )}
        </div>
      ) : model.canManageProjects ? null : (
        <section className="card">
          <CardHeader title="Engagement access" />
          <div className="card-body">
            <p>
              Your role can review engagements. It cannot create or change them.
            </p>
          </div>
        </section>
      )}
      {model.canManageProjects ? <CreateProject model={model} /> : null}
    </div>
  );
}

function CreateProject({ model }: { model: Ready }) {
  return (
    <section
      className="card"
      id="new-engagement"
      aria-labelledby="new-project-title"
    >
      <CardHeader
        title="Open a new engagement"
        titleId="new-project-title"
        description="Starts in draft so the team can finish scoping before work begins. Activate it when agents and people should start."
      />
      <div className="card-body">
        <form method="post" action="/workspace/projects" className="form">
          <input type="hidden" name="intent" value="create" />
          <input
            type="hidden"
            name="organization_id"
            value={model.organization.id}
          />
          <label htmlFor="project-name">
            Name
            <input
              id="project-name"
              name="name"
              required
              maxLength={200}
              placeholder="FY26 ITGC"
            />
            <span className="form-hint">Shown to the team and on reports.</span>
          </label>
          <label htmlFor="project-slug">
            Slug
            <input
              id="project-slug"
              name="slug"
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              maxLength={80}
              placeholder="fy26-itgc"
            />
            <span className="form-hint">
              Lowercase letters, numbers, and hyphens.
            </span>
          </label>
          <label htmlFor="project-scope">
            Scope
            <textarea
              id="project-scope"
              name="scope"
              rows={3}
              maxLength={4000}
              placeholder="Systems, period, and what this audit covers."
            />
          </label>
          <label htmlFor="project-owner">
            Owner
            <select id="project-owner" name="owner_user_id" required>
              {model.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="project-status">
            Status
            <select id="project-status" name="status" defaultValue="DRAFT">
              <option value="DRAFT">Draft</option>
              <option value="ACTIVE">Active</option>
            </select>
          </label>
          <label htmlFor="project-starts">
            Starts
            <input id="project-starts" name="starts_on" type="date" />
          </label>
          <label htmlFor="project-ends">
            Ends
            <input id="project-ends" name="ends_on" type="date" />
          </label>
          <div className="form-actions">
            <button type="submit">Create engagement</button>
          </div>
        </form>
      </div>
    </section>
  );
}

function EngagementBrief({
  model,
  detail,
}: {
  model: Ready;
  detail: ProjectDetail;
}) {
  const recent = recentEngagementActivity(detail.activity);
  return (
    <section className="card" aria-labelledby="project-detail-title">
      <div className="brief-hero">
        <span className="engagement-mark engagement-mark-lg" aria-hidden="true">
          {monogram(detail.name)}
        </span>
        <div className="brief-heading">
          <div className="brief-title">
            <h2 id="project-detail-title">{detail.name}</h2>
            <StatusPill status={detail.status} />
          </div>
          {detail.scope === "" ? (
            <p className="brief-scope muted">Scope has not been written yet.</p>
          ) : (
            <p className="brief-scope">{detail.scope}</p>
          )}
        </div>
      </div>
      <dl className="brief-meta">
        <div>
          <dt>Owner</dt>
          <dd>{detail.ownerName}</dd>
        </div>
        <div>
          <dt>Period</dt>
          <dd className="num">
            {formatPeriod(detail.startsOn, detail.endsOn)}
          </dd>
        </div>
        <div>
          <dt>Work</dt>
          <dd>
            {workSummary(detail.progress)}
            {detail.progress.length > 0 ? (
              <ul className="chips">
                {detail.progress.map((item) => (
                  <li
                    key={item.status}
                    className={`pill ${toneClass(statusTone(item.status))}`}
                  >
                    {labelStatus(item.status)}
                    <span className="num">{item.count}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </dd>
        </div>
      </dl>
      <div className="brief-links">
        <a
          className="text-link"
          href={workspaceHref("overview", model.organization.id, detail.id)}
        >
          Command center <UiIcon name="arrow" size={14} />
        </a>
        <a
          className="text-link"
          href={workspaceHref("tasks", model.organization.id, detail.id)}
        >
          Open work <UiIcon name="arrow" size={14} />
        </a>
      </div>
      <div className="brief-activity">
        <h3 className="card-subhead">Recent activity</h3>
        {recent.length === 0 ? (
          <p className="muted">No activity yet.</p>
        ) : (
          <ActivityRows activity={recent} />
        )}
      </div>
    </section>
  );
}

function EngagementSettings({
  model,
  detail,
}: {
  model: Ready;
  detail: ProjectDetail;
}) {
  const choices = statusChoices(detail.status);
  return (
    <section className="card" aria-labelledby="engagement-settings-title">
      <CardHeader
        title="Settings"
        titleId="engagement-settings-title"
        description="Name, owner, dates, and status for this audit."
      />
      <div className="card-body">
        <form
          method="post"
          action="/workspace/projects"
          className="form form-stack"
        >
          <input
            type="hidden"
            name="organization_id"
            value={model.organization.id}
          />
          <input type="hidden" name="project_id" value={detail.id} />
          <input type="hidden" name="version" value={detail.version} />
          <label htmlFor="edit-name">
            Name
            <input
              id="edit-name"
              name="name"
              required
              maxLength={200}
              defaultValue={detail.name}
            />
          </label>
          <label htmlFor="edit-slug">
            Slug
            <input
              id="edit-slug"
              name="slug"
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              maxLength={80}
              defaultValue={detail.slug}
            />
          </label>
          <label htmlFor="edit-scope">
            Scope
            <textarea
              id="edit-scope"
              name="scope"
              rows={3}
              maxLength={4000}
              defaultValue={detail.scope}
            />
          </label>
          <label htmlFor="edit-owner">
            Owner
            <select
              id="edit-owner"
              name="owner_user_id"
              required
              defaultValue={detail.ownerUserId}
            >
              {model.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="edit-status">
            Status
            <select id="edit-status" name="status" defaultValue={detail.status}>
              {choices.map((status) => (
                <option key={status} value={status}>
                  {labelStatus(status)}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="edit-starts">
            Starts
            <input
              id="edit-starts"
              name="starts_on"
              type="date"
              defaultValue={detail.startsOn ?? ""}
            />
          </label>
          <label htmlFor="edit-ends">
            Ends
            <input
              id="edit-ends"
              name="ends_on"
              type="date"
              defaultValue={detail.endsOn ?? ""}
            />
          </label>
          <div className="form-actions">
            <button type="submit" name="intent" value="update">
              Save engagement
            </button>
            {detail.status === "DRAFT" ? (
              <button
                type="submit"
                name="intent"
                value="start"
                className="btn-secondary"
              >
                Activate
              </button>
            ) : null}
            {detail.status === "ACTIVE" ? (
              <button
                type="submit"
                name="intent"
                value="pause"
                className="btn-secondary"
              >
                Pause
              </button>
            ) : null}
            {detail.status === "PAUSED" ? (
              <button
                type="submit"
                name="intent"
                value="resume"
                className="btn-secondary"
              >
                Resume
              </button>
            ) : null}
            {detail.status !== "ARCHIVED" ? (
              <button
                type="submit"
                name="intent"
                value="archive"
                className="btn-danger"
              >
                Archive
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </section>
  );
}

const AGENT_NOTICES: Record<AgentNotice, string> = {
  saved: "Agent definition saved.",
  invalid: "Check the agent fields and try again.",
  conflict: "This agent definition changed. Refresh it and try again.",
  key: "That key is already used in this organization.",
  status: "That status change is not available.",
  denied: "You cannot change this agent definition.",
  unavailable: "The agent definition could not be saved.",
  secret: "A definition cannot store a secret. Use a model name instead.",
  locked:
    "Standard agents are managed by the platform. Create a custom agent to change how one works.",
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
          <form method="get" action="/" className="toolbar">
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
          detail={`No tasks in ${model.selectedProject?.name ?? "this engagement"}. Add the first control procedure to get started.`}
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
        description="Every engagement comes staffed with the standard SOX workforce. Admins can switch a standard agent off for the firm, or add a custom agent for work the standard roster does not cover."
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
          Some standard agents are not in this firm yet. They are added on the
          next deploy.
        </Banner>
      ) : null}
      <section className="card" aria-labelledby="standard-agents-title">
        <CardHeader
          title="Standard workforce"
          titleId="standard-agents-title"
          description="Part of every engagement and managed by the platform. Sensitive actions still wait for a person to approve them."
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
                      {row.modelTier === null ? "" : ` · ${row.modelTier} tier`}
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
              description="The only registered actions this agent may request. Listing an action never skips policy checks or a required approval."
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
                description="Changes create a new revision. Work already running finishes on the revision it started with."
              />
              <div className="card-body">
                <form method="post" action="/workspace/agents" className="form">
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
                description="Every result is checked against these schemas before anything uses it."
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
                  Managed by the platform. It joins every engagement
                  automatically and updates with each release.{" "}
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
                  <dd>
                    {detail.modelConfigRef === "reasoning" ||
                    detail.modelConfigRef === "standard"
                      ? `${detail.modelConfigRef} tier`
                      : detail.modelConfigRef}
                  </dd>
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
    <form method="post" action="/workspace/agents">
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
            <form method="post" action="/workspace/agents" className="form">
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
                <strong>Grant only what it needs.</strong> Allowed actions must
                be registered, and sensitive ones still need approval.
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
          id={`${idPrefix}-tools`}
          name="allowed_tool_ids"
          defaultValue={detail?.allowedToolIds.join(", ") ?? ""}
          placeholder="file.read, workpaper.update"
        />
      </label>
      <label htmlFor={`${idPrefix}-iterations`}>
        Maximum iterations
        <input
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
        description="Items move from draft to ready, then into execution and review. Blocked work needs a written blocker. Cancelled work stays closed until someone reactivates it."
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
        <form method="post" action="/workspace/tasks" className="form">
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
            <a className="text-link" href={closeHref}>
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
          <form method="post" action="/workspace/tasks" className="form">
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
          id="edit-task-blocker"
          name="blocker"
          maxLength={2000}
          defaultValue={detail.blocker}
        />
      </label>
      <label htmlFor="edit-task-escalation" className="field-wide">
        Escalation
        <input
          id="edit-task-escalation"
          name="escalation"
          maxLength={2000}
          defaultValue={detail.escalation}
        />
      </label>
      <label htmlFor="edit-task-reason" className="field-wide">
        Cancellation reason
        <input
          id="edit-task-reason"
          name="cancellation_reason"
          maxLength={2000}
          defaultValue={detail.cancellationReason}
        />
      </label>
      <label htmlFor="edit-task-retries">
        Maximum retries
        <input
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

function apiOrigin(): string {
  const configured = process.env.API_BASE_URL?.trim() ?? "";
  if (configured !== "") {
    return configured.replace(/\/$/, "");
  }
  return "http://127.0.0.1:8000";
}
