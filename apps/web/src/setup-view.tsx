import type { ReactNode } from "react";
import { AddProcessButton } from "./add-process-wizard";
import { AutoRefresh } from "./auto-refresh";
import { ConfirmAction, OnceForm } from "./confirm-action";
import {
  ControlsAddMenu,
  ControlsSetupFrame,
  ControlsTour,
  RcmInsteadButton,
} from "./controls-guide";
import {
  ADD_SYSTEM_EVENT,
  controlsTiles,
  controlsTourSteps,
  FINALIZE_EVENT,
  parseControlsPane,
  RCM_UPLOAD_EVENT,
  SELECT_CONTROLS_EVENT,
  scopeReview,
  scopeSteps,
} from "./controls-guide-model";
import { ControlsPage, type ScopeAction } from "./controls-page";
import { toPageRow } from "./controls-page-model";
import { DraftingShow } from "./drafting-show";
import { editEngagementHref } from "./engagement-create";
import {
  type EngagementPhase,
  engagementPhase,
  launchStepLabel,
  scopeOpen,
  setupHeadAction,
  setupOpen,
} from "./engagement-lifecycle";
import type { EngagementState } from "./engagement-model";
import { OptionalMark, RequiredMark } from "./field-marks";
import { agentMonogram, formatDate, initials } from "./format";
import { NewControlForm } from "./new-control-form";
import {
  inScopeSystems,
  type LaunchNext,
  type LaunchSummary,
  launchNextSteps,
  launchReport,
  METHODOLOGIES,
  methodologyLabel,
  type Onboarding,
  openConflicts,
  type PlanItem,
  PROCESS_CYCLES,
  pendingSuggestions,
  type RcmImport,
  SETUP_STEPS,
  type SetupControl,
  type SetupState,
  type SetupStep,
  type SetupSystem,
  setupAttention,
  setupProgress,
  stepReadiness,
  stepStatusLabel,
  teamPeople,
  WORK_STEPS,
} from "./onboarding-model";
import {
  Identity,
  NOTICES,
  RcmStep,
  ROLE_LABELS,
  SocReportsCard,
  setupHref,
  WorkpapersStep,
} from "./onboarding-view";
import { PeriodDates } from "./period-dates";
import { ProcessesTable, scopedProcesses } from "./process-view";
import { RecordDialog } from "./record-dialog";
import { PoliciesPane, ReferencesPane } from "./references-view";
import { SaveWhenChanged } from "./save-when-changed";
import {
  FinalizeScope,
  OpenScopeAction,
  RcmSteps,
  RcmUpload,
  SelectControls,
} from "./scope-actions";
import { type ControlsFor, parseControlsFor } from "./scope-controls-model";
import { removalNote } from "./scoped-controls";
import { guidedStep, ONBOARDING_STEPS } from "./setup-guide-model";
import { ControlsAssistant, SetupAgent, SetupCycle } from "./setup-guide-view";
import { impactHref } from "./setup-impact-model";
import { canManageProjects, type ShellModel } from "./shell-model";
import { StandardMatchesCard } from "./standard-matches";
import { SystemWizard } from "./system-wizard";
import { OutOfScopeSystems, SystemsTable } from "./systems-view";
import { type IconName, UiIcon } from "./ui-icon";
import {
  Banner,
  CardHeader,
  EmptyState,
  PageHeader,
  StatusPill,
  sectionHref,
} from "./workspace-view";

type Ready = Extract<ShellModel, { status: "ready" }>;

const AREA_LABEL: Record<string, string> = {
  ACCESS: "Logical access",
  CHANGE: "Change management",
  OPERATIONS: "IT operations",
  ITAC: "Application controls",
  IPE: "Key reports and IPE",
  ENTITY: "Entity-level",
  ORDER_TO_CASH: "Order to cash",
  PROCURE_TO_PAY: "Procure to pay",
  RECORD_TO_REPORT: "Record to report",
  TREASURY: "Treasury",
  HIRE_TO_RETIRE: "Hire to retire",
  INVENTORY: "Inventory",
  FIXED_ASSETS: "Fixed assets",
  TAX: "Tax",
  OTHER_BUSINESS: "Other business process",
};

const KIND_LABELS: Record<string, string> = {
  walkthrough: "Walkthroughs",
  evidence: "Evidence tasks",
  test: "Tests",
  review: "Reviews",
  report: "Report",
};

/** What the agents do with the setup, told once on the overview and the launch page. */
const AGENT_WORK: ReadonlyArray<[string, string]> = [
  [
    "Engagement planner",
    "Drafts the scope now, and at launch records each control's evidence plan for you to approve.",
  ],
  [
    "Evidence coordinator",
    "Drafts a request once you approve a control's plan, matches what comes back, and chases what is late.",
  ],
  [
    "Testers",
    "Walk through each control, test the evidence against its attributes, and propose results for you to sign off.",
  ],
  ["Independent reviewer", "Independently reviews every prepared workpaper."],
];

// The shell

export function SetupMain({
  model,
  setup,
  guided = false,
}: {
  model: Ready;
  setup: SetupState;
  /** Onboarding, before launch (decided by the product owner): the cycle across the
   * top and the setup agent beside each step, in place of the header and the rail. */
  guided?: boolean;
}) {
  const project = model.selectedProject;
  if (project === null) {
    return (
      <div className="page">
        <section className="card">
          <EmptyState
            icon="briefcase"
            title="Choose an engagement first"
            detail="Create or select an engagement to set it up."
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
  const onboarding = setup.onboarding;
  if (onboarding === null) {
    return (
      <div className="page">
        <Banner tone="warning">
          The engagement setup could not be loaded. Refresh to try again.
        </Banner>
      </div>
    );
  }
  // After launch the scope (systems and controls) and the team stay open; the rest locks.
  // Archived is closed: nothing changes (engagement-lifecycle.ts).
  const phase = phaseOf(onboarding);
  const manages = canManageProjects(model.organization.role);
  const editable = manages && setupOpen(phase);
  const scopeEditable = manages && scopeOpen(phase);
  const drafting = onboarding.setupDraft?.drafting === true;
  // Onboarding opens on the first step with something to do, not an overview.
  const step = guided ? guidedStep(onboarding, setup.step) : setup.step;
  const content = (
    <div className="stack setup-content">
      {/* In onboarding the agent states the outcome and what is left. */}
      {!guided && step !== "overview" && step !== "launch" ? (
        <StepBrief onboarding={onboarding} step={step} />
      ) : null}
      {step === "overview" ? (
        <OverviewStep
          model={model}
          onboarding={onboarding}
          editable={editable}
        />
      ) : step === "profile" ? (
        <ProfileStep
          model={model}
          onboarding={onboarding}
          editable={editable}
          confirmable={scopeEditable}
          guided={guided}
        />
      ) : step === "team" ? (
        <TeamStep
          model={model}
          onboarding={onboarding}
          editable={scopeEditable}
        />
      ) : step === "controls" ? (
        <ControlsStep
          model={model}
          onboarding={onboarding}
          editable={scopeEditable}
          setup={setup}
        />
      ) : step === "workpapers" ? (
        <WorkpapersStep
          model={model}
          onboarding={onboarding}
          editable={scopeEditable}
          setup={setup}
        />
      ) : (
        <LaunchStep
          model={model}
          onboarding={onboarding}
          editable={editable}
          phase={phase}
        />
      )}
      {step !== "overview" && !(step === "launch" && onboarding.started) ? (
        <StepFooter
          model={model}
          onboarding={onboarding}
          step={step}
          phase={phase}
          guided={guided}
        />
      ) : null}
    </div>
  );
  return (
    <div className={`page setup-page${guided ? " is-guided" : ""}`}>
      {drafting ? <AutoRefresh /> : null}
      {guided ? (
        <OnboardingHead model={model} onboarding={onboarding} />
      ) : (
        <SetupHeader
          model={model}
          onboarding={onboarding}
          step={step}
          phase={phase}
        />
      )}
      {/* In onboarding the agent says the engagement is created; no banner repeats it. */}
      {guided && setup.notice === "setup-created" ? null : setup.notice ===
          "setup-launched" &&
        onboarding.started &&
        onboarding.launch !== null ? (
        <LaunchedDialog model={model} onboarding={onboarding} />
      ) : setup.notice !== null ? (
        <Banner
          tone={
            setup.notice === "setup-saved" ||
            setup.notice === "setup-launched" ||
            setup.notice === "setup-already-launched" ||
            setup.notice === "setup-launch-slow" ||
            setup.notice === "setup-rcm-uploaded" ||
            setup.notice === "setup-rcm-imported" ||
            setup.notice === "setup-drafting" ||
            setup.notice === "setup-period-confirmed" ||
            setup.notice === "setup-accepted"
              ? "info"
              : "warning"
          }
        >
          {NOTICES[setup.notice]}
        </Banner>
      ) : null}
      {phase === "closed" ? (
        <Banner>
          This engagement is archived. It is closed, and its setup is kept as it
          was.
        </Banner>
      ) : phase === "completed" ? (
        <Banner>
          This engagement is completed and read-only. An owner or admin can
          reopen it under Engagements.
        </Banner>
      ) : !manages && setupOpen(phase) ? (
        <Banner>
          You can follow setup. A project manager, admin, or owner makes the
          changes.
        </Banner>
      ) : null}
      {guided ? (
        <>
          <SetupCycle model={model} onboarding={onboarding} current={step} />
          <div className="onb-layout">
            {content}
            <div className="onb-agent">
              <SetupAgent
                model={model}
                onboarding={onboarding}
                step={step}
                justCreated={setup.notice === "setup-created"}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="setup-layout">
          <SetupRail
            model={model}
            onboarding={onboarding}
            current={step}
            phase={phase}
          />
          {content}
        </div>
      )}
    </div>
  );
}

/** Onboarding's header: the engagement being set up, and the way out until launch. */
function OnboardingHead({
  model,
  onboarding,
}: {
  model: Ready;
  onboarding: Onboarding;
}) {
  return (
    <header className="onb-head">
      <div>
        <p className="page-context">Engagement onboarding</p>
        <div className="page-title">
          <h1>Set up {onboarding.projectName}</h1>
          <StatusPill status={onboarding.projectStatus} />
        </div>
        <p className="setup-head-meta">
          {onboarding.clientName !== "" ? (
            <span>{onboarding.clientName}</span>
          ) : null}
          {onboarding.periodEnd !== null ? (
            <span>
              {onboarding.periodStart !== null
                ? `Period ${formatDate(onboarding.periodStart)} to ${formatDate(onboarding.periodEnd)}`
                : `Period end ${formatDate(onboarding.periodEnd)}`}
            </span>
          ) : null}
          <span>Each step saves as it is completed</span>
        </p>
      </div>
      <a className="btn btn-secondary" href={sectionHref(model, "projects")}>
        Exit to engagements
      </a>
    </header>
  );
}

/** The engagement's place in its lifecycle, from what setup reports. */
export function phaseOf(onboarding: Onboarding): EngagementPhase {
  return engagementPhase({
    status: onboarding.projectStatus,
    started: onboarding.started,
    ready: onboarding.ready,
  });
}

function SetupHeader({
  model,
  onboarding,
  step,
  phase,
}: {
  model: Ready;
  onboarding: Onboarding;
  step: SetupStep;
  phase: EngagementPhase;
}) {
  const progress = setupProgress(onboarding);
  const percent = Math.round((progress.done / progress.total) * 100);
  const next = setupHeadAction(phase, onboarding.started, step === "launch");
  const action =
    next === "dashboard"
      ? { label: "Open the dashboard", href: sectionHref(model, "overview") }
      : next === "launch"
        ? { label: "Review and launch", href: setupHref(model, "launch") }
        : next === "continue" &&
            progress.next !== null &&
            progress.next !== step
          ? {
              label: `Continue: ${stepTitle(progress.next)}`,
              href: setupHref(model, progress.next),
            }
          : null;
  return (
    <header className="setup-head">
      <div className="setup-head-main">
        <p className="page-context">
          {phase === "setup" || phase === "ready"
            ? "Engagement setup"
            : "Engagement"}
        </p>
        <div className="page-title">
          <h1>{onboarding.projectName}</h1>
          <StatusPill status={onboarding.projectStatus} />
        </div>
        <p className="setup-head-meta">
          {onboarding.clientName !== "" ? (
            <span>{onboarding.clientName}</span>
          ) : null}
          {onboarding.periodEnd !== null ? (
            <span>
              {onboarding.periodStart !== null
                ? `Period ${formatDate(onboarding.periodStart)} to ${formatDate(onboarding.periodEnd)}`
                : `Period end ${formatDate(onboarding.periodEnd)}`}
            </span>
          ) : null}
          {onboarding.methodology !== null ? (
            <span>{methodologyLabel(onboarding.methodology)}</span>
          ) : null}
        </p>
      </div>
      <div className="setup-head-side">
        {/* A running engagement's status is its pill and the launch banner: no label. */}
        {phase === "running" ? null : (
          <div className="setup-progress">
            <span className="setup-progress-label">
              {phase === "closed" ? (
                <strong>Engagement archived</strong>
              ) : phase === "completed" ? (
                <strong>Engagement completed</strong>
              ) : phase === "paused" ? (
                <strong>Engagement paused</strong>
              ) : (
                <>
                  <strong>
                    {progress.done} of {progress.total}
                  </strong>{" "}
                  steps ready
                </>
              )}
            </span>
            {phase === "setup" || phase === "ready" ? (
              <span className="setup-meter" aria-hidden="true">
                <span style={{ width: `${percent}%` }} />
              </span>
            ) : null}
          </div>
        )}
        {action !== null ? (
          <a className="btn" href={action.href}>
            {action.label} <UiIcon name="arrow" size={15} />
          </a>
        ) : null}
      </div>
    </header>
  );
}

function stepTitle(step: SetupStep): string {
  return SETUP_STEPS.find((item) => item.id === step)?.title ?? step;
}

const STEP_SHORT: Record<SetupStep, string> = {
  overview: "Overview",
  profile: "Profile",
  team: "Team",
  controls: "Controls",
  workpapers: "Templates",
  launch: "Launch",
};

type WorkStep = Exclude<SetupStep, "overview" | "launch">;

/** Which workpaper templates the engagement uses: they apply without a confirmation. */
function templateWords(onboarding: Onboarding): string {
  return onboarding.templates.some((template) => template.source === "FIRM")
    ? "Your firm's templates and the standard ones."
    : "Standard templates.";
}

const STEP_OUTCOME: Record<WorkStep, string> = {
  profile:
    "Agree the engagement period, methodology, reporting objective, and scope narrative.",
  team: "Name who leads, prepares, and independently reviews the engagement.",
  controls:
    "Decide which systems and controls are in scope, with one accountable record for each.",
  workpapers:
    "The workpapers testing is documented in. The standard templates apply unless you customise or upload your firm's; preview them with a real control.",
};

function StepBrief({
  onboarding,
  step,
}: {
  onboarding: Onboarding;
  step: WorkStep;
}) {
  const state = stepReadiness(onboarding, step);
  return (
    <section
      className={`step-brief ${state.complete ? "is-complete" : "needs-attention"}`}
      aria-label={`${stepTitle(step)} outcome`}
    >
      <div>
        <span className="step-brief-label">Outcome</span>
        <p>{STEP_OUTCOME[step]}</p>
      </div>
      <span
        className={`pill pill-dot ${state.complete ? "tone-success" : "tone-warning"}`}
      >
        {state.complete
          ? "Ready"
          : `${state.issues.length} ${state.issues.length === 1 ? "item left" : "items left"}`}
      </span>
    </section>
  );
}

function SetupRail({
  model,
  onboarding,
  current,
  phase,
}: {
  model: Ready;
  onboarding: Onboarding;
  current: SetupStep;
  phase: EngagementPhase;
}) {
  return (
    <nav className="setup-rail card" aria-label="Setup steps">
      <ol className="setup-track">
        {SETUP_STEPS.map((step, index) => {
          const state = stepReadiness(onboarding, step.id);
          const number = WORK_STEPS.indexOf(step.id) + 1;
          const attention = !state.complete && state.issues.length > 0;
          const settled = (id: SetupStep) =>
            id === "overview" || id === "launch"
              ? onboarding.started
              : stepReadiness(onboarding, id).complete;
          const complete = settled(step.id);
          const next = SETUP_STEPS[index + 1];
          const linked = next !== undefined && complete && settled(next.id);
          const here = current === step.id;
          const tone = here
            ? "current"
            : attention
              ? "attention"
              : complete
                ? "done"
                : "ahead";
          const ready =
            step.id === "launch" && !onboarding.started && onboarding.ready;
          const status = stepStatusLabel(onboarding, step.id, phase);
          return (
            <li
              key={step.id}
              className={`track-item is-${tone}${attention ? " has-attention" : ""}${complete ? " is-complete" : ""}${linked ? " is-linked" : ""}${ready ? " is-ready" : ""}`}
            >
              <a
                href={setupHref(model, step.id)}
                aria-current={here ? "step" : undefined}
                aria-label={`${step.title}. ${status}`}
              >
                <span className="track-node" aria-hidden="true">
                  {complete && !here ? (
                    <UiIcon name="check" size={12} />
                  ) : number > 0 ? (
                    number
                  ) : (
                    <span className="track-dot" />
                  )}
                </span>
                <span className="track-label">
                  <strong>{STEP_SHORT[step.id]}</strong>
                  <small>{status}</small>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepFooter({
  model,
  onboarding,
  step,
  phase,
  guided = false,
}: {
  model: Ready;
  onboarding: Onboarding;
  step: SetupStep;
  phase: EngagementPhase;
  /** Onboarding has no overview stop: the first step leads nowhere back. */
  guided?: boolean;
}) {
  // Onboarding is the client and scope, the team, and launch; no overview stop.
  const order: SetupStep[] = guided
    ? [...ONBOARDING_STEPS, "launch"]
    : ["overview", ...WORK_STEPS, "launch"];
  const index = order.indexOf(step);
  const previous = order[index - 1];
  const next = order[index + 1];
  const state = stepReadiness(onboarding, step);
  return (
    <div className="setup-footer">
      {previous === undefined ? (
        <span />
      ) : (
        <a className="btn btn-secondary" href={setupHref(model, previous)}>
          <span className="icon-back" aria-hidden="true">
            <UiIcon name="arrow" size={15} />
          </span>{" "}
          {stepTitle(previous)}
        </a>
      )}
      {next === undefined ? null : (
        <span className="setup-footer-next">
          {state.complete || step === "launch" || !setupOpen(phase) ? null : (
            <small className="form-hint">
              {state.issues.length} launch{" "}
              {state.issues.length === 1 ? "item remains" : "items remain"}. You
              can continue and return here.
            </small>
          )}
          <a className="btn" href={setupHref(model, next)}>
            {next === "launch" ? launchStepLabel(phase) : stepTitle(next)}{" "}
            <UiIcon name="arrow" size={15} />
          </a>
        </span>
      )}
    </div>
  );
}

/** What a step still needs, and what is worth knowing. */
function StepIssues({
  onboarding,
  step,
}: {
  onboarding: Onboarding;
  step: SetupStep;
}) {
  const state = stepReadiness(onboarding, step);
  // The Team step says development mode in its own banner.
  const advisories =
    step === "team" && !onboarding.independenceRequired
      ? state.advisories.filter((note) => !note.startsWith("Development mode"))
      : state.advisories;
  // The profile step's period card lists the period's disagreements itself.
  const shown = openConflicts(onboarding.period);
  const issues =
    step === "profile"
      ? state.issues.filter((issue) => !shown.includes(issue))
      : state.issues;
  if (issues.length === 0 && advisories.length === 0) {
    return null;
  }
  return (
    <>
      {issues.length > 0 ? (
        <ul className="setup-issues" aria-label="Needed before launch">
          {issues.map((issue) => (
            <li key={issue}>
              <UiIcon name="info" size={14} />
              {issue}
            </li>
          ))}
        </ul>
      ) : null}
      {advisories.length > 0 ? (
        <ul
          className="setup-issues setup-advisories"
          aria-label="Worth knowing"
        >
          {advisories.map((note) => (
            <li key={note}>
              <UiIcon name="info" size={14} />
              {note}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

// Overview

function OverviewStep({
  model,
  onboarding,
  editable,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
}) {
  const progress = setupProgress(onboarding);
  const included = onboarding.controls.filter((control) => control.included);
  const areas = new Set(included.map((control) => control.domain));
  const lead = onboarding.team.find((member) => member.role === "LEAD");
  const reviewer = onboarding.team.find((member) => member.role === "REVIEWER");
  const draft = onboarding.setupDraft;
  const pending = pendingSuggestions(onboarding);
  const summaries: Record<SetupStep, string> = {
    overview: "",
    launch: "",
    profile:
      onboarding.scope === ""
        ? "No scope yet."
        : `${methodologyLabel(onboarding.methodology)}${onboarding.periodEnd !== null ? `, period end ${formatDate(onboarding.periodEnd)}` : ""}.`,
    team:
      onboarding.team.length === 0
        ? "No one on the team yet."
        : `Lead: ${lead?.name ?? "not set"} · Reviewer: ${reviewer?.name ?? "not set"} · ${teamPeople(onboarding.team).length} on the team`,
    controls:
      included.length === 0
        ? "No controls yet. Load the library or upload the client's RCM."
        : `${included.length} controls across ${areas.size} area${areas.size === 1 ? "" : "s"}, ${inScopeSystems(onboarding).length} system${inScopeSystems(onboarding).length === 1 ? "" : "s"}.`,
    workpapers:
      included.length === 0
        ? "Add controls first. Previews use your controls."
        : templateWords(onboarding),
  };
  return (
    <>
      <section className="card overview-hero">
        <div className="overview-hero-body">
          <div>
            <p className="page-context">
              {onboarding.started ? "Running" : "Guided setup"}
            </p>
            <h2>
              {onboarding.started
                ? `${onboarding.clientName || onboarding.projectName} is under way`
                : onboarding.ready
                  ? "Everything is ready. Review the plan and launch."
                  : progress.done === 0
                    ? `Set up ${onboarding.clientName || "the engagement"}`
                    : `${progress.total - progress.done} step${progress.total - progress.done === 1 ? "" : "s"} left before launch`}
            </h2>
            <p>
              {onboarding.started
                ? "The engagement is under way. The team, and the systems and controls in scope, can still change; the rest of the setup is locked."
                : "Each step takes a few minutes. The planner has filled in what it can; confirm or change it. Nothing is requested until you approve a control's evidence plan, and nothing is sent until an approver confirms it."}
            </p>
            <div className="form-actions overview-agent-state">
              {draft?.drafting ? (
                <span className="pill pill-dot tone-info">
                  <span className="spinner small" aria-hidden="true" /> The
                  planner is drafting the setup
                </span>
              ) : pending.scope || pending.periodEnd || pending.cadence ? (
                <span className="pill pill-dot tone-info">
                  Suggestions ready to review
                </span>
              ) : null}
            </div>
          </div>
          <aside className="overview-next" aria-label="Next setup action">
            <span className="step-brief-label">
              {onboarding.started ? "Engagement state" : "Next decision"}
            </span>
            <strong>
              {onboarding.started
                ? "Continue from the dashboard"
                : progress.next === null
                  ? "Review the engagement and launch"
                  : stepTitle(progress.next)}
            </strong>
            <p>
              {onboarding.started
                ? "Setup stays here as the engagement record."
                : progress.next === null
                  ? "Every required setup decision is complete."
                  : (stepReadiness(onboarding, progress.next).issues[0] ??
                    "Review this step and confirm it is ready.")}
            </p>
            <a
              className="btn"
              href={
                onboarding.started
                  ? sectionHref(model, "overview")
                  : setupHref(model, progress.next ?? "launch")
              }
            >
              {onboarding.started
                ? "Open dashboard"
                : progress.next === null
                  ? "Review and launch"
                  : "Open next step"}{" "}
              <UiIcon name="arrow" size={15} />
            </a>
          </aside>
        </div>
      </section>
      <div className="overview-grid">
        {WORK_STEPS.map((step, index) => {
          const state = stepReadiness(onboarding, step);
          const meta = SETUP_STEPS.find((item) => item.id === step);
          return (
            <a
              key={step}
              className={`card step-card ${state.complete ? "step-card-done" : ""}`}
              href={setupHref(model, step)}
            >
              <span className="step-card-head">
                <span className="setup-step-mark" aria-hidden="true">
                  {state.complete ? (
                    <UiIcon name="check" size={13} />
                  ) : (
                    index + 1
                  )}
                </span>
                <strong>{meta?.title}</strong>
                <span
                  className={`pill pill-dot ${state.complete ? "tone-success" : state.issues.length > 0 ? "tone-warning" : ""}`}
                >
                  {state.complete
                    ? "Ready"
                    : state.issues.length > 0
                      ? stepStatusLabel(onboarding, step, phaseOf(onboarding))
                      : "Not started"}
                </span>
              </span>
              <span className="step-card-summary">{summaries[step]}</span>
              {state.issues.length > 0 ? (
                <span className="step-card-issue">{state.issues[0]}</span>
              ) : null}
              <span className="step-card-link">
                {state.complete ? "Review" : "Open"}{" "}
                <UiIcon name="chevron" size={13} />
              </span>
            </a>
          );
        })}
      </div>
      <details className="card agent-disclosure">
        <summary>
          <span>
            <strong>How people and agents divide the work</strong>
            <small>People decide; agents prepare and propose.</small>
          </span>
          <UiIcon name="chevron" size={15} />
        </summary>
        <ul className="agent-roles">
          {AGENT_WORK.map(([name, what]) => (
            <li key={name}>
              <span className="agent-mark" aria-hidden="true">
                {agentMonogram(name)}
              </span>
              <span className="row-text">
                <span>{name}</span>
                <small>{what}</small>
              </span>
            </li>
          ))}
        </ul>
      </details>
      {editable &&
      draft !== null &&
      !draft.drafting &&
      draft.source !== "NONE" ? (
        <PlannerNote draft={draft} />
      ) : null}
    </>
  );
}

function PlannerNote({
  draft,
}: {
  draft: NonNullable<Onboarding["setupDraft"]>;
}) {
  if (draft.note === "") {
    return null;
  }
  return (
    <p className="form-hint planner-note">
      <UiIcon name="info" size={13} /> {draft.note}
    </p>
  );
}

// Step 1: profile and scope

function ProfileStep({
  model,
  onboarding,
  editable,
  confirmable,
  guided = false,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
  /** May confirm the period as recorded: before launch and while it runs. */
  confirmable: boolean;
  /** Onboarding asks only what launch needs (decided by the product owner): the optional
   * period start, fiscal year, and reporting objectives are left out. Not sent, they keep
   * whatever is recorded. */
  guided?: boolean;
}) {
  const draft = onboarding.setupDraft;
  const pending = pendingSuggestions(onboarding);
  return (
    <>
      <StepIssues onboarding={onboarding} step="profile" />
      <PeriodCheckCard
        model={model}
        onboarding={onboarding}
        confirmable={confirmable}
      />
      {/* The planner's draft shows only while it suggests something not yet taken. */}
      {editable && draft !== null && (pending.scope || pending.periodEnd) ? (
        <DraftCard
          model={model}
          onboarding={onboarding}
          step="profile"
          title="The planner's draft of the scope"
          fields={[
            pending.scope
              ? {
                  key: "scope",
                  label: "Scope",
                  value: draft.scopeText,
                  reason: draft.reasons.scope ?? "",
                }
              : null,
            pending.periodEnd && draft.periodEnd !== null
              ? {
                  key: "period_end",
                  label: "Period end",
                  value: formatDate(draft.periodEnd),
                  reason: draft.reasons.period_end ?? "",
                }
              : null,
          ]}
          empty="The scope and period match the planner's draft."
        />
      ) : null}
      <section className="card" aria-labelledby="profile-title">
        <CardHeader
          title="Engagement profile"
          titleId="profile-title"
          description={
            editable ? (
              <>
                The client, the period the controls are tested through, how the
                engagement is run, and what it covers.{" "}
                <span className="field-key">
                  <span className="field-mark" aria-hidden="true">
                    *
                  </span>{" "}
                  Required before launch.
                </span>
              </>
            ) : (
              "The client, the period the controls are tested through, how the engagement is run, and what it covers."
            )
          }
        />
        <div className="card-body">
          <form
            autoComplete="off"
            method="post"
            action="/workspace/setup"
            className="form"
          >
            <Identity
              model={model}
              onboarding={onboarding}
              intent="profile"
              step="profile"
            />
            {/* The client is one of the firm's, chosen on the engagement's form. */}
            <input
              type="hidden"
              name="client_name"
              value={onboarding.clientName}
            />
            <div className="profile-client">
              <span className="profile-client-label">Client</span>
              <strong>{onboarding.clientName || "Not chosen yet"}</strong>
              {editable ? (
                <a
                  className="text-link"
                  href={editEngagementHref(model, onboarding.projectId)}
                >
                  {onboarding.clientName === ""
                    ? "Choose the client"
                    : "Change"}
                </a>
              ) : null}
            </div>
            <label htmlFor="profile-methodology" className="field-wide">
              <span>
                Methodology
                {editable ? <RequiredMark /> : null}
              </span>
              <select
                id="profile-methodology"
                name="methodology"
                defaultValue={onboarding.methodology ?? ""}
                disabled={!editable}
              >
                {onboarding.methodology === null ? (
                  <option value="">Choose before launch</option>
                ) : null}
                {METHODOLOGIES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}: {item.detail}
                  </option>
                ))}
              </select>
              <span className="form-hint">
                Every methodology needs an independent reviewer; nobody reviews
                their own work.
              </span>
            </label>
            <PeriodDates
              start={onboarding.periodStart}
              end={onboarding.periodEnd}
              disabled={!editable}
              marked={editable}
              startShown={!guided}
              endHint={
                editable && pending.periodEnd && draft !== null ? (
                  <span className="form-hint suggestion-hint">
                    Planner suggests {formatDate(draft.periodEnd ?? "")}.{" "}
                    {draft.reasons.period_end ?? ""}
                  </span>
                ) : null
              }
            />
            {guided ? null : (
              <>
                <label htmlFor="profile-fiscal">
                  <span>
                    Fiscal year
                    {editable ? <OptionalMark /> : null}
                  </span>
                  <input
                    id="profile-fiscal"
                    name="fiscal_year"
                    maxLength={20}
                    defaultValue={onboarding.fiscalYear}
                    disabled={!editable}
                    placeholder="FY2027"
                  />
                </label>
                <label htmlFor="profile-objectives" className="field-wide">
                  <span>
                    Reporting objectives
                    {editable ? <OptionalMark /> : null}
                  </span>
                  <textarea
                    id="profile-objectives"
                    name="reporting_objectives"
                    rows={3}
                    maxLength={2000}
                    defaultValue={onboarding.reportingObjectives}
                    disabled={!editable}
                    placeholder="What the engagement reports on and to whom, such as management's assessment of ITGCs over the ERP for the audit committee."
                  />
                </label>
              </>
            )}
            <label htmlFor="setup-scope" className="field-wide">
              <span>
                Scope
                {editable ? <RequiredMark /> : null}
              </span>
              <textarea
                id="setup-scope"
                name="scope"
                rows={6}
                maxLength={4000}
                defaultValue={onboarding.scope}
                disabled={!editable}
                placeholder="SOX 404 testing of the client's IT general controls over financial reporting for fiscal year 2027: the in-scope systems, the control areas, and what the team does with each control."
              />
            </label>
            {/* Coverage comes from the controls in scope; the stored type is kept. */}
            <input
              type="hidden"
              name="engagement_type"
              value={onboarding.engagementType}
            />
            {editable ? (
              <div className="form-actions">
                <SaveWhenChanged label="Save" />
              </div>
            ) : null}
          </form>
        </div>
      </section>
    </>
  );
}

/**
 * Where the period disagrees with the engagement's own words. Nothing changes a date on
 * its own: a person corrects the name, scope, or dates, or confirms the period as recorded.
 */
function PeriodCheckCard({
  model,
  onboarding,
  confirmable,
}: {
  model: Ready;
  onboarding: Onboarding;
  confirmable: boolean;
}) {
  const period = onboarding.period;
  if (period === null) {
    return null;
  }
  const open = openConflicts(period);
  const nameYear = period.conflicts.find(
    (conflict) => conflict.kind === "NAME_YEAR" && conflict.blocking,
  );
  if (open.length === 0) {
    return period.confirmed && period.conflicts.some((c) => c.blocking) ? (
      <p className="form-hint period-confirmed">
        <UiIcon name="check" size={13} /> Period confirmed as recorded
        {period.confirmedBy !== null ? ` by ${period.confirmedBy}` : ""}
        {period.confirmedAt !== null
          ? ` on ${formatDate(period.confirmedAt)}`
          : ""}
        . Any change to the name, scope, or dates requires confirmation again.
      </p>
    ) : null;
  }
  return (
    <section className="card period-check" aria-labelledby="period-check-title">
      <div className="card-body">
        <h2 id="period-check-title">
          <UiIcon name="risk" size={16} /> Check the audit period
        </h2>
        <ul>
          {open.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
        <p className="form-hint">
          {onboarding.started
            ? "The engagement is running on the recorded period. Confirm the period if it is correct. Correcting the period of a running engagement is not yet available; if it is incorrect, contact an owner."
            : nameYear !== undefined
              ? "Correct whichever is wrong, or confirm the period as recorded. Launch is held until one of these is done."
              : "Correct the scope or the dates below if either is incorrect, or confirm the period as recorded. Launch is held until one of these is done."}
        </p>
        {/* A name that points at another year is corrected here, either way (decided by
            the product owner); before launch only, as the period is part of the plan. */}
        {confirmable && !onboarding.started && nameYear !== undefined ? (
          <div className="period-fixes">
            {nameYear.periodEndFix !== null ? (
              <form autoComplete="off" method="post" action="/workspace/setup">
                <Identity
                  model={model}
                  onboarding={onboarding}
                  intent="period-align"
                  step="profile"
                />
                <input type="hidden" name="basis" value={period.basis} />
                <input type="hidden" name="to" value="period_end" />
                <button type="submit">
                  Set the period end to {formatDate(nameYear.periodEndFix)}
                </button>
              </form>
            ) : null}
            {nameYear.nameFix !== null ? (
              <form autoComplete="off" method="post" action="/workspace/setup">
                <Identity
                  model={model}
                  onboarding={onboarding}
                  intent="period-align"
                  step="profile"
                />
                <input type="hidden" name="basis" value={period.basis} />
                <input type="hidden" name="to" value="name" />
                <button type="submit" className="btn-secondary">
                  Rename to {nameYear.nameFix}
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
        {confirmable ? (
          <form autoComplete="off" method="post" action="/workspace/setup">
            <Identity
              model={model}
              onboarding={onboarding}
              intent="period-confirm"
              step="profile"
            />
            <input type="hidden" name="basis" value={period.basis} />
            <ConfirmAction
              label="Confirm the period as recorded"
              intent="period-confirm"
              className="btn-secondary"
              tone="neutral"
              title="Confirm the period as recorded?"
              consequence={`The period ${onboarding.periodStart !== null ? `${formatDate(onboarding.periodStart)} to ` : "ending "}${formatDate(onboarding.periodEnd ?? "")} remains unchanged. Your confirmation is recorded in the audit trail, and any later change to the name, scope, or dates requires confirmation again.`}
              confirmLabel="Confirm the period"
            />
          </form>
        ) : null}
      </div>
    </section>
  );
}

type DraftField = {
  key: "scope" | "period_end" | "cadence";
  label: string;
  value: string;
  reason: string;
};

/** The planner's suggestions for a step, each accepted on its own. */
function DraftCard({
  model,
  onboarding,
  step,
  title,
  fields,
  empty,
}: {
  model: Ready;
  onboarding: Onboarding;
  step: SetupStep;
  title: string;
  fields: Array<DraftField | null>;
  empty: string;
}) {
  const draft = onboarding.setupDraft;
  const shown = fields.filter((field): field is DraftField => field !== null);
  return (
    <section className="card draft-card" aria-label={title}>
      <div className="draft-head">
        <span className="agent-mark" aria-hidden="true">
          EP
        </span>
        <div>
          <strong>{title}</strong>
          <small>
            {draft === null
              ? "Not drafted yet."
              : draft.drafting
                ? "The planner is preparing suggestions."
                : draft.source === "AGENT"
                  ? `Drafted by the engagement planner${draft.draftedAt !== null ? ` on ${formatDate(draft.draftedAt)}` : ""}. Accept what fits and edit the rest.`
                  : draft.source === "RULES"
                    ? "Suggested from the engagement details. Accept what fits and edit the rest."
                    : "Not drafted yet."}
          </small>
        </div>
        <form
          autoComplete="off"
          method="post"
          action="/workspace/setup"
          className="draft-again"
        >
          <Identity
            model={model}
            onboarding={onboarding}
            intent="suggest"
            step={step}
          />
          <button
            type="submit"
            className="btn-secondary btn-sm"
            disabled={draft?.drafting === true}
          >
            <UiIcon name="sparkles" size={13} />{" "}
            {draft === null || draft.source === "NONE"
              ? "Ask the planner"
              : "Draft again"}
          </button>
        </form>
      </div>
      {draft?.drafting ? (
        <p className="draft-waiting">
          <span className="spinner small" aria-hidden="true" /> Preparing
          suggestions. This page updates on its own.
        </p>
      ) : shown.length === 0 ? (
        <p className="draft-empty">{empty}</p>
      ) : (
        <form
          autoComplete="off"
          method="post"
          action="/workspace/setup"
          className="draft-fields"
        >
          <Identity
            model={model}
            onboarding={onboarding}
            intent="accept-suggestions"
            step={step}
          />
          <input
            type="hidden"
            name="draft_version"
            value={draft?.version ?? 1}
          />
          {shown.map((field) => (
            <label key={field.key} className="suggestion">
              <input
                type="checkbox"
                name="field"
                value={field.key}
                defaultChecked
              />
              <span className="suggestion-body">
                <span className="suggestion-label">{field.label}</span>
                <span className="suggestion-value">{field.value}</span>
                {field.reason !== "" ? (
                  <small className="suggestion-reason">{field.reason}</small>
                ) : null}
              </span>
            </label>
          ))}
          <div className="form-actions">
            <button type="submit" className="btn-sm">
              <UiIcon name="check" size={13} /> Accept the ticked suggestions
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

// Step 2: team

function TeamStep({
  model,
  onboarding,
  editable,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
}) {
  const byRole = (role: string) =>
    onboarding.team.filter((member) => member.role === role);
  const roles: Array<{
    role: string;
    title: string;
    detail: string;
    one: boolean;
  }> = [
    {
      role: "LEAD",
      title: "Engagement lead",
      detail:
        "Owns the engagement, approves the kickoff plan, and signs off the report.",
      one: true,
    },
    {
      role: "PREPARER",
      title: "Preparers",
      detail:
        "Work alongside the agents on walkthroughs and testing, and approve evidence requests.",
      one: false,
    },
    {
      role: "REVIEWER",
      title: "Independent reviewer",
      detail: onboarding.independenceRequired
        ? "Reviews prepared workpapers. Must be someone other than the preparers."
        : "Reviews prepared workpapers. While independence checks are off, this can be someone who also prepares.",
      one: true,
    },
  ];
  const defaultRole =
    byRole("LEAD").length === 0
      ? "LEAD"
      : byRole("REVIEWER").length === 0
        ? "REVIEWER"
        : "PREPARER";
  return (
    <>
      <StepIssues onboarding={onboarding} step="team" />
      <section className="card" aria-labelledby="team-title">
        <CardHeader
          title="Engagement team"
          titleId="team-title"
          description="Only people on the team can open this engagement. Owners and admins can open every engagement."
          aside={
            <span className="num">
              {teamPeople(onboarding.team).length} member
              {teamPeople(onboarding.team).length === 1 ? "" : "s"}
            </span>
          }
        />
        {editable &&
        onboarding.team.some(
          (member) => member.welcomeHeld && !member.validated,
        ) ? (
          <form
            autoComplete="off"
            method="post"
            action="/workspace/setup"
            className="team-welcomes"
          >
            <Identity
              model={model}
              onboarding={onboarding}
              intent="send-welcomes"
              step="team"
            />
            <p>
              Welcome emails are ready for people who have not signed in yet.
              They go to the allowed email domains only.
            </p>
            <button type="submit" className="btn btn-secondary btn-sm">
              <UiIcon name="mail" size={14} />
              Send welcome emails
            </button>
          </form>
        ) : null}
        <div className="role-cards">
          {roles.map((entry) => {
            const people = byRole(entry.role);
            return (
              <article
                key={entry.role}
                className={`role-card ${people.length > 0 ? "role-card-filled" : ""}`}
              >
                <h3>{entry.title}</h3>
                <p>{entry.detail}</p>
                {people.length === 0 ? (
                  <p className="role-empty">
                    {entry.one ? "Not named yet." : "No preparers yet."}
                  </p>
                ) : (
                  <ul className="role-people">
                    {people.map((member) => (
                      <li key={member.userId}>
                        <span className="avatar" aria-hidden="true">
                          {initials(member.email)}
                        </span>
                        <span className="row-text">
                          <span>{member.name}</span>
                          <small>{member.email}</small>
                          <MemberStatus
                            validated={member.validated}
                            welcomeHeld={member.welcomeHeld}
                          />
                        </span>
                        {editable ? (
                          <form
                            autoComplete="off"
                            method="post"
                            action="/workspace/setup"
                          >
                            <Identity
                              model={model}
                              onboarding={onboarding}
                              intent="remove-member"
                              step="team"
                            />
                            <input
                              type="hidden"
                              name="user_id"
                              value={member.userId}
                            />
                            <input
                              type="hidden"
                              name="engagement_role"
                              value={entry.role}
                            />
                            {onboarding.started ? (
                              <ConfirmAction
                                label="Remove"
                                intent="remove-member"
                                className="btn-ghost btn-sm"
                                title={`Remove ${member.name} as ${(ROLE_LABELS[entry.role] ?? entry.title).toLowerCase()}?`}
                                consequence="The engagement is in progress. If this is the person's only role, their access to the engagement is removed; work they performed remains attributed to them."
                                confirmLabel="Remove"
                                impact={impactHref(
                                  model.organization.id,
                                  onboarding.projectId,
                                  { kind: "member", id: member.userId },
                                )}
                              />
                            ) : (
                              <button
                                type="submit"
                                className="btn-ghost btn-sm"
                                aria-label={`Remove ${member.name} as ${entry.title.toLowerCase()}`}
                              >
                                <UiIcon name="x" size={13} />
                              </button>
                            )}
                          </form>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
        {editable ? (
          <div className="card-footer team-add">
            <form
              autoComplete="off"
              method="post"
              action="/workspace/setup"
              className="team-invite"
            >
              <Identity
                model={model}
                onboarding={onboarding}
                intent="invite-member"
                step="team"
              />
              <h3>Invite by email</h3>
              <div className="team-invite-fields">
                <label htmlFor="invite-email">
                  Work email
                  <input
                    id="invite-email"
                    name="email"
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="off"
                    placeholder={
                      onboarding.firmDomains[0] !== undefined
                        ? `name@${onboarding.firmDomains[0]}`
                        : "name@yourfirm.com"
                    }
                  />
                </label>
                <label htmlFor="invite-name">
                  Name
                  <input
                    id="invite-name"
                    name="display_name"
                    maxLength={120}
                    autoComplete="off"
                    placeholder="Optional"
                  />
                </label>
                <RoleChoice
                  id="invite-role"
                  several={!onboarding.independenceRequired}
                  defaultRole={defaultRole}
                />
                <button type="submit" className="btn-sm">
                  <UiIcon name="plus" size={14} /> Invite
                </button>
              </div>
              <p className="form-hint">
                Roles apply right away. They show as pending validation until
                they sign in with this address, and get a welcome email with how
                to sign in.
              </p>
            </form>
            {onboarding.team.length + onboarding.candidates.length > 0 ? (
              <form
                autoComplete="off"
                method="post"
                action="/workspace/setup"
                className="team-invite team-existing"
              >
                <Identity
                  model={model}
                  onboarding={onboarding}
                  intent="add-member"
                  step="team"
                />
                <h3>Or choose someone already in your firm</h3>
                <div className="team-invite-fields team-existing-fields">
                  <label htmlFor="setup-member">
                    Person
                    <select
                      id="setup-member"
                      name="user_id"
                      required
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Choose a person
                      </option>
                      {[
                        ...teamPeople(onboarding.team),
                        ...onboarding.candidates,
                      ].map((person) => (
                        <option key={person.userId} value={person.userId}>
                          {person.name} · {person.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  <RoleChoice
                    id="setup-role"
                    several={!onboarding.independenceRequired}
                    defaultRole={defaultRole}
                  />
                  <button type="submit" className="btn-sm btn-secondary">
                    Add to the team
                  </button>
                </div>
              </form>
            ) : null}
            <FirmDomains
              model={model}
              onboarding={onboarding}
              canManage={
                model.organization.role === "OWNER" ||
                model.organization.role === "ADMIN"
              }
            />
          </div>
        ) : null}
      </section>
    </>
  );
}

const TEAM_ROLE_ORDER = ["LEAD", "PREPARER", "REVIEWER"] as const;

/**
 * The role field of the team forms. While reviewer independence is off (development),
 * one person may hold several roles, so they are chosen together; otherwise one person
 * holds one role, and the field is a single choice.
 */
function RoleChoice({
  id,
  several,
  defaultRole,
}: {
  id: string;
  several: boolean;
  defaultRole: string;
}) {
  if (!several) {
    return (
      <label htmlFor={id}>
        Role
        <select id={id} name="engagement_role" defaultValue={defaultRole}>
          {TEAM_ROLE_ORDER.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <fieldset className="role-choice" id={id}>
      <legend>Roles</legend>
      <div className="role-choice-options">
        {TEAM_ROLE_ORDER.map((role) => (
          <label key={role} className="role-choice-option">
            <input
              type="checkbox"
              name="engagement_role"
              value={role}
              defaultChecked={role === defaultRole}
            />
            {ROLE_LABELS[role]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Whether a team member has signed in with their address yet. */
function MemberStatus({
  validated,
  welcomeHeld,
}: {
  validated: boolean;
  welcomeHeld: boolean;
}) {
  return (
    <span className="member-status">
      {validated ? (
        <span className="pill pill-dot tone-success">Validated</span>
      ) : (
        <span className="pill pill-dot tone-warning">Pending validation</span>
      )}
      {!validated && welcomeHeld ? <small>Welcome email ready</small> : null}
    </span>
  );
}

/** The firm's own email domains: the only places an invitation can go. */
function FirmDomains({
  model,
  onboarding,
  canManage,
}: {
  model: Ready;
  onboarding: Onboarding;
  canManage: boolean;
}) {
  const domains = onboarding.firmDomains;
  return (
    <div className="firm-domains">
      <p className="firm-domains-title">
        <UiIcon name="shield" size={14} />
        Invitations go only to your firm's email domains
      </p>
      {domains.length === 0 ? (
        <p className="form-hint">
          {canManage
            ? "No firm domain yet. Add the domain your team's email uses."
            : "No firm domain yet. Ask an owner or admin to add one."}
        </p>
      ) : (
        <ul className="firm-domain-list">
          {domains.map((domain) => (
            <li key={domain}>
              @{domain}
              {canManage ? (
                <form
                  autoComplete="off"
                  method="post"
                  action="/workspace/setup"
                >
                  <Identity
                    model={model}
                    onboarding={onboarding}
                    intent="remove-domain"
                    step="team"
                  />
                  <input type="hidden" name="domain" value={domain} />
                  <button
                    type="submit"
                    className="btn-ghost btn-sm"
                    aria-label={`Remove ${domain}`}
                  >
                    <UiIcon name="x" size={12} />
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form
          autoComplete="off"
          method="post"
          action="/workspace/setup"
          className="toolbar firm-domain-add"
        >
          <Identity
            model={model}
            onboarding={onboarding}
            intent="add-domain"
            step="team"
          />
          <label htmlFor="firm-domain">
            <span className="sr-only">Firm email domain</span>
            <input
              id="firm-domain"
              name="domain"
              required
              maxLength={253}
              placeholder="yourfirm.com"
              autoComplete="off"
            />
          </label>
          <button type="submit" className="btn-sm btn-secondary">
            Add domain
          </button>
        </form>
      ) : null}
    </div>
  );
}

// Step 3: controls, systems, and workpapers

function ControlsStep({
  model,
  onboarding,
  editable,
  setup,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
  setup: SetupState;
}) {
  const importing = setup.rcmImport !== null && editable;
  return (
    <>
      {onboarding.started && editable ? (
        <Banner>
          The engagement is running. Scope changes apply at once: a system or
          control added here gets its walkthrough, evidence request, test, and
          review, and its request is drafted for approval. A control taken out
          of scope has its open work cancelled; what was already tested stays.
        </Banner>
      ) : null}
      {importing || onboarding.started ? null : (
        <StepIssues onboarding={onboarding} step="controls" />
      )}
      <RcmStep
        model={model}
        onboarding={onboarding}
        editable={editable}
        selected={setup.control}
        category={setup.category}
        rcmImport={setup.rcmImport}
        system={setup.system ?? null}
        design={setup.design ?? null}
        notice={setup.notice}
      />
    </>
  );
}

/** An empty tab's invitation: what it holds and the one thing to do first. */
function SetupHero({
  icon,
  title,
  detail,
  children,
}: {
  icon: IconName;
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <section className="card cs-hero">
      <span className="cs-hero-dots" aria-hidden="true" />
      <span className="cs-hero-mark" aria-hidden="true">
        <UiIcon name={icon} size={30} />
        <span className="cs-hero-plus">
          <UiIcon name="plus" size={12} />
        </span>
      </span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {children === undefined ? null : (
        <div className="cs-hero-actions">{children}</div>
      )}
    </section>
  );
}

/**
 * The Controls tab (decided by the product owner on 25 October 2026): the scope only, each
 * control with its system or process, where it came from, and its scope status. Its plan,
 * evidence and testing live in Planning, Evidence and Testing; a row opens the control.
 */
function ScopeControls({
  model,
  onboarding,
  notices,
  engagement,
  controls,
  systems,
  editable,
  initial,
}: {
  model: Ready;
  onboarding: Onboarding;
  /** What stands above the tiles: a notice, the standard procedures to confirm. */
  notices: ReactNode;
  engagement: EngagementState;
  controls: SetupControl[];
  systems: SetupSystem[];
  editable: boolean;
  initial: ControlsFor | null;
}) {
  const processes = onboarding.processes;
  const processName = (control: SetupControl) =>
    processes.find((process) => process.id === control.processId)?.name ?? "";
  const where = (control: SetupControl) =>
    [
      ...onboarding.applications
        .filter((system) => control.applicationIds.includes(system.id))
        .map((system) => system.name),
      processName(control),
    ]
      .filter(Boolean)
      .join(", ") || control.domainLabel;
  const inScopeSystem = new Set(systems.map((system) => system.id));
  // A control of a system taken out of scope comes back with its system, not alone.
  const out = onboarding.controls.filter(
    (control) =>
      !control.included &&
      (control.applicationId === null ||
        inScopeSystem.has(control.applicationId)),
  );
  const work = new Map(
    (engagement.controls ?? []).map((row) => [row.id, row] as const),
  );
  // A system's control leaves scope, or comes back, for that system; any other, by its
  // own scope.
  const action = (control: SetupControl): ScopeAction => {
    const system = control.applicationId;
    if (control.included) {
      return {
        intent: system !== null ? "system-remove-control" : "control-scope",
        fields:
          system !== null
            ? { system_id: system, control_id: control.id }
            : { control_id: control.id, included: "false" },
        note: removalNote(control, where(control), onboarding.started),
        impact: onboarding.started
          ? impactHref(model.organization.id, onboarding.projectId, {
              kind: "control",
              id: control.id,
            })
          : undefined,
      };
    }
    return {
      intent: system !== null ? "system-add-control" : "control-scope",
      fields:
        system !== null
          ? { system_id: system, control_id: control.id }
          : { control_id: control.id, included: "true" },
      note: "",
    };
  };
  const all = [...controls, ...out];
  return (
    <ControlsPage
      ids={{
        organizationId: model.organization.id,
        projectId: onboarding.projectId,
      }}
      rows={all.map((control) =>
        toPageRow(control, work.get(control.id) ?? null, processName(control)),
      )}
      actions={Object.fromEntries(
        all.map((control) => [control.id, action(control)]),
      )}
      systems={systems.map((system) => system.name)}
      processes={scopedProcesses(onboarding).map((row) => ({
        key: row.processId ?? row.domain,
        label: row.label,
      }))}
      initial={initial}
      editable={editable}
      notices={notices}
      extra={
        editable ? (
          <details className="card sys-more sc-write">
            <summary>
              <span>
                Write a business process control of the client&apos;s own
              </span>
            </summary>
            <NewControlForm
              model={model}
              onboarding={onboarding}
              domains={PROCESS_CYCLES.map(([key]) => key)}
              processes={onboarding.processes}
              systems={[]}
              title="New business process control"
              example={{
                controlRef: "BP-01",
                title: "Credit notes are approved before posting",
              }}
            />
          </details>
        ) : null
      }
    />
  );
}

/** Whether the register's address narrows it (a search, a queue, a stage, a layout):
 * such an address is the Controls tab's. */
function registerFiltered(engagement: EngagementState): boolean {
  const filters = engagement.filters;
  return (
    filters.category !== null ||
    filters.query !== "" ||
    filters.queue !== null ||
    filters.stage.length > 0 ||
    filters.application.length > 0 ||
    filters.area.length > 0 ||
    filters.owner.length > 0 ||
    filters.keyOnly ||
    filters.layout === "table" ||
    filters.sort !== "control" ||
    filters.group !== "application"
  );
}

/**
 * Systems & Processes (decided by the product owner, SP1 of the Systems & Processes
 * workflow): the engagement's scope on one page, its permanent home. The workflow's four
 * steps until the scope is finalized; a tile and a tab each for the systems, the business
 * processes, and the controls; the systems and processes as tables that open in place; the
 * controls register under the Controls tab once there are controls, and the library or
 * the client's RCM before. An empty tab opens on its first step. Until SP6, each control
 * set up here gets its walkthrough, evidence request, test, and review at once once the
 * engagement runs (scope_changes.reconcile_scope).
 */
export function ScopePage({
  model,
  setup,
  engagement,
}: {
  model: Ready;
  setup: SetupState;
  engagement: EngagementState;
}) {
  const onboarding = setup.onboarding;
  if (onboarding === null) {
    return (
      <div className="page">
        <Banner tone="warning">
          The systems and processes could not be loaded. Refresh to try again.
        </Banner>
      </div>
    );
  }
  const phase = phaseOf(onboarding);
  const editable =
    canManageProjects(model.organization.role) && scopeOpen(phase);
  // An uploaded RCM waiting for its columns to be matched takes the page until it is.
  const importing = setup.rcmImport !== null && editable;
  const systems = inScopeSystems(onboarding);
  const controls = onboarding.controls.filter((control) => control.included);
  // The work starts when a person reviews and finalizes the scope (SP6).
  const finalized = onboarding.scopeFinalizedAt !== null;
  const empty = systems.length === 0 && controls.length === 0;
  // What controls are selected for: each system, and each named process.
  const targets = [
    ...systems.map((system) => ({
      kind: "system" as const,
      id: system.id,
      name: system.name,
    })),
    ...onboarding.processes.map((process) => ({
      kind: "process" as const,
      id: process.id,
      name: process.name,
    })),
  ];
  return (
    <div className="page setup-page is-controls-setup">
      <PageHeader
        context={onboarding.projectName}
        title="Systems & Processes"
        description="Define the audit scope: the systems, the business processes, the policies that govern them, and the references that describe them. The controls selected for each are on Controls."
        actions={
          <>
            {/* The setup agent's tour: by itself the first time, then on request. */}
            <ControlsTour steps={controlsTourSteps(onboarding)} />
            {editable && !importing ? (
              <ControlsAddMenu
                controlsSet={controls.length > 0}
                finalized={finalized}
              />
            ) : null}
          </>
        }
      />
      {setup.notice !== null && setup.notice !== "setup-created" ? (
        <Banner
          tone={
            setup.notice === "setup-saved" ||
            setup.notice === "setup-rcm-uploaded" ||
            setup.notice === "setup-rcm-imported" ||
            setup.notice === "setup-template-uploaded" ||
            setup.notice === "setup-template-customized"
              ? "info"
              : "warning"
          }
        >
          {NOTICES[setup.notice]}
        </Banner>
      ) : null}
      {!importing && !finalized && onboarding.started && controls.length > 0 ? (
        <Banner tone="info">
          <span className="fz-banner">
            <span>
              {controls.length} control{controls.length === 1 ? " is" : "s are"}{" "}
              selected. No work starts until the scope is reviewed and
              finalized.
            </span>
            {editable ? (
              <OpenScopeAction
                event={FINALIZE_EVENT}
                label="Review and finalize"
                icon="check"
                className="btn btn-sm"
              />
            ) : null}
          </span>
        </Banner>
      ) : null}
      {!importing && finalized && controls.length > 0 ? (
        <Banner tone="info">
          <span className="fz-banner">
            <span>
              The scope is final: {controls.length} control
              {controls.length === 1 ? " is" : "s are"} in scope. Test plans are
              prepared and approved in Planning.
            </span>
            <a className="btn btn-sm" href={sectionHref(model, "planning")}>
              Go to Planning
              <UiIcon name="arrow" size={14} />
            </a>
          </span>
        </Banner>
      ) : null}
      {importing && setup.rcmImport !== null ? (
        <>
          <RcmProgress upload={setup.rcmImport} />
          <RcmStep
            model={model}
            onboarding={onboarding}
            editable={editable}
            selected={null}
            category={null}
            rcmImport={setup.rcmImport}
          />
        </>
      ) : (
        <ControlsSetupFrame
          initial={parseControlsPane(setup.pane, registerFiltered(engagement))}
          tiles={controlsTiles(onboarding, {
            policies: setup.policies ?? [],
            priorYear: setup.priorYear ?? [],
          })}
          controlsHref={sectionHref(model, "register")}
          steps={finalized ? null : scopeSteps(onboarding, finalized)}
          panes={{
            systems:
              systems.length > 0 ? (
                <>
                  <SystemsTable
                    model={model}
                    onboarding={onboarding}
                    editable={editable}
                    selected={setup.system ?? null}
                  />
                  <SocReportsCard onboarding={onboarding} />
                </>
              ) : (
                <>
                  <SetupHero
                    icon="server"
                    title="Start with the first system"
                    detail="Add the applications and infrastructure that support the engagement's financial reporting. Each system is scoped on its own, with the agent's recommended controls."
                  >
                    {editable ? (
                      <>
                        <SystemWizard
                          organizationId={model.organization.id}
                          projectId={onboarding.projectId}
                          knownSystems={onboarding.knownSystems}
                          systems={systems}
                          editable={editable}
                          label="Add first system"
                          openEvent={ADD_SYSTEM_EVENT}
                        />
                        <RcmInsteadButton />
                      </>
                    ) : null}
                  </SetupHero>
                  {/* Those taken out of scope stay listed apart (0114). */}
                  <OutOfScopeSystems
                    model={model}
                    onboarding={onboarding}
                    editable={editable}
                  />
                </>
              ),
            processes:
              scopedProcesses(onboarding).length > 0 ? (
                <ProcessesTable
                  model={model}
                  onboarding={onboarding}
                  editable={editable}
                />
              ) : (
                <SetupHero
                  icon="layers"
                  title="Name the business processes"
                  detail="Business process controls are scoped by process: the standard cycles, such as order to cash, and any process of the client's own. An engagement over IT general controls only can leave this tab empty."
                >
                  {editable ? (
                    <AddProcessButton
                      label="Add first process"
                      primary
                      organizationId={model.organization.id}
                      projectId={onboarding.projectId}
                      systems={systems}
                      processes={onboarding.processes}
                    />
                  ) : null}
                </SetupHero>
              ),
            policies: (
              <PoliciesPane
                ids={{
                  organizationId: model.organization.id,
                  projectId: onboarding.projectId,
                }}
                initial={setup.policies ?? []}
                systems={systems.map((item) => ({
                  id: item.id,
                  name: item.name,
                }))}
                processes={onboarding.processes.map((item) => ({
                  id: item.id,
                  name: item.name,
                }))}
                editable={editable}
              />
            ),
            references: (
              <ReferencesPane
                ids={{
                  organizationId: model.organization.id,
                  projectId: onboarding.projectId,
                }}
                documents={setup.policies ?? []}
                systems={systems.map((item) => ({
                  id: item.id,
                  name: item.name,
                }))}
                processes={onboarding.processes.map((item) => ({
                  id: item.id,
                  name: item.name,
                }))}
                controls={controls.map((control) => ({
                  id: control.id,
                  label: [
                    `${control.controlRef} ${control.title}`,
                    ...systems
                      .filter((item) =>
                        control.applicationIds.includes(item.id),
                      )
                      .map((item) => item.name),
                  ].join(" · "),
                }))}
                editable={editable}
              />
            ),
          }}
        />
      )}
      {empty ? <ControlsAssistant onboarding={onboarding} /> : null}
      {editable ? (
        <>
          <SelectControls
            organizationId={model.organization.id}
            projectId={onboarding.projectId}
            targets={targets}
            finalized={finalized}
            rcm={controls.length === 0}
          />
          {controls.length === 0 ? (
            <RcmUpload
              organizationId={model.organization.id}
              projectId={onboarding.projectId}
            />
          ) : null}
          {finalized ? null : (
            <FinalizeScope
              organizationId={model.organization.id}
              projectId={onboarding.projectId}
              review={scopeReview(onboarding)}
              policies={
                (setup.policies ?? []).filter(
                  (item) => item.kind === "POLICY" || item.kind === "PROCEDURE",
                ).length
              }
              canFinalize={editable}
              planningHref={sectionHref(model, "planning")}
              controlsHref={sectionHref(model, "register")}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

/**
 * Controls (decided by the product owner on 26 October 2026): the engagement's controls on
 * a page of their own, driven by what is selected for each system and process. Each opens
 * with its scope; a system or a process opens it filtered to its own; the client's RCM
 * can stand in for the selection before any control is in scope.
 */
export function RegisterPage({
  model,
  setup,
  engagement,
}: {
  model: Ready;
  setup: SetupState;
  engagement: EngagementState;
}) {
  const onboarding = setup.onboarding;
  if (onboarding === null) {
    return (
      <div className="page">
        <Banner tone="warning">
          The controls could not be loaded. Refresh to try again.
        </Banner>
      </div>
    );
  }
  const phase = phaseOf(onboarding);
  const editable =
    canManageProjects(model.organization.role) && scopeOpen(phase);
  const importing = setup.rcmImport !== null && editable;
  const systems = inScopeSystems(onboarding);
  const controls = onboarding.controls.filter((control) => control.included);
  const finalized = onboarding.scopeFinalizedAt !== null;
  const targets = [
    ...systems.map((system) => ({
      kind: "system" as const,
      id: system.id,
      name: system.name,
    })),
    ...onboarding.processes.map((process) => ({
      kind: "process" as const,
      id: process.id,
      name: process.name,
    })),
  ];
  // With controls in scope, the Controls page carries its own header and actions.
  const listed = !importing && controls.length > 0;
  const notice =
    setup.notice !== null && setup.notice !== "setup-created" ? (
      <Banner
        tone={
          setup.notice === "setup-saved" ||
          setup.notice === "setup-rcm-uploaded" ||
          setup.notice === "setup-rcm-imported"
            ? "info"
            : "warning"
        }
      >
        {NOTICES[setup.notice]}
      </Banner>
    ) : null;
  return (
    <div className="page setup-page is-controls-setup">
      {listed ? null : (
        <PageHeader
          context={onboarding.projectName}
          title="Controls"
          description="The controls selected for each system and process. Each opens with its scope; its plan, evidence and testing follow in Planning, Evidence and Testing."
        />
      )}
      {listed ? null : notice}
      {importing && setup.rcmImport !== null ? (
        <>
          <RcmProgress upload={setup.rcmImport} />
          <RcmStep
            model={model}
            onboarding={onboarding}
            editable={editable}
            selected={null}
            category={null}
            rcmImport={setup.rcmImport}
          />
        </>
      ) : listed ? (
        <ScopeControls
          notices={
            <>
              {notice}
              <StandardMatchesCard
                ids={{
                  organizationId: model.organization.id,
                  projectId: onboarding.projectId,
                }}
                initial={setup.standardMatches ?? null}
                editable={editable}
              />
            </>
          }
          model={model}
          onboarding={onboarding}
          engagement={engagement}
          controls={controls}
          systems={systems}
          editable={editable}
          initial={parseControlsFor(setup.controlsFor)}
        />
      ) : (
        <>
          <SetupHero
            icon="shield"
            title="Select the controls"
            detail={
              systems.length + onboarding.processes.length === 0
                ? "Controls are selected for each system and process. Add them on Systems & Processes first, or upload the client's RCM, which finds the systems it names."
                : "Choose controls from the firm's standard library for each system and process, or upload the client's RCM. No work starts until the scope is reviewed and finalized."
            }
          >
            {editable ? (
              <>
                {systems.length + onboarding.processes.length > 0 ? (
                  <OpenScopeAction
                    event={SELECT_CONTROLS_EVENT}
                    label="Select controls"
                    icon="plus"
                  />
                ) : (
                  <a className="btn" href={sectionHref(model, "controls")}>
                    Go to Systems &amp; Processes
                  </a>
                )}
                <OpenScopeAction
                  event={RCM_UPLOAD_EVENT}
                  label="Upload the client's RCM"
                  icon="upload"
                  className="btn-secondary"
                />
              </>
            ) : null}
          </SetupHero>
          <WorkpapersStep
            model={model}
            onboarding={onboarding}
            editable={editable}
            setup={setup}
          />
        </>
      )}
      {editable ? (
        <>
          <SelectControls
            organizationId={model.organization.id}
            projectId={onboarding.projectId}
            targets={targets}
            finalized={finalized}
            rcm={controls.length === 0}
          />
          {controls.length === 0 ? (
            <RcmUpload
              organizationId={model.organization.id}
              projectId={onboarding.projectId}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Where an uploaded RCM stands in its four steps (SP5): its columns mapped, its matches
 * reviewed, its controls selected for import, with how many rows matched. */
function RcmProgress({ upload }: { upload: RcmImport }) {
  const unmapped = upload.fields.filter(
    (field) =>
      field.required &&
      !upload.columns.some((column) => column.field === field.key),
  );
  const review = upload.preview.skippedCount + upload.preview.problems.length;
  const now = unmapped.length > 0 ? 1 : review > 0 ? 2 : 3;
  return (
    <section className="card rcm-progress" aria-label="RCM upload">
      <RcmSteps now={now} />
      <p>
        <strong>{upload.fileName}</strong> · {upload.dataRows} rows ·{" "}
        {upload.preview.importable} matched · {review} need
        {review === 1 ? "s" : ""} review
      </p>
    </section>
  );
}

// Step 4: evidence requests

// Step 5: review and launch

function LaunchStep({
  model,
  onboarding,
  editable,
  phase,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
  phase: EngagementPhase;
}) {
  const plan = onboarding.plan;
  // A launched engagement shows where the work stands, never the launch again.
  if (onboarding.started) {
    return <LaunchedView model={model} onboarding={onboarding} phase={phase} />;
  }
  if (phase === "closed") {
    return (
      <section className="card" aria-labelledby="archived-title">
        <CardHeader
          title="Archived before launch"
          titleId="archived-title"
          description="This engagement was closed while it was still being set up."
        />
        <div className="card-body">
          <p>
            It never launched, so no work went to the agents and nothing was
            sent to the client. Archived engagements stay closed.
          </p>
        </div>
      </section>
    );
  }
  const items =
    onboarding.planPreview?.items ??
    (plan !== null && plan.status === "PROPOSED" ? plan.items : []);
  const fingerprint = onboarding.planPreview?.fingerprint ?? null;
  return (
    <>
      <EngagementMemo model={model} onboarding={onboarding} />
      <LaunchAction
        model={model}
        onboarding={onboarding}
        items={items}
        fingerprint={fingerprint}
        editable={editable}
      />
      <PlanReview onboarding={onboarding} items={items} />
    </>
  );
}

/**
 * The launch decision, right under the memo it is made on: what launching does, and the
 * button; or, until setup is ready, what is missing and where to fix it.
 */
function LaunchAction({
  model,
  onboarding,
  items,
  fingerprint,
  editable,
}: {
  model: Ready;
  onboarding: Onboarding;
  items: PlanItem[];
  fingerprint: string | null;
  editable: boolean;
}) {
  // An engagement can launch before its controls (decided by the product owner): they
  // are set up in Controls once it runs, so a plan with no tasks yet is ready too.
  const ready = onboarding.ready && fingerprint !== null;
  const missingStep = WORK_STEPS.find(
    (step) => !stepReadiness(onboarding, step).complete,
  );
  const missingOther = onboarding.readiness.find((item) => !item.complete);
  const report = launchReport(onboarding);
  const missing =
    missingStep !== undefined
      ? `Finish ${stepTitle(missingStep)} first. ${stepReadiness(onboarding, missingStep).issues[0] ?? ""}`
      : missingOther !== undefined
        ? `${missingOther.title}: ${missingOther.issues[0] ?? "not ready yet."}`
        : "The plan is still being prepared. Refresh in a moment.";
  return (
    <section
      id="launch-action"
      className={`card launch-card${ready ? " is-ready" : ""}`}
      aria-labelledby="launch-title"
    >
      <div className="card-body launch-row">
        <div>
          <h2 id="launch-title" className="launch-title">
            {ready ? "Ready to launch" : "Not ready to launch yet"}
          </h2>
          <p className="card-desc">
            {ready
              ? items.length === 0
                ? "Launching activates the engagement. The systems and controls are then set up in Controls, and each control set up there gets its walkthrough, evidence request, test, and review. Nothing is emailed until an approver confirms each request. The team can still change."
                : `Launching activates the engagement and hands ${items.length} tasks to the agents in the order the work depends on. Each control's evidence plan is recorded and waits for approval: requests are drafted once a reviewer approves it, with its attributes. Nothing is emailed until an approver confirms each request. Setup locks; the team can still change.`
              : missing.trim()}
          </p>
          {report.blocking.length > 0 ? (
            <div className="launch-checks is-blocking">
              <strong>
                {report.blocking.length}{" "}
                {report.blocking.length === 1 ? "item holds" : "items hold"}{" "}
                launch
              </strong>
              <ul>
                {report.blocking.map((line) => (
                  <li key={line.title + line.message}>
                    <span>
                      {line.message} <small>{line.title}</small>
                    </span>
                    {line.step === null ? null : (
                      <a
                        className="text-link"
                        href={setupHref(model, line.step)}
                      >
                        Fix
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="launch-checks is-ready">
              <strong>
                <UiIcon name="check" size={14} /> Required setup is complete
              </strong>
              <p>
                Launch approves this exact setup snapshot. If another person
                changes it first, you will review the updated version.
              </p>
            </div>
          )}
          {report.warnings.length > 0 ? (
            <details className="launch-advisories">
              <summary>
                {report.warnings.length} worth knowing before launch
              </summary>
              <ul>
                {report.warnings.map((line) => (
                  <li key={line.title + line.message}>
                    {line.message} <small>{line.title}</small>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {items.length > 0 ? (
            <a className="text-link" href="#plan-title">
              See what launching creates
            </a>
          ) : null}
        </div>
        {editable ? (
          <span className="page-actions">
            {!ready && missingStep !== undefined ? (
              <a
                className="btn btn-secondary"
                href={setupHref(model, missingStep)}
              >
                Open {stepTitle(missingStep)}
              </a>
            ) : null}
            <OnceForm action="/workspace/setup">
              <Identity
                model={model}
                onboarding={onboarding}
                intent="launch"
                step="launch"
              />
              <input
                type="hidden"
                name="fingerprint"
                value={fingerprint ?? ""}
              />
              <button type="submit" className="btn-launch" disabled={!ready}>
                <UiIcon name="sparkles" size={15} />
                <span className="launch-idle">Launch engagement</span>
                <span className="launch-busy">Launching…</span>
              </button>
              <span className="launch-wait" role="status">
                Setting up the evidence plans, the agents' tasks, and the
                evidence requests. This can take up to a minute.
              </span>
            </OnceForm>
          </span>
        ) : (
          <p className="form-hint">
            Someone who manages this engagement launches it.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Said once, right after launch: what launching created and what the team does next,
 * most pressing first (launchNextSteps, counted from the records). Closing it stays on
 * the launched setup; the steps open where each is done.
 */
function LaunchedDialog({
  model,
  onboarding,
}: {
  model: Ready;
  onboarding: Onboarding;
}) {
  const launch = onboarding.launch as LaunchSummary;
  const steps = launchNextSteps(launch).slice(0, 3);
  const [first] = steps;
  // Drafted and not yet sent: held for their plan, in draft, or awaiting approval.
  const requests =
    launch.requestsHeld +
    launch.requestsDraft +
    launch.requestsAwaitingApproval;
  return (
    <RecordDialog
      eyebrow="Engagement launched"
      title="What to do next"
      description={`${launch.controls} control${launch.controls === 1 ? "" : "s"} in scope · ${launch.tasksTotal} agent task${launch.tasksTotal === 1 ? "" : "s"} · ${requests} evidence request${requests === 1 ? "" : "s"} drafted. Nothing is sent to the client until an approver confirms it.`}
      closeHref={setupHref(model, "launch")}
    >
      <ol className="launched-next launch-dialog-steps">
        {steps.map((step) => (
          <li
            key={step.key}
            className={step.tone === "ACTION" ? "is-action" : undefined}
          >
            <span className="row-text">
              <span>{step.title}</span>
              <small>{step.detail}</small>
            </span>
            <a
              className={`btn btn-sm${step === first ? "" : " btn-secondary"}`}
              href={sectionHref(model, step.target)}
            >
              {step.tone === "ACTION" ? "Open" : "View"}
              <UiIcon name="arrow" size={13} />
            </a>
          </li>
        ))}
      </ol>
      <footer className="launch-dialog-foot">
        <a className="text-link" href={setupHref(model, "launch")}>
          Stay on setup
        </a>
        <a className="btn btn-secondary" href={sectionHref(model, "overview")}>
          Go to Home
        </a>
      </footer>
    </RecordDialog>
  );
}

/** The setup as an engagement memo: what the team agreed before launch. */
function EngagementMemo({
  model,
  onboarding,
}: {
  model: Ready;
  onboarding: Onboarding;
}) {
  const included = onboarding.controls.filter((control) => control.included);
  const byArea = new Map<string, number>();
  for (const control of included) {
    byArea.set(control.domain, (byArea.get(control.domain) ?? 0) + 1);
  }
  const lead = onboarding.team.find((member) => member.role === "LEAD");
  const reviewer = onboarding.team.find((member) => member.role === "REVIEWER");
  const preparers = onboarding.team.filter(
    (member) => member.role === "PREPARER",
  );
  const Row = ({
    label,
    step,
    children,
  }: {
    label: string;
    /** The step that changes it; none when it follows from the rest. */
    step?: SetupStep;
    children: ReactNode;
  }) => (
    <div className="memo-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
      {step === undefined ? null : (
        <a className="memo-edit" href={setupHref(model, step)}>
          Edit
        </a>
      )}
    </div>
  );
  return (
    <section className="card memo" aria-labelledby="memo-title">
      <CardHeader
        title="Engagement memo"
        titleId="memo-title"
        description="The setup as it will start. Each line opens its step."
      />
      <dl className="memo-body">
        <Row label="Client" step="profile">
          {onboarding.clientName || "Not named"}
        </Row>
        <Row label="Methodology" step="profile">
          {methodologyLabel(onboarding.methodology)}
        </Row>
        <Row label="Period" step="profile">
          {onboarding.periodEnd === null
            ? "Not set"
            : onboarding.periodStart !== null
              ? `${formatDate(onboarding.periodStart)} to ${formatDate(onboarding.periodEnd)}`
              : `Ends ${formatDate(onboarding.periodEnd)}`}
          {onboarding.fiscalYear !== "" ? ` (${onboarding.fiscalYear})` : ""}
        </Row>
        {onboarding.reportingObjectives !== "" ? (
          <Row label="Reporting objectives" step="profile">
            <span className="memo-scope">{onboarding.reportingObjectives}</span>
          </Row>
        ) : null}
        <Row label="Scope" step="profile">
          {onboarding.scope !== "" ? (
            <span className="memo-scope">{onboarding.scope}</span>
          ) : (
            "Not written"
          )}
        </Row>
        <Row label="Team" step="team">
          {lead !== undefined ? `${lead.name} (lead)` : "No lead"}
          {preparers.length > 0
            ? `, ${preparers.map((member) => member.name).join(", ")} (preparer${preparers.length === 1 ? "" : "s"})`
            : ""}
          {reviewer !== undefined
            ? `, ${reviewer.name} (independent reviewer)`
            : ", no reviewer"}
        </Row>
        <Row label="Controls" step="controls">
          {included.length === 0
            ? "None in scope"
            : [...byArea.entries()]
                .map(
                  ([domain, count]) =>
                    `${count} ${AREA_LABEL[domain] ?? domain}`,
                )
                .join(", ")}
          {included.some((control) => control.keyControl)
            ? ` · ${included.filter((control) => control.keyControl).length} key`
            : ""}
        </Row>
        <Row label="Systems" step="controls">
          {inScopeSystems(onboarding).length === 0
            ? "None yet"
            : inScopeSystems(onboarding)
                .map((app) => app.name)
                .join(", ")}
        </Row>
        <Row label="Workpapers" step="workpapers">
          {templateWords(onboarding)}
        </Row>
        <Row label="Evidence requests">
          {`${included.length} drafted at launch, one per control · due in ${onboarding.dueDays} days, reminders every ${onboarding.followUpDays}. Nothing is sent until approved.`}
        </Row>
      </dl>
    </section>
  );
}

/** A launched engagement: when and by whom it launched, where the work stands now, and
 * what the team does next. Every figure is counted from the records. */
function LaunchedView({
  model,
  onboarding,
  phase,
}: {
  model: Ready;
  onboarding: Onboarding;
  phase: EngagementPhase;
}) {
  const launch = onboarding.launch;
  const plan = onboarding.plan;
  const running = phase !== "closed" && phase !== "completed";
  const title =
    phase === "closed"
      ? "The engagement launched and is now archived"
      : phase === "completed"
        ? "The engagement is completed"
        : phase === "paused"
          ? "The engagement launched and is paused"
          : "The engagement is running";
  const systems = inScopeSystems(onboarding).length;
  const people = onboarding.team.length;
  const next = launch === null ? [] : launchNextSteps(launch);
  const openSetup = running ? setupAttention(onboarding) : [];
  const shown =
    openSetup.length > 0 ? next.filter((step) => step.key !== "clear") : next;
  const hrefFor = (target: LaunchNext["target"]) => sectionHref(model, target);
  return (
    <>
      <section className="card launched-head" aria-labelledby="launched-title">
        <div className="launched-title">
          <span className="agent-mark agent-mark-lg" aria-hidden="true">
            <UiIcon name="check" size={22} />
          </span>
          <div>
            <h2 id="launched-title">{title}</h2>
            <p>
              {launch === null
                ? "It launched, and the AI workforce has its tasks in the order the work depends on."
                : `Launched ${formatDate(launch.launchedAt)}${launch.launchedBy ? ` by ${launch.launchedBy}` : ""}.`}
            </p>
          </div>
        </div>
        <ul className="stage-strip launched-scope" aria-label="Scope at launch">
          <li>
            <span>Controls in scope</span>
            <strong className="num">
              {launch?.controls ??
                onboarding.controls.filter((control) => control.included)
                  .length}
            </strong>
          </li>
          <li>
            <span>Systems</span>
            <strong className="num">{systems}</strong>
          </li>
          <li>
            <span>Team</span>
            <strong className="num">{people}</strong>
          </li>
          <li>
            <span>Agent tasks</span>
            <strong className="num">
              {launch?.tasksTotal ?? plan?.createdTasks ?? 0}
            </strong>
          </li>
        </ul>
      </section>

      {launch !== null ? (
        <div className="launched-grid">
          <LaunchProgress
            title="Evidence plans"
            done={launch.plansApproved}
            total={launch.controls}
            doneLabel="approved"
            rows={[
              ["Awaiting approval", launch.plansProposed],
              ["Planner working", launch.plansWorking],
              ["Not planned", launch.plansMissing],
            ]}
            href={hrefFor("controls")}
            link="Open controls"
          />
          <section
            className="card launched-card"
            aria-label="Evidence requests"
          >
            <h3>Evidence requests</h3>
            <p className="launched-figure">
              <strong className="num">
                {launch.requestsHeld +
                  launch.requestsDraft +
                  launch.requestsAwaitingApproval +
                  launch.requestsWithClient +
                  launch.requestsReceived}
              </strong>{" "}
              in total
            </p>
            <ol className="launched-stages">
              {(
                [
                  ["Held for planning", launch.requestsHeld],
                  ["Drafted", launch.requestsDraft],
                  ["Awaiting approval", launch.requestsAwaitingApproval],
                  ["With the client", launch.requestsWithClient],
                  ["Received", launch.requestsReceived],
                ] as const
              ).map(([label, count]) => (
                <li key={label} className={count > 0 ? "has-count" : ""}>
                  <span>{label}</span>
                  <strong className="num">{count}</strong>
                </li>
              ))}
            </ol>
            <a className="launched-link" href={hrefFor("evidence")}>
              Review evidence requests <UiIcon name="arrow" size={13} />
            </a>
          </section>
          <LaunchProgress
            title="Agent tasks"
            done={launch.tasksDone}
            total={launch.tasksTotal}
            doneLabel="done"
            rows={[
              ["In progress or queued", launch.tasksActive],
              ["Needs attention", launch.tasksAttention],
            ]}
            href={hrefFor("tasks")}
            link="Open tasks"
          />
        </div>
      ) : null}

      {running && (openSetup.length > 0 || shown.length > 0) ? (
        <section className="card" aria-labelledby="launched-next-title">
          <CardHeader
            title="Next steps"
            titleId="launched-next-title"
            description="Nothing is requested from the client before its evidence plan is approved, and nothing is sent before an approver confirms it."
          />
          <ul className="launched-next">
            {openSetup.map((item) => (
              <li key={item.step} className="is-attention">
                <span className="launched-next-mark" aria-hidden="true">
                  <UiIcon name="info" size={13} />
                </span>
                <span className="row-text">
                  <span>{item.title}</span>
                  <small>{item.detail}</small>
                </span>
                <a
                  className="btn btn-secondary btn-sm"
                  href={setupHref(model, item.step)}
                >
                  Open
                </a>
              </li>
            ))}
            {shown.map((step) => (
              <li key={step.key} className={`is-${step.tone.toLowerCase()}`}>
                <span className="launched-next-mark" aria-hidden="true">
                  <UiIcon
                    name={
                      step.tone === "DONE"
                        ? "check"
                        : step.tone === "WAITING"
                          ? "sparkles"
                          : "arrow"
                    }
                    size={13}
                  />
                </span>
                <span className="row-text">
                  <span>{step.title}</span>
                  <small>{step.detail}</small>
                </span>
                {step.tone === "ACTION" ? (
                  <a
                    className="btn btn-secondary btn-sm"
                    href={hrefFor(step.target)}
                  >
                    Open
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {onboarding.drafting.pending > 0 ? (
        <DraftingShow
          drafting={onboarding.drafting}
          controls={onboarding.controls
            .filter((control) => control.included)
            .map((control) => `${control.controlRef} ${control.title}`)}
        />
      ) : null}

      {plan !== null && plan.items.length > 0 ? (
        <PlanReview onboarding={onboarding} items={plan.items} launched />
      ) : null}
    </>
  );
}

function LaunchProgress({
  title,
  done,
  total,
  doneLabel,
  rows,
  href,
  link,
}: {
  title: string;
  done: number;
  total: number;
  doneLabel: string;
  rows: ReadonlyArray<readonly [string, number]>;
  href: string;
  link: string;
}) {
  const share = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <section className="card launched-card" aria-label={title}>
      <h3>{title}</h3>
      <p className="launched-figure">
        <strong className="num">{done}</strong> of{" "}
        <span className="num">{total}</span> {doneLabel}
      </p>
      <div
        className="launched-bar"
        role="progressbar"
        aria-label={`${title}: ${done} of ${total} ${doneLabel}`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <span style={{ width: `${share}%` }} />
      </div>
      <ul className="launched-rows">
        {rows.map(([label, count]) => (
          <li key={label} className={count > 0 ? "has-count" : ""}>
            <span>{label}</span>
            <strong className="num">{count}</strong>
          </li>
        ))}
      </ul>
      <a className="launched-link" href={href}>
        {link} <UiIcon name="arrow" size={13} />
      </a>
    </section>
  );
}

/** What launching creates, by control: the detail behind the launch decision. */
function PlanReview({
  onboarding,
  items,
  launched = false,
}: {
  onboarding: Onboarding;
  items: PlanItem[];
  /** After launch: the plan the engagement launched with, folded away. */
  launched?: boolean;
}) {
  const agentName = (key: string) =>
    onboarding.agents.find((agent) => agent.agentKey === key)?.name ?? key;
  const byKind = Object.entries(KIND_LABELS).map(([kind, label]) => ({
    kind,
    label,
    count: items.filter((item) => item.kind === kind).length,
  }));
  const byControl = new Map<string, PlanItem[]>();
  for (const item of items) {
    const key = item.controlRef ?? "Engagement";
    byControl.set(key, [...(byControl.get(key) ?? []), item]);
  }
  return (
    <section className="card" aria-labelledby="plan-title">
      <CardHeader
        title={launched ? "The work plan at launch" : "What launching creates"}
        titleId="plan-title"
        description={
          launched
            ? "The tasks the engagement launched with, by control. Evidence is requested only after that control's plan is approved."
            : "The work for every control in scope: a walkthrough, an evidence task, a test, and an independent review, then the report. Evidence tasks wait until you approve that control's plan."
        }
      />
      <ul className="stage-strip is-wrapping" aria-label="Plan summary">
        {byKind.map((entry) => (
          <li key={entry.kind}>
            <span>{entry.label}</span>
            <strong className="num">{entry.count}</strong>
          </li>
        ))}
      </ul>
      <div className="plan-list">
        {[...byControl.entries()].map(([ref, items]) => (
          <details key={ref} className="plan-group">
            <summary>
              <span>
                <span className="mono">{ref}</span>{" "}
                {onboarding.controls.find(
                  (control) => control.controlRef === ref,
                )?.title ?? "Findings and report"}
              </span>
              <span className="cell-sub">
                {items.length} task{items.length === 1 ? "" : "s"}
              </span>
            </summary>
            <ol>
              {items.map((item) => (
                <li key={item.key}>
                  <span className="row-text">
                    <span>{item.title}</span>
                    <small>
                      {agentName(item.agentKey)}
                      {item.dependsOn.length > 0
                        ? ` · after ${item.dependsOn.length} step${item.dependsOn.length === 1 ? "" : "s"}`
                        : " · can start now"}
                    </small>
                  </span>
                </li>
              ))}
            </ol>
          </details>
        ))}
      </div>
    </section>
  );
}
