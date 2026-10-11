import { ChoiceForm } from "./choice-form";
import {
  type DirectoryQuery,
  directoryHref,
  EMPTY_DIRECTORY,
  filterAgents,
  filterTasks,
  PRIORITIES,
  paginate,
  TASK_STATUSES,
  upcomingDeadlines,
} from "./directory";
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
  deliveryLabel,
  EMPTY_WORKFLOW,
  EVIDENCE_STAGES,
  type EvidenceNotice,
  type EvidenceRequest,
  isLateEvidence,
  isOutstandingEvidence,
  latestOutbound,
  pendingApprovals,
  readyToSend,
  relativeTime,
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
        id: "overview",
        label: "Command center",
        detail: "What needs you now",
        icon: "grid",
      },
      {
        id: "tasks",
        label: "Work",
        detail: "Plan, run, and review",
        icon: "activity",
      },
      {
        id: "evidence",
        label: "Evidence",
        detail: "Requests and responses",
        icon: "inbox",
      },
      {
        id: "approvals",
        label: "Approvals",
        detail: "Human decisions",
        icon: "shield",
      },
    ],
  },
  {
    label: "Setup",
    items: [
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

export function WorkspaceView({
  model,
  directory = EMPTY_DIRECTORY,
  workflow = EMPTY_WORKFLOW,
  now = 0,
}: {
  model: ShellModel;
  directory?: DirectoryQuery;
  workflow?: WorkflowState;
  now?: number;
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
            AI
          </span>
          <span>
            <strong>AI Workforce</strong>
            <small>SOX Agentic OS</small>
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
                        aria-current={
                          model.section === item.id ? "page" : undefined
                        }
                      >
                        <UiIcon name={item.icon} />
                        <span className="nav-copy">
                          <strong>{item.label}</strong>
                          <small>{item.detail}</small>
                        </span>
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
        <div className="sidebar-status">
          <span className="status-orb">
            <UiIcon name="shield" size={16} />
          </span>
          <span>
            <strong>
              {waiting === null
                ? "Agents propose, people decide"
                : waiting === 0
                  ? "No decisions waiting"
                  : `${waiting} decision${waiting === 1 ? "" : "s"} waiting`}
            </strong>
            <small>Sensitive actions need approval</small>
          </span>
        </div>
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
          />
        </main>
      </div>
    </div>
  );
}

function WorkspaceControls({
  model,
}: {
  model: Extract<ShellModel, { status: "ready" }>;
}) {
  const sectionLabel =
    NAV.find((item) => item.id === model.section)?.label ?? "Command center";
  return (
    <>
      <div className="topbar-heading">
        <p className="breadcrumb">
          {model.organization.name} <span>/</span>{" "}
          {model.selectedProject?.name ?? "Portfolio"}
        </p>
        <p className="topbar-title">{sectionLabel}</p>
      </div>
      <div className="selectors">
        {model.organizations.length > 1 ? (
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
        ) : (
          <p className="org-name">
            <span className="field-label">Firm</span>
            {model.organization.name}
          </p>
        )}
        <ProjectSelector
          organization={model.organization}
          projects={model.projects}
          selectedProject={model.selectedProject}
          section={model.section}
        />
      </div>
      <div className="account">
        <details className="menu">
          <summary className="icon-button" aria-label="Notifications">
            <UiIcon name="bell" />
          </summary>
          <div id="notifications" className="menu-panel">
            {model.notifications === "empty" ? (
              <p>No notifications.</p>
            ) : (
              <p role="alert">Notifications could not be loaded.</p>
            )}
          </div>
        </details>
        <details className="menu">
          <summary className="profile-trigger">
            <span className="avatar">
              {model.email.slice(0, 1).toUpperCase()}
            </span>
            <span className="profile-copy">
              <strong>{model.email.split("@")[0]}</strong>
              <small>{roleLabel(model.organization.role)}</small>
            </span>
            <UiIcon name="chevron" size={14} />
          </summary>
          <div className="menu-panel">
            <p>{roleLabel(model.organization.role)}</p>
            <form method="post" action="/sign-out">
              <button type="submit">Sign out</button>
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
    return (
      <p className="org-name">
        <span className="field-label">Project</span>
        No projects
      </p>
    );
  }
  return (
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
  );
}

function WorkspaceMain({
  model,
  directory,
  workflow,
  now,
}: {
  model: ShellModel;
  directory: DirectoryQuery;
  workflow: WorkflowState;
  now: number;
}) {
  if (model.status === "loading") {
    return (
      <section className="panel" aria-live="polite">
        <h1>Loading workspace</h1>
        <p>Checking your session and assignments.</p>
      </section>
    );
  }
  if (model.status === "denied") {
    return (
      <section className="panel">
        <h1>Sign in required</h1>
        <p>
          This workspace is available to signed-in members of an organization.
        </p>
        <p>
          {process.env.PREVIEW_LOGIN_ENABLED === "true" ? (
            <a href={`${apiOrigin()}/auth/preview`}>Open the local preview</a>
          ) : (
            <a href={`${apiOrigin()}/auth/login`}>Sign in</a>
          )}
        </p>
      </section>
    );
  }
  if (model.status === "error") {
    return (
      <section className="panel">
        <h1>Workspace unavailable</h1>
        <p>The workspace could not be loaded. Wait a moment and try again.</p>
        <p>
          <a href="/">Try again</a>
        </p>
      </section>
    );
  }
  if (model.status === "empty") {
    return (
      <section className="panel">
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
    return <AgentsMain model={model} directory={directory} />;
  }
  if (model.section === "tasks") {
    return <TasksMain model={model} directory={directory} />;
  }
  if (model.section === "evidence") {
    return <EvidenceMain model={model} workflow={workflow} now={now} />;
  }
  if (model.section === "approvals") {
    return <ApprovalsMain model={model} workflow={workflow} now={now} />;
  }
  return <CommandCenter model={model} workflow={workflow} now={now} />;
}

function sectionHref(
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
}: {
  model: Ready;
  workflow: WorkflowState;
  now: number;
}) {
  const project = model.selectedProject;
  const evidence = workflow.evidence ?? [];
  const approvals = workflow.approvals ?? [];
  const queue = attentionQueue({
    tasks: model.tasks,
    evidence,
    approvals,
    now,
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
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Command center</p>
          <h1>{project?.name ?? model.organization.name}</h1>
          <p>{step.lede}</p>
        </div>
        <div className="heading-actions">
          {project !== null ? (
            <span
              className={`engagement-state state-${project.status.toLowerCase()}`}
            >
              <span />
              {labelStatus(project.status)}
            </span>
          ) : null}
          <a className="primary-action" href={step.href}>
            {step.action}
            <UiIcon name="arrow" size={16} />
          </a>
        </div>
      </header>
      {project === null ? null : (
        <>
          <section className="metric-grid" aria-label="Engagement metrics">
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
          <div className="command-grid">
            <DecisionQueue model={model} queue={queue} workflow={workflow} />
            <ControlLoop model={model} workflow={workflow} waiting={waiting} />
          </div>
          <Lifecycle model={model} phase={auditPhase(model.tasks, evidence)} />
          <div className="dashboard-grid">
            <UpcomingCard model={model} />
            <ActivityCard model={model} />
          </div>
        </>
      )}
    </div>
  );
}

const QUEUE_META: Record<
  "approval" | "blocked" | "evidence" | "review",
  { label: string; icon: IconName; action: string }
> = {
  approval: { label: "Approval", icon: "shield", action: "Decide" },
  blocked: { label: "Blocked", icon: "risk", action: "Unblock" },
  evidence: { label: "Evidence", icon: "inbox", action: "Follow up" },
  review: { label: "Review", icon: "check", action: "Review" },
};

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
    <section
      id="decision-queue"
      className="dashboard-card queue-card"
      aria-labelledby="queue-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">Human in the loop</p>
          <h2 id="queue-title">Waiting on you</h2>
        </div>
        <span className={`count-badge ${queue.length > 0 ? "has-risk" : ""}`}>
          {queue.length}
        </span>
      </div>
      {workflow.approvals === null || workflow.evidence === null ? (
        <p className="inline-warning" role="status">
          Some approvals or evidence could not be loaded, so this list may be
          incomplete.
        </p>
      ) : null}
      {queue.length === 0 ? (
        <EmptyState
          icon="check"
          title="Nothing is waiting on you"
          detail="Approvals, blocked work, late evidence, and reviews appear here as soon as they need a person."
        />
      ) : (
        <ul className="queue-list">
          {queue.slice(0, 8).map((item) => {
            const meta = QUEUE_META[item.kind];
            const href =
              item.kind === "approval"
                ? sectionHref(model, "approvals")
                : item.kind === "evidence"
                  ? sectionHref(model, "evidence")
                  : directoryHref({
                      section: "tasks",
                      organizationId: model.organization.id,
                      projectId: model.selectedProject?.id ?? null,
                      taskId: item.id,
                    });
            return (
              <li key={`${item.kind}-${item.id}`}>
                <span className={`queue-icon queue-${item.kind}`}>
                  <UiIcon name={meta.icon} size={16} />
                </span>
                <span className="queue-copy">
                  <span className={`kind-chip kind-${item.kind}`}>
                    {meta.label}
                  </span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <a className="queue-action" href={href}>
                  {meta.action}
                  <UiIcon name="chevron" size={14} />
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
    <section className="dashboard-card agent-card" aria-labelledby="loop-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Agent control loop</p>
          <h2 id="loop-title">
            {workflow.activeAgents === null
              ? "AI workforce"
              : `${workflow.activeAgents} active agent${workflow.activeAgents === 1 ? "" : "s"}`}
          </h2>
        </div>
        <span className="agent-card-icon">
          <UiIcon name="sparkles" size={20} />
        </span>
      </div>
      <ol className="loop-steps">
        {steps.map(([title, detail], index) => (
          <li
            key={title}
            className={index === 2 && waiting > 0 ? "loop-hot" : undefined}
          >
            <span>{index + 1}</span>
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
      <a href={sectionHref(model, "agents")}>
        Manage the workforce <UiIcon name="arrow" size={15} />
      </a>
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
    <section className="lifecycle-card" aria-labelledby="lifecycle-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Audit lifecycle</p>
          <h2 id="lifecycle-title">From scope to sign-off</h2>
        </div>
        <span className="section-meta">
          Phase {phase + 1} of {phases.length}
        </span>
      </div>
      <ol className="lifecycle">
        {phases.map((item, index) => {
          const body = (
            <>
              <span className="phase-node">
                {index < phase ? <UiIcon name="check" size={14} /> : index + 1}
              </span>
              <span className="phase-copy">
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
    <section className="dashboard-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Delivery calendar</p>
          <h2>Coming up</h2>
        </div>
        <UiIcon name="clock" />
      </div>
      {deadlines.length === 0 ? (
        <EmptyState
          icon="clock"
          title="No open deadlines"
          detail="Work with a deadline appears here in date order."
        />
      ) : (
        <ul className="record-list">
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
              <time className="status" dateTime={task.deadline ?? undefined}>
                {task.deadline?.slice(0, 10)}
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
    <section className="dashboard-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Audit trail</p>
          <h2>Recent activity</h2>
        </div>
        <UiIcon name="activity" />
      </div>
      {activity.length === 0 ? (
        <EmptyState
          icon="activity"
          title="No activity yet"
          detail="Every change to this engagement is recorded here."
        />
      ) : (
        <ul className="record-list">
          {activity.slice(0, 6).map((item) => (
            <li key={`${item.occurredAt}-${item.action}`}>
              <span>
                {plainAction(item.action)} · {item.actorName}
              </span>
              <time className="status" dateTime={item.occurredAt}>
                {item.occurredAt.slice(0, 10)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Metric({
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
    <article
      className={`metric-card metric-${value === null ? "default" : tone}`}
    >
      <div className="metric-icon">
        <UiIcon name={icon} />
      </div>
      <div>
        <p>{label}</p>
        <strong>{value === null ? "–" : value}</strong>
        <small>{value === null ? "Unavailable" : detail}</small>
      </div>
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
  const words = action.replaceAll(".", " ").replaceAll("_", " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const NOTICES: Record<ProjectNotice, string> = {
  saved: "Project saved.",
  invalid: "Check the project fields and try again.",
  conflict: "This project changed. Refresh it and try again.",
  slug: "That slug is already used in this organization.",
  status: "That status change is not available.",
  denied: "You cannot change this project.",
  unavailable: "The project could not be saved.",
};

function NoEngagement({ model, what }: { model: Ready; what: string }) {
  return (
    <section className="dashboard-card">
      <EmptyState
        icon="briefcase"
        title="Choose an engagement first"
        detail={`${what} belong to one engagement. Create or select one to continue.`}
      />
      <a className="primary-action" href={sectionHref(model, "projects")}>
        Open engagements <UiIcon name="arrow" size={16} />
      </a>
    </section>
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
  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{project.name}</p>
          <h1>Evidence</h1>
          <p>
            Ask control owners for what each control needs, then track every
            response to closure. Requests start as drafts and go out from an
            approved template only after an approver confirms the exact message.{" "}
            {workflow.mailboxMode === "live"
              ? "Live email is on."
              : "Live email is off, so messages stay in the test mailbox."}
          </p>
        </div>
      </header>
      {workflow.evidenceNotice !== null ? (
        <p className="notice" role="status">
          {workflow.evidenceNotice === "sent" && workflow.mailboxMode !== "live"
            ? "Request recorded in the test mailbox with its reference. No email left this workspace."
            : EVIDENCE_NOTICES[workflow.evidenceNotice]}
        </p>
      ) : null}
      <section className="metric-grid" aria-label="Evidence metrics">
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
      <div className="split-layout">
        <section className="dashboard-card" aria-labelledby="evidence-board">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Request tracker</p>
              <h2 id="evidence-board">Every request, by stage</h2>
            </div>
          </div>
          {evidence === null ? (
            <p className="inline-warning" role="status">
              Evidence requests could not be loaded. Refresh to try again.
            </p>
          ) : items.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="No evidence requested yet"
              detail="Create the first request for a control. It starts as a draft, and nothing is sent."
            />
          ) : (
            <div className="stage-board">
              {EVIDENCE_STAGES.map((stage) => {
                const inStage = items.filter((item) =>
                  stage.statuses.includes(item.status),
                );
                return (
                  <section key={stage.id} className="stage-lane">
                    <h3>
                      {stage.label}
                      <span>{inStage.length}</span>
                    </h3>
                    {inStage.length === 0 ? (
                      <p className="lane-empty">None</p>
                    ) : (
                      <ul>
                        {inStage.map((item) => (
                          <EvidenceCard
                            key={item.id}
                            model={model}
                            workflow={workflow}
                            item={item}
                            now={now}
                          />
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </section>
        {!canRequestEvidence(model.organization.role) ? (
          <section className="dashboard-card">
            <h2>Evidence access</h2>
            <p>
              Your role can follow evidence requests. It cannot create them.
            </p>
          </section>
        ) : project.status !== "ACTIVE" ? (
          <section className="dashboard-card">
            <h2>Requests are paused</h2>
            <p>
              Activate the engagement to request evidence. Existing requests
              stay visible.
            </p>
          </section>
        ) : (
          <EvidenceForm model={model} workflow={workflow} />
        )}
      </div>
    </div>
  );
}

function EvidenceCard({
  model,
  workflow,
  item,
  now,
}: {
  model: Ready;
  workflow: WorkflowState;
  item: EvidenceRequest;
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
  return (
    <li className="work-card">
      <span className="mono">{item.controlRef}</span>
      <strong>{item.description}</strong>
      <small>{item.recipient}</small>
      <span className="card-meta">
        <time dateTime={item.dueAt} className={late ? "late-chip" : "due-chip"}>
          {late ? "Overdue" : "Due"} {item.dueAt.slice(0, 10)}
        </time>
        {item.attachmentCount > 0 ? (
          <span className="due-chip">
            {item.attachmentCount} file{item.attachmentCount === 1 ? "" : "s"}
          </span>
        ) : null}
        {record !== null && delivery !== null ? (
          <span
            className={`delivery-chip delivery-${delivery.tone}`}
            title={`${record.reference} · delivery ${record.deliveryConfirmed ? "confirmed" : "not confirmed"}`}
          >
            {delivery.label}
          </span>
        ) : null}
      </span>
      {!canAct ? null : record !== null && canRetryDelivery(record) ? (
        <OutboundAction
          model={model}
          requestId={item.id}
          intent="send"
          approvalId={record.approvalId}
          label="Check and retry"
          detail="Checks the mailbox before any resend"
        />
      ) : !sendable ? null : ready !== null ? (
        <OutboundAction
          model={model}
          requestId={item.id}
          intent="send"
          approvalId={ready.id}
          label="Send request"
          detail="Approved · uses the approved template"
        />
      ) : waiting ? (
        <p className="card-note">
          <UiIcon name="clock" size={13} /> Waiting for an approver
        </p>
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
    <form method="post" action="/workspace/outbound" className="card-action">
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
      <button type="submit" className={intent === "send" ? "" : "ghost-button"}>
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
    <section className="dashboard-card" aria-labelledby="evidence-form">
      <p className="eyebrow">New request</p>
      <h2 id="evidence-form">Request evidence</h2>
      <p>Saved as a draft for review. Nothing is emailed.</p>
      <form method="post" action="/workspace/evidence" className="project-form">
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
        <label htmlFor="evidence-recipient" className="wide">
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
        <button type="submit">Save draft request</button>
      </form>
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
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{project.name}</p>
          <h1>Approvals</h1>
          <p>
            Agents and people ask before a sensitive action. Each approval
            covers only the exact request shown, needs a reason, and expires
            after 24 hours.
          </p>
        </div>
      </header>
      {workflow.decisionNotice !== null ? (
        <p className="notice" role="status">
          {DECISION_NOTICES[workflow.decisionNotice]}
        </p>
      ) : null}
      {approvals === null ? (
        <p className="inline-warning" role="status">
          Approvals could not be loaded. Refresh to try again.
        </p>
      ) : null}
      <section className="dashboard-card" aria-labelledby="pending-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Needs a decision</p>
            <h2 id="pending-title">Waiting for approval</h2>
          </div>
          <span
            className={`count-badge ${pending.length > 0 ? "has-risk" : ""}`}
          >
            {pending.length}
          </span>
        </div>
        {pending.length === 0 ? (
          <EmptyState
            icon="shield"
            title="No decisions waiting"
            detail="When an agent or a teammate asks to take a sensitive action, it appears here."
          />
        ) : (
          <ul className="approval-list">
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
      <section className="dashboard-card" aria-labelledby="history-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Decision log</p>
            <h2 id="history-title">History</h2>
          </div>
          <span className="section-meta">{history.length} decided</span>
        </div>
        {history.length === 0 ? (
          <EmptyState
            icon="activity"
            title="No decisions yet"
            detail="Approved, rejected, and expired requests are kept here."
          />
        ) : (
          <ul className="history-list">
            {history.map((item) => {
              const state = approvalState(item, now);
              const requestId = approvalRequestId(item);
              const sendable =
                requestId !== null &&
                workflow.outbound !== null &&
                canRequestEvidence(model.organization.role) &&
                project.status === "ACTIVE" &&
                readyToSend([item], workflow.outbound, requestId, now) !== null;
              return (
                <li key={item.id}>
                  <span className={`decision-chip decision-${state}`}>
                    {state === "approved"
                      ? "Approved"
                      : state === "rejected"
                        ? "Rejected"
                        : "Expired"}
                  </span>
                  <span className="history-copy">
                    <strong>{actionLabel(item.actionId)}</strong>
                    <small>
                      {item.targetResource}
                      {item.decisionReason === null
                        ? ""
                        : ` · "${item.decisionReason}"`}
                    </small>
                  </span>
                  {sendable && requestId !== null ? (
                    <OutboundAction
                      model={model}
                      requestId={requestId}
                      intent="send"
                      approvalId={item.id}
                      label="Send request"
                    />
                  ) : (
                    <span className="section-meta">
                      {state === "approved"
                        ? (EXECUTION_LABELS[item.executionStatus] ??
                          item.executionStatus)
                        : ""}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
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
    <li className="approval-card">
      <div className="approval-head">
        <span className="queue-icon queue-approval">
          <UiIcon name="shield" size={16} />
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
        <span className={`risk-chip risk-${item.risk.toLowerCase()}`}>
          {labelStatus(item.risk)} risk
        </span>
      </div>
      <dl className="param-list">
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
              className="danger-button"
            >
              <UiIcon name="x" size={15} /> Reject
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: IconName;
  title: string;
  detail: string;
}) {
  return (
    <div className="empty-state">
      <span>
        <UiIcon name={icon} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function ProjectsMain({
  model,
}: {
  model: Extract<ShellModel, { status: "ready" }>;
}) {
  return (
    <div className="project-layout">
      <section className="panel">
        <p className="kicker">Portfolio</p>
        <h1>Engagements</h1>
        <p>
          One engagement is one audit. Draft while the scope is being shaped.
          Active when the team should add work. Paused holds it. Archived keeps
          the record.
        </p>
        {model.notice !== null ? (
          <p className="notice" role="status">
            {NOTICES[model.notice]}
          </p>
        ) : null}
        {model.projects.length === 0 ? (
          <p>No projects in {model.organization.name}.</p>
        ) : (
          <ul className="record-list">
            {model.projects.map((project) => (
              <li key={project.id}>
                <a
                  href={workspaceHref(
                    "projects",
                    model.organization.id,
                    project.id,
                  )}
                >
                  {project.name}
                </a>
                <span className="status">{labelStatus(project.status)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {model.canManageProjects ? (
        <CreateProject model={model} />
      ) : (
        <section className="panel">
          <h2>Engagement access</h2>
          <p>
            Your role can review engagements. It cannot create or change them.
          </p>
        </section>
      )}
      {model.projectDetail !== null ? (
        <ProjectEditor model={model} detail={model.projectDetail} />
      ) : null}
    </div>
  );
}

function CreateProject({
  model,
}: {
  model: Extract<ShellModel, { status: "ready" }>;
}) {
  return (
    <section className="panel">
      <h2>New engagement</h2>
      <form method="post" action="/workspace/projects" className="project-form">
        <input type="hidden" name="intent" value="create" />
        <input
          type="hidden"
          name="organization_id"
          value={model.organization.id}
        />
        <label htmlFor="project-name">
          Name
          <input id="project-name" name="name" required maxLength={200} />
        </label>
        <label htmlFor="project-slug">
          Slug
          <input
            id="project-slug"
            name="slug"
            required
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            maxLength={80}
          />
        </label>
        <label htmlFor="project-scope">
          Scope
          <textarea id="project-scope" name="scope" rows={3} maxLength={4000} />
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
        <button type="submit">Create engagement</button>
      </form>
    </section>
  );
}

function ProjectEditor({
  model,
  detail,
}: {
  model: Extract<ShellModel, { status: "ready" }>;
  detail: ProjectDetail;
}) {
  const choices = statusChoices(detail.status);
  const total = detail.progress.reduce((sum, item) => sum + item.count, 0);
  return (
    <section className="panel">
      <h2>{detail.name}</h2>
      <p>
        {total === 0
          ? "No tasks yet."
          : `${total} task${total === 1 ? "" : "s"} across this project.`}
      </p>
      {detail.progress.length > 0 ? (
        <ul className="record-list">
          {detail.progress.map((item) => (
            <li key={item.status}>
              <span>{item.status}</span>
              <span className="status">{item.count}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <h3>Activity</h3>
      {detail.activity.length === 0 ? (
        <p>No activity yet.</p>
      ) : (
        <ul className="record-list">
          {detail.activity.map((item) => (
            <li key={`${item.occurredAt}-${item.action}`}>
              <span>
                {plainAction(item.action)} · {item.actorName}
              </span>
              <time className="status" dateTime={item.occurredAt}>
                {item.occurredAt.slice(0, 10)}
              </time>
            </li>
          ))}
        </ul>
      )}
      {model.canManageProjects ? (
        <form
          method="post"
          action="/workspace/projects"
          className="project-form"
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
                  {status}
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
              Save project
            </button>
            {detail.status === "DRAFT" ? (
              <button type="submit" name="intent" value="start">
                Start
              </button>
            ) : null}
            {detail.status === "ACTIVE" ? (
              <button type="submit" name="intent" value="pause">
                Pause
              </button>
            ) : null}
            {detail.status === "PAUSED" ? (
              <button type="submit" name="intent" value="resume">
                Resume
              </button>
            ) : null}
            {detail.status !== "ARCHIVED" ? (
              <button type="submit" name="intent" value="archive">
                Archive
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
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
};

const EMPTY_SCHEMA = `{
  "type": "object",
  "properties": {}
}`;

function AgentsMain({
  model,
  directory,
}: {
  model: Extract<ShellModel, { status: "ready" }>;
  directory: DirectoryQuery;
}) {
  return (
    <div className="project-layout">
      <section className="panel">
        <p className="kicker">{model.organization.name}</p>
        <h1>Workforce</h1>
        {model.agentNotice !== null ? (
          <p className="notice" role="status">
            {AGENT_NOTICES[model.agentNotice]}
          </p>
        ) : null}
        <p>
          Definitions belong to the firm. Each one names a role, its inputs and
          outputs, and a model name. Active definitions can be assigned.
          Disabled definitions do not start new work. Work already running
          finishes on the revision it started with.
        </p>
        <AgentDirectory model={model} directory={directory} />
      </section>
      {model.canManageAgents ? (
        <CreateAgent model={model} />
      ) : (
        <section className="panel">
          <h2>Agent access</h2>
          <p>
            Your role can view agent definitions. It cannot create or change
            them.
          </p>
        </section>
      )}
      {model.agentDetail !== null ? (
        <AgentEditor model={model} detail={model.agentDetail} />
      ) : null}
    </div>
  );
}

function AgentDirectory({
  model,
  directory,
}: {
  model: Extract<ShellModel, { status: "ready" }>;
  directory: DirectoryQuery;
}) {
  const filtered = filterAgents(model.agents, directory.agentStatus);
  const page = paginate(filtered, directory.agentPage);
  return (
    <>
      <form method="get" action="/" className="filters">
        <input
          type="hidden"
          name="organization"
          value={model.organization.id}
        />
        <input type="hidden" name="section" value="agents" />
        {model.selectedProject !== null ? (
          <input
            type="hidden"
            name="project"
            value={model.selectedProject.id}
          />
        ) : null}
        <label htmlFor="agent-filter">
          Status
          <select
            id="agent-filter"
            name="agentStatus"
            defaultValue={directory.agentStatus ?? ""}
          >
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="DISABLED">Disabled</option>
          </select>
        </label>
        <button type="submit">Filter</button>
      </form>
      {model.agents.length === 0 ? (
        <p>No agents in {model.organization.name}.</p>
      ) : page.total === 0 ? (
        <p>No agents match this filter.</p>
      ) : (
        <ul className="directory">
          {page.items.map((agent) => (
            <li key={agent.id}>
              <a
                href={directoryHref({
                  section: "agents",
                  organizationId: model.organization.id,
                  projectId: model.selectedProject?.id ?? null,
                  agentId: agent.id,
                  agentStatus: directory.agentStatus,
                  agentPage: page.page,
                })}
              >
                <strong>{agent.name}</strong>
                <span>{agent.role}</span>
              </a>
              <span className="status">{labelStatus(agent.status)}</span>
            </li>
          ))}
        </ul>
      )}
      <Pager
        page={page}
        hrefFor={(next) =>
          directoryHref({
            section: "agents",
            organizationId: model.organization.id,
            projectId: model.selectedProject?.id ?? null,
            agentStatus: directory.agentStatus,
            agentPage: next,
          })
        }
      />
    </>
  );
}

function TaskBoard({
  model,
  directory,
}: {
  model: Extract<ShellModel, { status: "ready" }>;
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
    <>
      <form method="get" action="/" className="filters">
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
        <button type="submit">Filter</button>
      </form>
      {model.tasks.length === 0 ? (
        <p>No tasks in {model.selectedProject?.name}.</p>
      ) : page.total === 0 ? (
        <p>No tasks match this filter.</p>
      ) : (
        <div className="board">
          {lanes.map((lane) => (
            <section key={lane.status} className="lane">
              <h2>{labelStatus(lane.status)}</h2>
              <ul>
                {lane.tasks.map((task) => (
                  <li key={task.id}>
                    <a
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
                      <span>
                        {task.priority}
                        {task.assigneeName === null
                          ? ""
                          : ` · ${task.assigneeName}`}
                      </span>
                      {task.deadline !== null ? (
                        <time dateTime={task.deadline}>{task.deadline}</time>
                      ) : null}
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
    </>
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
    <p className="pager">
      {page.page > 1 ? (
        <a href={hrefFor(page.page - 1)}>Previous</a>
      ) : (
        <span>Previous</span>
      )}
      <span>
        Page {page.page} of {page.pages}
      </span>
      {page.page < page.pages ? (
        <a href={hrefFor(page.page + 1)}>Next</a>
      ) : (
        <span>Next</span>
      )}
    </p>
  );
}

function CreateAgent({
  model,
}: {
  model: Extract<ShellModel, { status: "ready" }>;
}) {
  return (
    <section className="panel">
      <h2>New agent</h2>
      <form method="post" action="/workspace/agents" className="project-form">
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
        <button type="submit">Create agent</button>
      </form>
    </section>
  );
}

function AgentEditor({
  model,
  detail,
}: {
  model: Extract<ShellModel, { status: "ready" }>;
  detail: AgentDetail;
}) {
  return (
    <section className="panel">
      <h2>{detail.name}</h2>
      <p>
        Definition {detail.id}. Revision {detail.revision}. Role {detail.role}.
      </p>
      {model.canManageAgents ? (
        <form method="post" action="/workspace/agents" className="project-form">
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
          <AgentFields idPrefix="edit-agent" detail={detail} />
          <div className="form-actions">
            <button type="submit" name="intent" value="update">
              Save agent
            </button>
            {detail.status === "ACTIVE" ? (
              <button type="submit" name="intent" value="disable">
                Disable
              </button>
            ) : (
              <button type="submit" name="intent" value="enable">
                Enable
              </button>
            )}
          </div>
        </form>
      ) : (
        <p>
          {detail.description === "" ? "No description." : detail.description}
        </p>
      )}
    </section>
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
      <label htmlFor={`${idPrefix}-model`}>
        Model name
        <input
          id={`${idPrefix}-model`}
          name="model_config_ref"
          required
          maxLength={121}
          defaultValue={detail?.modelConfigRef ?? ""}
          autoComplete="off"
        />
      </label>
      <label htmlFor={`${idPrefix}-tools`}>
        Allowed tool ids
        <input
          id={`${idPrefix}-tools`}
          name="allowed_tool_ids"
          defaultValue={detail?.allowedToolIds.join(", ") ?? ""}
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
  model: Extract<ShellModel, { status: "ready" }>;
  directory: DirectoryQuery;
}) {
  return (
    <div className="project-layout work-layout">
      <section className="panel">
        <p className="kicker">{model.selectedProject?.name ?? "Engagement"}</p>
        <h1>Work</h1>
        <p>
          Items move from draft to ready, then into execution and review.
          Blocked work needs a written blocker. Cancelled work stays closed
          until someone reactivates it.
        </p>
        {model.taskNotice !== null ? (
          <p className="notice" role="status">
            {TASK_NOTICES[model.taskNotice]}
          </p>
        ) : null}
        {model.selectedProject === null ? (
          <p>Select a project to see its tasks.</p>
        ) : (
          <TaskBoard model={model} directory={directory} />
        )}
      </section>
      {model.selectedProject !== null && model.canManageTasks ? (
        <CreateTask model={model} />
      ) : model.selectedProject !== null ? (
        <section className="panel">
          <h2>Task access</h2>
          <p>Your role can review tasks. It cannot create or change them.</p>
        </section>
      ) : null}
      {model.taskDetail !== null ? (
        <TaskEditor model={model} detail={model.taskDetail} />
      ) : null}
    </div>
  );
}

function CreateTask({
  model,
}: {
  model: Extract<ShellModel, { status: "ready" }>;
}) {
  return (
    <section className="panel">
      <h2>Add work</h2>
      <p>Start in draft. Mark it ready when someone should pick it up.</p>
      <form method="post" action="/workspace/tasks" className="project-form">
        <input type="hidden" name="intent" value="create" />
        <TaskIdentity model={model} taskId="" version="" />
        <TaskFields model={model} detail={null} />
        <button type="submit">Add work</button>
      </form>
    </section>
  );
}

function TaskEditor({
  model,
  detail,
}: {
  model: Extract<ShellModel, { status: "ready" }>;
  detail: TaskDetail;
}) {
  const choices = taskStatusChoices(detail.status);
  return (
    <section className="panel">
      <p className="kicker">Task details</p>
      <h2>{detail.title}</h2>
      <p>
        Retries {detail.retryCount} of {detail.maxRetries}.
        {detail.assigneeName === null
          ? " Unassigned."
          : ` Assigned to ${detail.assigneeName}.`}
      </p>
      <h3>Execution history</h3>
      {detail.activity.length === 0 ? (
        <p>No history yet.</p>
      ) : (
        <ul className="record-list">
          {detail.activity.map((item) => (
            <li key={`${item.occurredAt}-${item.action}`}>
              <span>
                {plainAction(item.action)} · {item.actorName}
              </span>
              <time className="status" dateTime={item.occurredAt}>
                {item.occurredAt.slice(0, 10)}
              </time>
            </li>
          ))}
        </ul>
      )}
      {model.canManageTasks ? (
        <form method="post" action="/workspace/tasks" className="project-form">
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
            {choices.includes("CANCELLED") && detail.status !== "CANCELLED" ? (
              <button type="submit" name="intent" value="cancel">
                Cancel task
              </button>
            ) : null}
            {detail.status === "FAILED" &&
            detail.retryCount < detail.maxRetries ? (
              <button type="submit" name="intent" value="retry">
                Retry
              </button>
            ) : null}
            {detail.status === "CANCELLED" ? (
              <button type="submit" name="intent" value="reactivate">
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
    </section>
  );
}

function TaskIdentity({
  model,
  taskId,
  version,
}: {
  model: Extract<ShellModel, { status: "ready" }>;
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
  model: Extract<ShellModel, { status: "ready" }>;
  detail: TaskDetail | null;
}) {
  const choices =
    detail === null ? ["DRAFT", "READY"] : taskStatusChoices(detail.status);
  const others = model.tasks.filter((task) => task.id !== detail?.id);
  return (
    <>
      <label htmlFor={detail === null ? "task-title" : "edit-task-title"}>
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
  others: Extract<ShellModel, { status: "ready" }>["tasks"];
}) {
  return (
    <>
      <h3 className="form-section">Controls</h3>
      <label htmlFor="edit-task-blocker">
        Blocker
        <input
          id="edit-task-blocker"
          name="blocker"
          maxLength={2000}
          defaultValue={detail.blocker}
        />
      </label>
      <label htmlFor="edit-task-escalation">
        Escalation
        <input
          id="edit-task-escalation"
          name="escalation"
          maxLength={2000}
          defaultValue={detail.escalation}
        />
      </label>
      <label htmlFor="edit-task-reason">
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
