import type { ReactNode } from "react";
import { homeListsWork, isClosed, pausedNotice } from "./engagement-lifecycle";
import {
  CATEGORIES,
  type ControlRow,
  DEFICIENCY_STATUSES,
  type Deficiency,
  type EngagementNotice,
  type EngagementState,
  LIKELIHOODS,
  MAGNITUDES,
  type Milestone,
  openPhases,
  type Phase,
  type Plan,
  type PlanTask,
  SEVERITIES,
  STAGES,
  timelineMonths,
  timelinePercent,
} from "./engagement-model";
import { formatDate } from "./format";
import type { NextSteps } from "./home-model";
import { JourneyBar } from "./home-view";
import { HomeWorkPanel } from "./home-work";
import {
  dueWords,
  headerAction,
  heldRecipients,
  stageHref,
  systemConditions,
} from "./home-work-model";
import { PlanMissingButton } from "./plan-missing";
import { parseQueueFilter, type Queue } from "./queue-model";
import { QueuePanel } from "./queue-panel";
import { canonicalQuery } from "./routes";
import { canManageProjects, type ShellModel } from "./shell-model";
import { UiIcon } from "./ui-icon";
import { canRequestEvidence } from "./workflow-model";
import {
  Banner,
  CardHeader,
  EmptyState,
  Metric,
  PageHeader,
  StatusPill,
  sectionHref,
} from "./workspace-view";

type Ready = Extract<ShellModel, { status: "ready" }>;

const _STAGE_LABEL: Record<string, string> = Object.fromEntries(STAGES);
const SEVERITY_LABEL: Record<string, string> = Object.fromEntries(SEVERITIES);
const STATUS_LABEL: Record<string, string> =
  Object.fromEntries(DEFICIENCY_STATUSES);
const LIKELIHOOD_LABEL: Record<string, string> =
  Object.fromEntries(LIKELIHOODS);
const MAGNITUDE_LABEL: Record<string, string> = Object.fromEntries(MAGNITUDES);
const _CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES);

const NOTICES: Record<EngagementNotice, string> = {
  saved: "Saved.",
  invalid: "Check the fields and try again.",
  changed: "Something changed since the page loaded. Review it and try again.",
  denied: "Your role cannot make that change.",
  unavailable: "That could not be saved. Try again.",
  logged: "Deficiency logged.",
  requested: "Sent to the engagement reviewer for approval.",
  decided: "Decision recorded.",
};

const PHASE_TONE: Record<Phase["status"], string> = {
  NOT_STARTED: "",
  IN_PROGRESS: "tone-info",
  DONE: "tone-success",
  AT_RISK: "tone-danger",
};
const PHASE_STATUS: Record<Phase["status"], string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  AT_RISK: "At risk",
};
const MILESTONE_STATUS: Record<Milestone["status"], string> = {
  DONE: "Done",
  UPCOMING: "Upcoming",
  DUE_SOON: "Due soon",
  MISSED: "Missed",
};
const MILESTONE_TONE: Record<Milestone["status"], string> = {
  DONE: "tone-success",
  UPCOMING: "",
  DUE_SOON: "tone-warning",
  MISSED: "tone-danger",
};
const SEVERITY_TONE: Record<string, string> = {
  CONTROL_DEFICIENCY: "tone-warning",
  SIGNIFICANT_DEFICIENCY: "tone-danger",
  MATERIAL_WEAKNESS: "tone-critical",
};

function pageHref(
  model: Ready,
  section: string,
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams({
    organization: model.organization.id,
    section,
  });
  canonicalQuery(params);
  if (model.selectedProject !== null) {
    params.set("project", model.selectedProject.id);
  }
  for (const [key, value] of Object.entries(extra)) {
    params.set(key, value);
  }
  return `/?${params.toString()}`;
}

function taskHref(model: Ready, taskId: string): string {
  return pageHref(model, "tasks", { task: taskId });
}

function Identity({
  model,
  intent,
  section,
}: {
  model: Ready;
  intent: string;
  section: string;
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
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="section" value={section} />
    </>
  );
}

/**
 * The conditions of the environment that hold work, said once at the top instead of on
 * every row they hold (docs/home-plan.md, H2). Clearing them is an administrator's
 * configuration, not a step in the engagement, so the notice names who clears them.
 */
function SystemNotices({ queue }: { queue: Queue | null }) {
  const conditions = systemConditions(queue);
  if (conditions.length === 0) {
    return null;
  }
  return (
    <>
      {conditions.map((condition) => (
        <div
          key={condition.code}
          className="banner banner-warning period-alert"
          role="status"
        >
          <UiIcon
            name={condition.code === "NO_WORKER" ? "server" : "mail"}
            size={16}
          />
          <div>
            {condition.code === "NO_WORKER" ? (
              <>
                <strong>
                  Agent work cannot start: no worker is configured.
                </strong>{" "}
                {condition.items} item{condition.items === 1 ? " is" : "s are"}{" "}
                held until an administrator starts the agent worker for this
                environment.
              </>
            ) : condition.code === "RECIPIENT_NOT_ALLOWED" ? (
              <>
                <strong>
                  {condition.items} request
                  {condition.items === 1 ? " is" : "s are"} addressed outside
                  the allowed recipient domains.
                </strong>{" "}
                This environment sends evidence requests only to approved
                domains, so these requests cannot be approved until an
                administrator allows the client's domain or the recipient is
                changed.
                <span className="notice-examples">
                  Held for{" "}
                  {heldRecipients(condition.texts).slice(0, 3).join(", ")}
                  {heldRecipients(condition.texts).length > 3
                    ? `, and ${heldRecipients(condition.texts).length - 3} more`
                    : ""}
                  .
                </span>
              </>
            ) : (
              <>
                <strong>
                  {condition.items} item
                  {condition.items === 1 ? " is" : "s are"} held by a system
                  condition.
                </strong>{" "}
                {condition.texts[0] ?? ""}
              </>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

function Notice({ notice }: { notice: EngagementNotice | null }) {
  if (notice === null) {
    return null;
  }
  const good = ["saved", "logged", "requested", "decided"].includes(notice);
  return <Banner tone={good ? "info" : "warning"}>{NOTICES[notice]}</Banner>;
}

function NotStarted({ model, what }: { model: Ready; what: string }) {
  return (
    <section className="card">
      <EmptyState
        icon="briefcase"
        title={`The ${what} starts with the engagement`}
        detail="Finish setup and launch the engagement to see the phases, milestones, and tasks here."
        action={
          <a className="btn" href={sectionHref(model, "setup")}>
            Open setup <UiIcon name="arrow" size={15} />
          </a>
        }
      />
    </section>
  );
}

function Unavailable({ what }: { what: string }) {
  return (
    <section className="card">
      <div className="card-body">
        <Banner tone="warning">
          The {what} could not be loaded. Refresh to try again.
        </Banner>
      </div>
    </section>
  );
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

function Meter({ value, tone = "" }: { value: number; tone?: string }) {
  return (
    <span className={`meter ${tone}`} aria-hidden="true">
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </span>
  );
}

// Dashboard

export function EngagementDashboard({
  model,
  engagement,
  home,
  attention,
  next = null,
  queue = null,
  allWork = false,
  workHref,
  activity = null,
}: {
  model: Ready;
  engagement: EngagementState;
  /** The older journey and list, used only when the queue is not available. */
  home?: ReactNode;
  attention: ReactNode;
  /** The journey of stages (next_steps). */
  next?: NextSteps | null;
  /** The engagement's one queue, as this viewer sees it (Milestone 2). */
  queue?: Queue | null;
  /** The full list of open work with its filters, instead of Home's sections. */
  allWork?: boolean;
  /** Home's address with a work filter ("all" for the full list, "" for Home). */
  workHref?: ((filter: string) => string) | undefined;
  /** The engagement's recent activity, folded at the foot of Home in every state. */
  activity?: ReactNode;
}) {
  const project = model.selectedProject;
  const data = engagement.dashboard;
  if (project === null) {
    return null;
  }
  if (data === null) {
    return (
      <div className="page">
        <PageHeader context={project.name} title="Home" />
        {home}
        <Unavailable what="dashboard" />
        {attention}
      </div>
    );
  }
  const { controls, evidence, deficiencies, schedule } = data;
  const today = new Date().toISOString().slice(0, 10);
  const severe =
    (deficiencies.bySeverity.SIGNIFICANT_DEFICIENCY ?? 0) +
    (deficiencies.bySeverity.MATERIAL_WEAKNESS ?? 0);
  const nextMilestone = schedule.nextMilestones[0];
  const stage =
    next !== null
      ? (next.stages.find((item) => item.key === next.current)?.label ?? null)
      : null;
  // Paused, completed or archived: Home shows where it stands, without work to do.
  const closed = !homeListsWork(project.status);
  const top = closed
    ? null
    : headerAction(queue, model.organization.id, project.id);
  // A completed or archived engagement has no milestones ahead of it.
  const finished = isClosed(project.status);
  const ids = { organizationId: model.organization.id, projectId: project.id };
  const line = [
    schedule.periodEnd !== null
      ? `Period ends ${formatDate(schedule.periodEnd)}`
      : null,
    stage !== null ? `${stage} stage` : null,
    !finished && nextMilestone !== undefined
      ? `Next: ${nextMilestone.name}, ${formatDate(nextMilestone.dueDate)} (${dueWords(nextMilestone.dueDate, today)})`
      : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  const idle =
    nextMilestone !== undefined
      ? `Next on the engagement: ${nextMilestone.name}, ${formatDate(nextMilestone.dueDate)}.`
      : "";
  const deepest = [...SEVERITIES]
    .reverse()
    .find(([key]) => (deficiencies.bySeverity[key] ?? 0) > 0);
  return (
    <div className="page home-page">
      <PageHeader
        context={project.name}
        title="Home"
        badge={<StatusPill status={project.status} />}
        description={line}
        actions={
          <>
            <details className="row-menu home-menu">
              <summary className="btn btn-secondary">
                More <UiIcon name="chevron" size={13} />
              </summary>
              <div className="row-menu-panel home-menu-panel">
                <a href={pageHref(model, "timeline")}>Timeline</a>
                <a href={pageHref(model, "plan")}>Project plan</a>
              </div>
            </details>
            {top !== null ? (
              <a className="btn home-primary" href={top.href} title={top.title}>
                <span>{top.label}</span>
                <UiIcon name="arrow" size={15} />
              </a>
            ) : null}
          </>
        }
      />
      <LifecycleNotice status={project.status} />
      {data.periodConflicts.length > 0 ? (
        // A div, not Banner's paragraph: the alert holds a list.
        <div className="banner banner-warning period-alert" role="status">
          <UiIcon name="risk" size={16} />
          <div>
            <strong>Review the audit period.</strong> The recorded period is
            inconsistent with the engagement's name or scope:
            <ul>
              {data.periodConflicts.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
            <a
              href={`/?${canonicalQuery(
                new URLSearchParams({
                  organization: model.organization.id,
                  project: project.id,
                  section: "setup",
                  step: "profile",
                }),
              ).toString()}`}
            >
              Review the period
            </a>
          </div>
        </div>
      ) : null}
      {/* Notices that lead to work appear only while Home lists work. */}
      {!closed && data.unplannedControls + data.unrequestedControls > 0 ? (
        // A div, not Banner's paragraph: the alert holds a button.
        <div className="banner banner-warning period-alert" role="status">
          <UiIcon name="risk" size={16} />
          <div>
            {data.unplannedControls > 0 ? (
              <>
                <strong>
                  {data.unplannedControls} control
                  {data.unplannedControls === 1 ? " has" : "s have"} no evidence
                  plan.
                </strong>{" "}
                This engagement launched before evidence planning was
                introduced, so any requests drafted for these controls were
                prepared without a plan. Plan the evidence; each kickoff draft
                is then reconciled with its plan.{" "}
              </>
            ) : null}
            {data.unrequestedControls > 0 ? (
              <>
                <strong>
                  {data.unrequestedControls} control
                  {data.unrequestedControls === 1 ? " has" : "s have"} planned
                  evidence that has not been requested.
                </strong>{" "}
                No recipient was available at launch, so no requests were
                drafted. Draft the requests now; each awaits a recipient and
                approval.{" "}
              </>
            ) : null}
            No request is sent or replaced without approval.
            {canRequestEvidence(model.organization.role) ? (
              <div className="banner-action">
                <PlanMissingButton
                  organizationId={model.organization.id}
                  projectId={project.id}
                  unplanned={data.unplannedControls}
                  unrequested={data.unrequestedControls}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {/* One cause behind many held requests, with its one fix (docs/home-plan.md). */}
      {!closed && data.unaddressedRequests > 0 ? (
        <div className="banner banner-warning period-alert" role="status">
          <UiIcon name="mail" size={16} />
          <div>
            <strong>
              {data.unaddressedRequests} drafted request
              {data.unaddressedRequests === 1 ? " has" : "s have"} no recipient.
            </strong>{" "}
            No control owner email or evidence coordinator is set. Assigning an
            evidence coordinator addresses all of them; requests cannot be
            approved until a recipient is set.{" "}
            <a
              href={`/?${new URLSearchParams({
                organization: model.organization.id,
                project: project.id,
                section: "evidence",
                tab: "requests",
              }).toString()}#contacts-title`}
            >
              Assign the evidence coordinator
            </a>
          </div>
        </div>
      ) : null}
      {closed ? null : <SystemNotices queue={queue} />}
      {!closed && schedule.scheduleMissing ? (
        <Banner tone="warning">
          This engagement started before project plans existed.{" "}
          <a href={pageHref(model, "plan")}>Create its standard plan</a> to see
          phases and milestones.
        </Banner>
      ) : null}
      {next !== null ? (
        <JourneyBar
          next={next}
          hrefFor={(key) => stageHref(key, ids.organizationId, ids.projectId)}
        />
      ) : null}
      {allWork && queue !== null && workHref !== undefined ? (
        <>
          <p className="home-back">
            <a href={workHref("")}>
              <span className="icon-back" aria-hidden="true">
                <UiIcon name="arrow" size={13} />
              </span>
              Back to Home
            </a>
          </p>
          <QueuePanel
            queue={queue}
            filter={parseQueueFilter(engagement.filters.workFilter ?? null)}
            organizationId={ids.organizationId}
            projectId={ids.projectId}
            baseHref={(filter) => workHref(filter === "" ? "all" : filter)}
          />
        </>
      ) : (
        <div className="home-layout">
          <div className="home-main">
            {closed ? null : queue !== null && workHref !== undefined ? (
              <HomeWorkPanel
                queue={queue}
                organizationId={ids.organizationId}
                projectId={ids.projectId}
                allHref={workHref("all")}
                idle={idle}
              />
            ) : (
              (home ?? <Unavailable what="work" />)
            )}
            {/* The older inbox stands in only when the queue cannot be read: beside the
                queue it would list the same work again, without its controls. */}
            {closed || queue !== null ? null : attention}
            {activity}
          </div>
          <aside className="home-rail" aria-label="The engagement at a glance">
            <section className="card glance" aria-labelledby="glance-title">
              <CardHeader title="At a glance" titleId="glance-title" />
              <ul className="glance-grid">
                <Glance
                  label="Testing"
                  value={`${controls.concluded} of ${controls.inScope}`}
                  detail={
                    controls.exceptions > 0
                      ? `concluded · ${controls.exceptions} control${controls.exceptions === 1 ? "" : "s"} with exceptions so far`
                      : "concluded"
                  }
                  tone={controls.exceptions > 0 ? "attention" : "plain"}
                  href={stageHref("TESTING", ids.organizationId, ids.projectId)}
                />
                <Glance
                  label="Evidence"
                  value={`${evidence.received} of ${evidence.total}`}
                  detail={
                    evidence.overdue > 0
                      ? `received · ${evidence.overdue} overdue`
                      : "received · none overdue"
                  }
                  tone={evidence.overdue > 0 ? "risk" : "plain"}
                  href={sectionHref(model, "evidence")}
                />
                <Glance
                  label="Deficiencies"
                  value={String(deficiencies.open)}
                  detail={
                    deficiencies.open === 0
                      ? "none open"
                      : `open · most severe: ${(deepest?.[1] ?? "").toLowerCase()}`
                  }
                  tone={
                    severe > 0
                      ? "risk"
                      : deficiencies.open > 0
                        ? "attention"
                        : "good"
                  }
                  href={pageHref(model, "deficiencies")}
                />
                {schedule.phases.length === 0 ? (
                  // Nothing planned is not "on track": the figure says so plainly.
                  <Glance
                    label="Schedule"
                    value="Not planned"
                    detail="no phases or milestones yet"
                    tone="plain"
                    href={pageHref(model, "plan")}
                  />
                ) : (
                  <Glance
                    label="Schedule"
                    value={
                      schedule.atRisk > 0
                        ? `${schedule.atRisk} behind`
                        : "On track"
                    }
                    detail={
                      schedule.atRisk > 0
                        ? `phase${schedule.atRisk === 1 ? "" : "s"} past their planned dates`
                        : "no phase behind its planned dates"
                    }
                    tone={schedule.atRisk > 0 ? "risk" : "good"}
                    href={pageHref(model, "timeline")}
                  />
                )}
              </ul>
            </section>
            {finished ? null : (
              <section className="card" aria-labelledby="milestones-title">
                <CardHeader
                  title="Next milestones"
                  titleId="milestones-title"
                />
                {schedule.nextMilestones.length === 0 ? (
                  <div className="card-body">
                    <p className="form-hint">No open milestones.</p>
                  </div>
                ) : (
                  <ul className="rows home-milestones">
                    {schedule.nextMilestones.slice(0, 3).map((milestone) => (
                      <li key={milestone.key}>
                        <span className="row-text">
                          <span>{milestone.name}</span>
                          <small>
                            {formatDate(milestone.dueDate)} ·{" "}
                            {dueWords(milestone.dueDate, today)}
                          </small>
                        </span>
                        {milestone.status === "DUE_SOON" ||
                        milestone.status === "MISSED" ? (
                          <span
                            className={`pill pill-dot ${MILESTONE_TONE[milestone.status]}`}
                          >
                            {MILESTONE_STATUS[milestone.status]}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            <section className="card" aria-labelledby="deficiency-title">
              <CardHeader
                title="Deficiencies"
                titleId="deficiency-title"
                aside={
                  <a
                    className="text-link"
                    href={pageHref(model, "deficiencies")}
                  >
                    Register
                  </a>
                }
              />
              <ul className="rows home-severity">
                {[...SEVERITIES].reverse().map(([key, label]) => (
                  <li key={key}>
                    <span className="row-text">
                      <span>{label}</span>
                    </span>
                    <strong
                      className={`num ${(deficiencies.bySeverity[key] ?? 0) > 0 ? SEVERITY_TONE[key] : "severity-none"}`}
                    >
                      {deficiencies.bySeverity[key] ?? 0}
                    </strong>
                  </li>
                ))}
              </ul>
              {deficiencies.awaitingApproval + deficiencies.remediationOverdue >
              0 ? (
                <p className="card-foot form-hint">
                  {deficiencies.awaitingApproval} waiting for the reviewer ·{" "}
                  {deficiencies.remediationOverdue} remediation past due
                </p>
              ) : null}
            </section>
            <section
              className="card home-schedule"
              aria-labelledby="schedule-title"
            >
              <CardHeader
                title="Schedule"
                titleId="schedule-title"
                aside={
                  <a className="text-link" href={pageHref(model, "timeline")}>
                    Timeline
                  </a>
                }
              />
              <div className="card-body">
                {schedule.phases.length === 0 ? (
                  <p className="form-hint">No plan yet.</p>
                ) : (
                  <MiniTimeline phases={schedule.phases} today={today} />
                )}
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

/**
 * The engagement's agent work by agent (docs/home-plan.md, D5): a workforce view, shown
 * in Settings › AI workforce beside the agents it describes rather than on Home.
 */
export function AgentWorkCard({
  work,
  projectName,
}: {
  work: { waiting: number; byAgent: Record<string, number> };
  projectName: string;
}) {
  const largest = Math.max(1, ...Object.values(work.byAgent));
  return (
    <section className="card" aria-labelledby="agent-work-title">
      <CardHeader
        title="Open work by agent"
        titleId="agent-work-title"
        description={`On ${projectName}. ${work.waiting} task${work.waiting === 1 ? " is" : "s are"} waiting on earlier work.`}
      />
      {Object.keys(work.byAgent).length === 0 ? (
        <div className="card-body">
          <p className="form-hint">No agent work is open on this engagement.</p>
        </div>
      ) : (
        <div className="card-body stack">
          {Object.entries(work.byAgent).map(([agent, value]) => (
            <div key={agent} className="bar-row">
              <span>{agent}</span>
              <Meter value={percent(value, largest)} tone="tone-info" />
              <span className="num">{value}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Said once at the top while the engagement is paused. A completed or archived one
 * already carries the shell's read-only strip (`closedNotice`), so it is not repeated. */
function LifecycleNotice({ status }: { status: string }) {
  const notice = pausedNotice(status);
  return notice === null ? null : <Banner tone="warning">{notice}</Banner>;
}

/** One figure of the engagement at a glance, opening where it is worked on. Colour
 * carries meaning only: risk, needs attention, or good. */
function Glance({
  label,
  value,
  detail,
  tone,
  href,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "plain" | "attention" | "risk" | "good";
  href: string;
}) {
  return (
    <li className={`glance-item is-${tone}`}>
      <a href={href}>
        <span className="glance-label">{label}</span>
        <strong className="glance-value num">{value}</strong>
        <span className="glance-detail">{detail}</span>
      </a>
    </li>
  );
}

function MiniTimeline({ phases, today }: { phases: Phase[]; today: string }) {
  const start = phases.reduce(
    (min, phase) => (phase.plannedStart < min ? phase.plannedStart : min),
    phases[0]?.plannedStart ?? "",
  );
  const end = phases.reduce(
    (max, phase) => (phase.plannedEnd > max ? phase.plannedEnd : max),
    phases[0]?.plannedEnd ?? "",
  );
  const now = timelinePercent(today, start, end);
  const inside = today >= start && today <= end;
  const all = timelineMonths(start, end);
  // At most five month labels, evenly spaced, and none crowding the "Today" mark, so the
  // labels never collide in the rail's width.
  const step = Math.max(1, Math.ceil(all.length / 5));
  // Each month with its year, so a label can name the year where it changes.
  let year = Number(start.slice(0, 4));
  const dated = all.map((month) => {
    if (month.year !== null) {
      year = Number(month.year);
    }
    return { ...month, fullYear: year };
  });
  let shownYear: number | null = null;
  const months = dated
    .filter(
      (month, i) =>
        i % step === 0 && (!inside || Math.abs(month.at - now) > 12),
    )
    .map((month) => {
      const label =
        month.fullYear !== shownYear
          ? `${month.label} ${month.fullYear}`
          : month.label;
      shownYear = month.fullYear;
      return { ...month, label };
    });
  return (
    <div className="mini-timeline is-stacked">
      {phases.map((phase) => {
        const left = timelinePercent(phase.plannedStart, start, end);
        const width = Math.max(
          1.5,
          timelinePercent(phase.plannedEnd, start, end) - left,
        );
        return (
          <div key={phase.key} className="mini-row">
            <span className="mini-label">
              {phase.name}
              <small>
                {formatDate(phase.plannedStart)} to{" "}
                {formatDate(phase.plannedEnd)}
              </small>
            </span>
            <span className="mini-track">
              <span
                className={`gantt-bar gantt-${phase.status.toLowerCase()}`}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
              {inside ? (
                <span className="gantt-today" style={{ left: `${now}%` }} />
              ) : null}
            </span>
          </div>
        );
      })}
      <div className="mini-axis" aria-hidden="true">
        {months.map((month) => (
          <span
            key={`${month.label}-${month.at}`}
            style={{ left: `${month.at}%` }}
          >
            {month.label}
          </span>
        ))}
        {inside ? (
          <span className="mini-today" style={{ left: `${now}%` }}>
            Today
          </span>
        ) : null}
      </div>
    </div>
  );
}

// Controls register: see controls-view.tsx.

export { ControlsMain } from "./controls-view";

// Project plan

function PlanMissing({
  model,
  plan,
  section,
}: {
  model: Ready;
  plan: Plan;
  section: string;
}) {
  if (!plan.scheduleMissing) {
    return null;
  }
  return (
    <section className="card setup-callout">
      <div className="setup-callout-body">
        <div>
          <h2>Create the standard plan</h2>
          <p className="form-hint">
            Create a project plan from the standard SOX calendar, based on the
            kickoff date and the period end. Each task gets its phase's
            deadline.
          </p>
        </div>
        {canManageProjects(model.organization.role) ? (
          <form autoComplete="off" method="post" action="/workspace/engagement">
            <Identity
              model={model}
              intent="create-schedule"
              section={section}
            />
            <button type="submit">
              <UiIcon name="sparkles" size={15} /> Create plan
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
}

export function PlanMain({
  model,
  engagement,
}: {
  model: Ready;
  engagement: EngagementState;
}) {
  const project = model.selectedProject;
  const plan = engagement.plan;
  if (project === null) {
    return null;
  }
  if (plan === null) {
    return (
      <div className="page">
        <PageHeader context={project.name} title="Project plan" />
        <Unavailable what="project plan" />
      </div>
    );
  }
  if (!plan.started) {
    return (
      <div className="page">
        <PageHeader context={project.name} title="Project plan" />
        <NotStarted model={model} what="project plan" />
      </div>
    );
  }
  const editable = canManageProjects(model.organization.role);
  const unphased = plan.tasks.filter((task) => task.phaseKey === null);
  const done = plan.tasks.filter(
    (task) => task.status === "SUCCEEDED" || task.status === "CANCELLED",
  ).length;
  const opened = openPhases(plan.phases);
  return (
    <div className="page">
      <PageHeader
        context={project.name}
        title="Project plan"
        description="The engagement's work by phase, in the order it depends on. Each task's deadline follows its phase."
        actions={
          <>
            <span className="pill pill-dot tone-info">
              {done} of {plan.tasks.length} tasks done
            </span>
            <a className="btn btn-secondary" href={pageHref(model, "timeline")}>
              Timeline
            </a>
          </>
        }
      />
      <Notice notice={engagement.notice} />
      <PlanMissing model={model} plan={plan} section="plan" />
      {plan.phases.map((phase) => (
        <PhaseCard
          key={phase.key}
          model={model}
          phase={phase}
          open={opened.has(phase.key)}
          tasks={plan.tasks.filter((task) => task.phaseKey === phase.key)}
          milestones={plan.milestones.filter((m) => m.phaseKey === phase.key)}
          editable={editable}
        />
      ))}
      {unphased.length > 0 ? (
        <section className="card">
          <CardHeader
            title="Other work"
            description="Tasks added outside the kickoff plan."
          />
          <TaskTable model={model} tasks={unphased} />
        </section>
      ) : null}
    </div>
  );
}

function PhaseCard({
  model,
  phase,
  open,
  tasks,
  milestones,
  editable,
}: {
  model: Ready;
  phase: Phase;
  open: boolean;
  tasks: PlanTask[];
  milestones: Milestone[];
  editable: boolean;
}) {
  return (
    <section className="card phase-card" aria-labelledby={`phase-${phase.key}`}>
      <div className="phase-head">
        <div>
          <h2 id={`phase-${phase.key}`}>{phase.name}</h2>
          <p className="card-desc">
            {formatDate(phase.plannedStart)} to {formatDate(phase.plannedEnd)}
            {milestones.length > 0
              ? ` · ${milestones.map((m) => `${m.name} ${formatDate(m.dueDate)}`).join(" · ")}`
              : ""}
          </p>
        </div>
        <div className="phase-meta">
          <span className={`pill pill-dot ${PHASE_TONE[phase.status]}`}>
            {PHASE_STATUS[phase.status]}
          </span>
          <span className="phase-progress">
            <Meter
              value={percent(phase.done, phase.tasks)}
              tone={phase.status === "AT_RISK" ? "tone-danger" : "tone-success"}
            />
            <span className="num">
              {phase.done}/{phase.tasks}
            </span>
          </span>
        </div>
      </div>
      {tasks.length === 0 ? (
        <p className="phase-empty form-hint">
          {phase.key === "PLANNING"
            ? "Completed during setup: scope, period, team, controls, systems, workpaper templates, and the evidence request plan."
            : phase.key === "ROLLFORWARD" || phase.key === "REMEDIATION"
              ? "Tasks are added when interim testing is reviewed and its results are known."
              : "No tasks in this phase yet."}
        </p>
      ) : (
        <details className="phase-tasks" open={open}>
          <summary>
            {tasks.length} task{tasks.length === 1 ? "" : "s"}
            {phase.overdue > 0 ? ` · ${phase.overdue} overdue` : ""}
          </summary>
          <TaskTable model={model} tasks={tasks} />
        </details>
      )}
      {editable ? (
        <details className="phase-edit">
          <summary>Change dates</summary>
          <form
            autoComplete="off"
            method="post"
            action="/workspace/engagement"
            className="toolbar"
          >
            <Identity model={model} intent="phase" section="plan" />
            <input type="hidden" name="phase_key" value={phase.key} />
            <input type="hidden" name="version" value={phase.version} />
            <label htmlFor={`start-${phase.key}`}>
              Start
              <input
                id={`start-${phase.key}`}
                type="date"
                name="planned_start"
                defaultValue={phase.plannedStart}
                required
              />
            </label>
            <label htmlFor={`end-${phase.key}`}>
              End
              <input
                id={`end-${phase.key}`}
                type="date"
                name="planned_end"
                defaultValue={phase.plannedEnd}
                required
              />
            </label>
            <button type="submit" className="btn-sm">
              Save dates
            </button>
            <span className="form-hint">
              Open tasks due at the phase end move with it.
            </span>
          </form>
        </details>
      ) : null}
    </section>
  );
}

function TaskTable({ model, tasks }: { model: Ready; tasks: PlanTask[] }) {
  const now = Date.now();
  return (
    <div className="table-wrap">
      <table className="table table-links plan-table">
        <thead>
          <tr>
            <th scope="col">Task</th>
            <th scope="col">Assigned</th>
            <th scope="col">Due</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const late =
              task.deadline !== null &&
              Date.parse(task.deadline) < now &&
              task.status !== "SUCCEEDED" &&
              task.status !== "CANCELLED";
            return (
              <tr key={task.id}>
                <td>
                  <div className="cell-request">
                    {task.controlRef !== null ? (
                      <span className="mono item-ref">{task.controlRef}</span>
                    ) : null}
                    <a className="row-link" href={taskHref(model, task.id)}>
                      {task.title}
                    </a>
                    {task.waitingOn > 0 ? (
                      <small>
                        Waiting on {task.waitingOn} earlier task
                        {task.waitingOn === 1 ? "" : "s"}
                      </small>
                    ) : null}
                  </div>
                </td>
                <td>
                  {task.agent ?? task.assignee ?? (
                    <span className="cell-sub">Unassigned</span>
                  )}
                </td>
                <td>
                  {task.deadline === null ? (
                    <span className="cell-sub">No date</span>
                  ) : (
                    <time
                      dateTime={task.deadline}
                      className={late ? "pill pill-dot tone-danger" : "num"}
                    >
                      {formatDate(task.deadline)}
                    </time>
                  )}
                </td>
                <td>
                  <StatusPill status={task.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Timeline

export function TimelineMain({
  model,
  engagement,
}: {
  model: Ready;
  engagement: EngagementState;
}) {
  const project = model.selectedProject;
  const plan = engagement.plan;
  if (project === null) {
    return null;
  }
  if (plan === null) {
    return (
      <div className="page">
        <PageHeader context={project.name} title="Timeline" />
        <Unavailable what="timeline" />
      </div>
    );
  }
  if (!plan.started) {
    return (
      <div className="page">
        <PageHeader context={project.name} title="Timeline" />
        <NotStarted model={model} what="timeline" />
      </div>
    );
  }
  const dates = [
    ...plan.phases.flatMap((phase) => [phase.plannedStart, phase.plannedEnd]),
    ...plan.milestones.map((m) => m.dueDate),
  ].filter((value) => value !== "");
  const start = dates.reduce(
    (min, value) => (value < min ? value : min),
    dates[0] ?? "",
  );
  const end = dates.reduce(
    (max, value) => (value > max ? value : max),
    dates[0] ?? "",
  );
  const today = new Date().toISOString().slice(0, 10);
  const editable = canManageProjects(model.organization.role);
  return (
    <div className="page">
      <PageHeader
        context={project.name}
        title="Timeline"
        description={
          plan.periodEnd !== null
            ? `The engagement calendar for the fiscal year ending ${formatDate(plan.periodEnd)}: phases, the interim testing date, year-end roll-forward, and sign-off.`
            : "The engagement calendar."
        }
        actions={
          <a className="btn btn-secondary" href={pageHref(model, "plan")}>
            Project plan
          </a>
        }
      />
      <Notice notice={engagement.notice} />
      <PlanMissing model={model} plan={plan} section="timeline" />
      {plan.phases.length > 0 ? (
        <section className="card" aria-label="Gantt chart">
          <div className="gantt">
            <div className="gantt-scale">
              <span className="gantt-label" />
              <span className="gantt-track">
                {timelineMonths(start, end).map((month) => (
                  <span
                    key={`${month.label}-${month.at}`}
                    className="gantt-month"
                    style={{ left: `${month.at}%` }}
                  >
                    {month.label}
                    {month.year !== null ? <small>{month.year}</small> : null}
                  </span>
                ))}
              </span>
            </div>
            {plan.phases.map((phase) => {
              const left = timelinePercent(phase.plannedStart, start, end);
              const width = Math.max(
                1,
                timelinePercent(phase.plannedEnd, start, end) - left,
              );
              const marks = plan.milestones.filter(
                (m) => m.phaseKey === phase.key,
              );
              return (
                <div key={phase.key} className="gantt-row">
                  <span className="gantt-label">
                    <strong>{phase.name}</strong>
                    <small>
                      {formatDate(phase.plannedStart)} to{" "}
                      {formatDate(phase.plannedEnd)}
                    </small>
                  </span>
                  <span className="gantt-track">
                    <span
                      className={`gantt-bar gantt-${phase.status.toLowerCase()}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    >
                      <span className="gantt-bar-text">
                        {phase.tasks > 0 ? `${phase.done}/${phase.tasks}` : ""}
                      </span>
                    </span>
                    {marks.map((mark) => (
                      <span
                        key={mark.key}
                        className={`gantt-milestone milestone-${mark.status.toLowerCase()}`}
                        style={{
                          left: `${timelinePercent(mark.dueDate, start, end)}%`,
                        }}
                        title={`${mark.name}: ${formatDate(mark.dueDate)}`}
                      />
                    ))}
                    {today >= start && today <= end ? (
                      <span
                        className="gantt-today"
                        style={{
                          left: `${timelinePercent(today, start, end)}%`,
                        }}
                      />
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
          <ul className="legend gantt-legend">
            <li>
              <span className="swatch gantt-not_started" />
              Not started
            </li>
            <li>
              <span className="swatch gantt-in_progress" />
              In progress
            </li>
            <li>
              <span className="swatch gantt-at_risk" />
              At risk
            </li>
            <li>
              <span className="swatch gantt-done" />
              Done
            </li>
            <li>
              <span className="swatch swatch-milestone" />
              Milestone
            </li>
            <li>
              <span className="swatch swatch-today" />
              Today
            </li>
          </ul>
        </section>
      ) : null}
      <section className="card" aria-labelledby="milestone-table">
        <CardHeader
          title="Milestones"
          titleId="milestone-table"
          description="Key dates the engagement is held to."
        />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Milestone</th>
                <th scope="col">Phase</th>
                <th scope="col">Due</th>
                <th scope="col">Status</th>
                {editable ? (
                  <th scope="col" className="cell-end">
                    <span className="sr-only">Update</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {plan.milestones.map((milestone) => (
                <tr key={milestone.key}>
                  <td>
                    <strong>{milestone.name}</strong>
                  </td>
                  <td className="cell-sub">
                    {plan.phases.find((p) => p.key === milestone.phaseKey)
                      ?.name ?? ""}
                  </td>
                  <td className="num">{formatDate(milestone.dueDate)}</td>
                  <td>
                    <span
                      className={`pill pill-dot ${MILESTONE_TONE[milestone.status]}`}
                    >
                      {MILESTONE_STATUS[milestone.status]}
                    </span>
                  </td>
                  {editable ? (
                    <td className="cell-end">
                      <details className="milestone-edit">
                        <summary className="btn btn-ghost btn-sm">
                          <span className="when-closed">
                            Change
                            <span className="sr-only"> {milestone.name}</span>
                          </span>
                          <span className="when-open">
                            Cancel
                            <span className="sr-only">
                              {" "}
                              changing {milestone.name}
                            </span>
                          </span>
                        </summary>
                        <form
                          autoComplete="off"
                          method="post"
                          action="/workspace/engagement"
                          className="milestone-form"
                        >
                          <Identity
                            model={model}
                            intent="milestone"
                            section="timeline"
                          />
                          <input
                            type="hidden"
                            name="milestone_key"
                            value={milestone.key}
                          />
                          <input
                            type="hidden"
                            name="version"
                            value={milestone.version}
                          />
                          <input
                            type="date"
                            name="due_date"
                            defaultValue={milestone.dueDate}
                            aria-label={`Due date for ${milestone.name}`}
                            required
                          />
                          <label
                            className="check"
                            htmlFor={`done-${milestone.key}`}
                          >
                            <input
                              id={`done-${milestone.key}`}
                              type="checkbox"
                              name="completed"
                              defaultChecked={milestone.completedAt !== null}
                            />
                            Done
                          </label>
                          <button type="submit" className="btn-sm">
                            Save
                          </button>
                        </form>
                      </details>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// Deficiencies

export function DeficienciesMain({
  model,
  engagement,
  logFor,
}: {
  model: Ready;
  engagement: EngagementState;
  logFor: string | null;
}) {
  const project = model.selectedProject;
  if (project === null) {
    return null;
  }
  const items = engagement.deficiencies;
  if (items === null) {
    return (
      <div className="page">
        <PageHeader context={project.name} title="Deficiencies" />
        <Unavailable what="deficiency register" />
      </div>
    );
  }
  const controls = (engagement.controls ?? []).filter(
    (control) => control.included,
  );
  const open = items.filter((item) => item.status !== "CLOSED");
  const selected =
    items.find((item) => item.id === engagement.filters.deficiency) ?? null;
  const count = (severity: string) =>
    open.filter((item) => item.severity === severity).length;
  return (
    <div className="page">
      <PageHeader
        context={project.name}
        title="Deficiencies"
        description="Every deficiency found, its severity, and its remediation. The engagement reviewer approves significant deficiencies, material weaknesses, and every closure."
      />
      <Notice notice={engagement.notice} />
      <section className="kpis kpis-five" aria-label="Deficiency summary">
        <Metric
          icon="risk"
          label="Material weaknesses"
          value={count("MATERIAL_WEAKNESS")}
          detail={count("MATERIAL_WEAKNESS") > 0 ? "Open" : "None open"}
          tone={count("MATERIAL_WEAKNESS") > 0 ? "risk" : "positive"}
        />
        <Metric
          icon="risk"
          label="Significant deficiencies"
          value={count("SIGNIFICANT_DEFICIENCY")}
          detail={count("SIGNIFICANT_DEFICIENCY") > 0 ? "Open" : "None open"}
          tone={count("SIGNIFICANT_DEFICIENCY") > 0 ? "risk" : "positive"}
        />
        <Metric
          icon="info"
          label="Control deficiencies"
          value={count("CONTROL_DEFICIENCY")}
          detail="Open"
        />
        <Metric
          icon="shield"
          label="Waiting for reviewer"
          value={open.filter((item) => item.pending !== null).length}
          detail="Severity or closure"
        />
        <Metric
          icon="check"
          label="Closed"
          value={items.length - open.length}
          detail={`of ${items.length} logged`}
        />
      </section>
      {selected !== null ? (
        <DeficiencyDetail model={model} item={selected} controls={controls} />
      ) : null}
      <section className="card" aria-labelledby="log-title">
        <details className="log-deficiency" open={logFor !== null}>
          <summary>
            <span className="log-deficiency-icon" aria-hidden="true">
              <UiIcon name="plus" size={14} />
            </span>
            <span>
              <strong id="log-title">Log a deficiency</strong>
              <small className="cell-sub">
                Condition, criteria, cause, and effect, then its severity.
              </small>
            </span>
            <UiIcon name="chevron" size={15} />
          </summary>
          <DeficiencyForm
            model={model}
            controls={controls}
            item={null}
            control={logFor}
          />
        </details>
      </section>
      <section className="card" aria-labelledby="deficiency-register">
        <CardHeader
          title="Register"
          titleId="deficiency-register"
          aside={<span className="num">{items.length} logged</span>}
        />
        {items.length === 0 ? (
          <EmptyState
            icon="check"
            title="No deficiencies logged"
            detail="Deficiencies from walkthroughs and testing appear here."
          />
        ) : (
          <div className="table-wrap">
            <table className="table table-links">
              <thead>
                <tr>
                  <th scope="col">Deficiency</th>
                  <th scope="col">Type</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Status</th>
                  <th scope="col">Remediation</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    aria-current={item.id === selected?.id ? "true" : undefined}
                  >
                    <td>
                      <div className="cell-request">
                        <span className="mono item-ref">
                          {item.reference}
                          {item.controlLabel !== null
                            ? ` · ${item.controlLabel}`
                            : ""}
                        </span>
                        <a
                          className="row-link"
                          href={pageHref(model, "deficiencies", {
                            deficiency: item.id,
                          })}
                        >
                          {item.title}
                        </a>
                        <small>
                          Logged {formatDate(item.identifiedAt)} by{" "}
                          {item.identifiedBy}
                        </small>
                      </div>
                    </td>
                    <td>{item.type === "DESIGN" ? "Design" : "Operating"}</td>
                    <td>
                      <span className="cell-stack">
                        <span
                          className={`pill pill-dot ${SEVERITY_TONE[item.severity]}`}
                        >
                          {SEVERITY_LABEL[item.severity]}
                        </span>
                        {item.pending !== null ? (
                          <small className="cell-sub">
                            Pending:{" "}
                            {item.pending.kind === "CLOSE"
                              ? "closure"
                              : SEVERITY_LABEL[item.pending.severity ?? ""]}
                          </small>
                        ) : null}
                      </span>
                    </td>
                    <td>{STATUS_LABEL[item.status]}</td>
                    <td>
                      <span className="cell-stack">
                        <span>
                          {item.remediationOwner || (
                            <span className="cell-sub">No owner</span>
                          )}
                        </span>
                        {item.remediationDue !== null ? (
                          <small className="cell-sub">
                            Due {formatDate(item.remediationDue)}
                          </small>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function DeficiencyForm({
  model,
  controls,
  item,
  control,
}: {
  model: Ready;
  controls: ControlRow[];
  item: Deficiency | null;
  control: string | null;
}) {
  const id = item?.id ?? "new";
  return (
    <form
      autoComplete="off"
      method="post"
      action="/workspace/engagement"
      className="form deficiency-form"
    >
      <Identity
        model={model}
        intent={item === null ? "deficiency-create" : "deficiency-update"}
        section="deficiencies"
      />
      {item !== null ? (
        <>
          <input type="hidden" name="deficiency_id" value={item.id} />
          <input type="hidden" name="version" value={item.version} />
        </>
      ) : null}
      <label htmlFor={`d-title-${id}`} className="field-wide">
        Title
        <input
          id={`d-title-${id}`}
          name="title"
          required
          maxLength={200}
          defaultValue={item?.title ?? ""}
          placeholder="Two of 25 new users were granted access without approval"
        />
      </label>
      {item === null ? (
        <label htmlFor={`d-control-${id}`}>
          Control
          <select
            id={`d-control-${id}`}
            name="control_id"
            defaultValue={control ?? ""}
          >
            <option value="">Not tied to one control</option>
            {controls.map((c) => (
              <option key={c.id} value={c.id}>
                {c.controlRef} {c.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label htmlFor={`d-type-${id}`}>
        Type
        <select
          id={`d-type-${id}`}
          name="deficiency_type"
          defaultValue={item?.type ?? "OPERATING"}
        >
          <option value="OPERATING">
            Operating: the control did not operate as designed
          </option>
          <option value="DESIGN">
            Design: the control cannot meet its objective
          </option>
        </select>
      </label>
      {(
        [
          ["condition", "Condition", "What was found."],
          ["criteria", "Criteria", "What should have happened."],
          ["cause", "Cause", "Why it happened."],
          ["effect", "Effect", "The risk or misstatement it could lead to."],
        ] as const
      ).map(([name, label, hint]) => (
        <label key={name} htmlFor={`d-${name}-${id}`} className="field-wide">
          {label}
          <textarea
            id={`d-${name}-${id}`}
            name={name}
            rows={2}
            maxLength={4000}
            defaultValue={item?.[name] ?? ""}
            placeholder={hint}
          />
        </label>
      ))}
      <label htmlFor={`d-likelihood-${id}`}>
        Likelihood of a misstatement
        <select
          id={`d-likelihood-${id}`}
          name="likelihood"
          defaultValue={item?.likelihood ?? "REASONABLY_POSSIBLE"}
        >
          {LIKELIHOODS.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`d-magnitude-${id}`}>
        Magnitude
        <select
          id={`d-magnitude-${id}`}
          name="magnitude"
          defaultValue={item?.magnitude ?? "MORE_THAN_INCONSEQUENTIAL"}
        >
          {MAGNITUDES.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {item === null ? (
        <label htmlFor={`d-severity-${id}`} className="field-wide">
          Severity
          <select
            id={`d-severity-${id}`}
            name="severity"
            defaultValue="CONTROL_DEFICIENCY"
          >
            {SEVERITIES.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <span className="form-hint">
            A significant deficiency or material weakness stays a control
            deficiency until the engagement reviewer approves it.
          </span>
        </label>
      ) : null}
      <label htmlFor={`d-compensating-${id}`} className="field-wide">
        Compensating controls
        <textarea
          id={`d-compensating-${id}`}
          name="compensating_controls"
          rows={2}
          maxLength={4000}
          defaultValue={item?.compensating ?? ""}
          placeholder="Controls that reduce the risk, and whether they were tested."
        />
      </label>
      <label htmlFor={`d-owner-${id}`}>
        Remediation owner
        <input
          id={`d-owner-${id}`}
          name="remediation_owner"
          maxLength={200}
          defaultValue={item?.remediationOwner ?? ""}
        />
      </label>
      <label htmlFor={`d-due-${id}`}>
        Remediation due
        <input
          id={`d-due-${id}`}
          type="date"
          name="remediation_due"
          defaultValue={item?.remediationDue ?? ""}
        />
      </label>
      <label htmlFor={`d-plan-${id}`} className="field-wide">
        Remediation plan
        <textarea
          id={`d-plan-${id}`}
          name="remediation_plan"
          rows={2}
          maxLength={4000}
          defaultValue={item?.remediationPlan ?? ""}
        />
      </label>
      <div className="form-actions">
        <button type="submit">
          {item === null ? "Log deficiency" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function DeficiencyDetail({
  model,
  item,
  controls,
}: {
  model: Ready;
  item: Deficiency;
  controls: ControlRow[];
}) {
  const closed = item.status === "CLOSED";
  return (
    <section
      className="card control-editor"
      aria-labelledby="deficiency-detail-title"
    >
      <CardHeader
        title={`${item.reference} ${item.title}`}
        titleId="deficiency-detail-title"
        description={
          <>
            {item.controlLabel !== null ? `${item.controlLabel} · ` : ""}
            {item.type === "DESIGN"
              ? "Design deficiency"
              : "Operating deficiency"}{" "}
            · {LIKELIHOOD_LABEL[item.likelihood]} likelihood,{" "}
            {MAGNITUDE_LABEL[item.magnitude]?.toLowerCase()} magnitude
          </>
        }
        aside={
          <span className="cell-stack">
            <span className={`pill pill-dot ${SEVERITY_TONE[item.severity]}`}>
              {SEVERITY_LABEL[item.severity]}
            </span>
            <a className="text-link" href={pageHref(model, "deficiencies")}>
              Close
            </a>
          </span>
        }
      />
      <div className="card-body stack">
        {item.suggestedSeverity !== item.severity &&
        item.pending === null &&
        !closed ? (
          <Banner>
            Likelihood and magnitude suggest a{" "}
            {SEVERITY_LABEL[item.suggestedSeverity]?.toLowerCase()}. Request a
            severity change below if you agree.
          </Banner>
        ) : null}
        {item.pending !== null ? (
          <div className="pending-change">
            <div>
              <strong>
                Waiting for the reviewer:{" "}
                {item.pending.kind === "CLOSE"
                  ? "close this deficiency"
                  : `change severity to ${SEVERITY_LABEL[item.pending.severity ?? ""]?.toLowerCase()}`}
              </strong>
              <p className="form-hint">{item.pending.reason}</p>
            </div>
            {item.canDecide ? (
              <form
                autoComplete="off"
                method="post"
                action="/workspace/engagement"
                className="toolbar"
              >
                <Identity
                  model={model}
                  intent="deficiency-decide"
                  section="deficiencies"
                />
                <input type="hidden" name="deficiency_id" value={item.id} />
                <input type="hidden" name="version" value={item.version} />
                <label htmlFor="decide-reason">
                  Note
                  <input id="decide-reason" name="reason" maxLength={1000} />
                </label>
                <button
                  type="submit"
                  name="decision"
                  value="approve"
                  className="btn-sm"
                >
                  Approve
                </button>
                <button
                  type="submit"
                  name="decision"
                  value="reject"
                  className="btn-secondary btn-sm"
                >
                  Reject
                </button>
              </form>
            ) : (
              <span className="form-hint">
                Only the engagement reviewer, who did not ask for it, can
                decide.
              </span>
            )}
          </div>
        ) : null}
        <dl className="facts facts-wide">
          {(
            [
              ["Condition", item.condition],
              ["Criteria", item.criteria],
              ["Cause", item.cause],
              ["Effect", item.effect],
              ["Compensating controls", item.compensating],
              ["Remediation plan", item.remediationPlan],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value || <span className="cell-sub">Not recorded</span>}</dd>
            </div>
          ))}
          <div>
            <dt>Status</dt>
            <dd>
              {STATUS_LABEL[item.status]}
              {item.remediatedOn !== null
                ? ` · fixed ${formatDate(item.remediatedOn)}`
                : ""}
              {item.retestResult !== "NOT_STARTED"
                ? ` · retest ${item.retestResult.toLowerCase()} ${item.retestedAt ? formatDate(item.retestedAt) : ""}`
                : ""}
            </dd>
          </div>
        </dl>
        {!closed ? (
          <div className="deficiency-actions">
            <form
              autoComplete="off"
              method="post"
              action="/workspace/engagement"
              className="toolbar"
            >
              <Identity
                model={model}
                intent="deficiency-progress"
                section="deficiencies"
              />
              <input type="hidden" name="deficiency_id" value={item.id} />
              <input type="hidden" name="version" value={item.version} />
              {item.status === "OPEN" ? (
                <button
                  type="submit"
                  name="status"
                  value="REMEDIATION_IN_PROGRESS"
                  className="btn-sm"
                >
                  Start remediation
                </button>
              ) : null}
              {item.status === "REMEDIATION_IN_PROGRESS" ? (
                item.controlId !== null ? (
                  <>
                    <label htmlFor={`fixed-${item.id}`}>
                      Fix took effect on
                      <input
                        id={`fixed-${item.id}`}
                        type="date"
                        name="remediated_on"
                        required
                        max={new Date().toISOString().slice(0, 10)}
                        defaultValue={item.remediatedOn ?? ""}
                      />
                    </label>
                    <button
                      type="submit"
                      name="status"
                      value="READY_FOR_RETEST"
                      className="btn-sm"
                    >
                      Ready for retest
                    </button>
                  </>
                ) : (
                  <button
                    type="submit"
                    name="status"
                    value="READY_FOR_RETEST"
                    className="btn-sm"
                  >
                    Ready for retest
                  </button>
                )
              ) : null}
              {item.status === "READY_FOR_RETEST" ? (
                <>
                  <button
                    type="submit"
                    name="retest_result"
                    value="PASSED"
                    className="btn-sm"
                  >
                    Retest passed
                  </button>
                  <button
                    type="submit"
                    name="retest_result"
                    value="FAILED"
                    className="btn-secondary btn-sm"
                  >
                    Retest failed
                  </button>
                </>
              ) : null}
            </form>
            {item.pending === null ? (
              <form
                autoComplete="off"
                method="post"
                action="/workspace/engagement"
                className="toolbar"
              >
                <Identity
                  model={model}
                  intent="deficiency-change"
                  section="deficiencies"
                />
                <input type="hidden" name="deficiency_id" value={item.id} />
                <input type="hidden" name="version" value={item.version} />
                <label htmlFor="change-kind">
                  Request
                  <select id="change-kind" name="kind" defaultValue="SEVERITY">
                    <option value="SEVERITY">Severity change</option>
                    <option value="CLOSE">Closure</option>
                  </select>
                </label>
                <label htmlFor="change-severity">
                  New severity
                  <select
                    id="change-severity"
                    name="severity"
                    defaultValue={item.suggestedSeverity}
                  >
                    {SEVERITIES.map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="change-reason">
                  Reason
                  <input
                    id="change-reason"
                    name="reason"
                    required
                    maxLength={1000}
                  />
                </label>
                <button type="submit" className="btn-secondary btn-sm">
                  Request
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
        {!closed ? (
          <details>
            <summary>Edit the deficiency</summary>
            <DeficiencyForm
              model={model}
              controls={controls}
              item={item}
              control={null}
            />
          </details>
        ) : null}
      </div>
    </section>
  );
}
