import type { ReactNode } from "react";

import { AutoRefresh } from "./auto-refresh";
import { agentMonogram, formatDate, initials } from "./format";
import {
  CONTROL_CATEGORIES,
  type ControlCategory,
  categoryOf,
  DOMAIN_GROUPS,
  DOMAINS,
  domainTester,
  FREQUENCIES,
  LAYERS,
  NATURES,
  type Onboarding,
  type PlanItem,
  pickCategory,
  type RcmImport,
  type RcmSystems,
  SETUP_STEPS,
  type SetupControl,
  type SetupNotice,
  type SetupState,
  type SetupStep,
  setupProgress,
  TESTERS,
  uniqueKeys,
  VALUE_FIELDS,
  VALUE_OPTIONS,
  type ValueField,
  type WorkpaperPreview,
} from "./onboarding-model";
import { canManageProjects, type ShellModel } from "./shell-model";
import { UiIcon } from "./ui-icon";
import {
  Banner,
  CardHeader,
  EmptyState,
  PageHeader,
  StatusPill,
  sectionHref,
} from "./workspace-view";

type Ready = Extract<ShellModel, { status: "ready" }>;

const NOTICES: Record<SetupNotice, string> = {
  "setup-saved": "Saved.",
  "setup-invalid": "Check the fields and try again.",
  "setup-changed":
    "Something changed since the page loaded. Review it and try again.",
  "setup-started":
    "The engagement has started, so its setup is locked. Team changes are still allowed.",
  "setup-incomplete": "Finish every setup step before starting the engagement.",
  "setup-denied": "Your role cannot change this engagement's setup.",
  "setup-unavailable": "That could not be saved. Try again.",
  "setup-launched":
    "Engagement started. The agents have their tasks, and evidence requests are drafted for approval.",
  "setup-rcm-uploaded":
    "RCM uploaded. Check the suggested column matches and the client's terms, then import.",
  "setup-rcm-unreadable":
    "That file could not be read as an RCM. Upload an .xlsx workbook or a .csv file with a header row.",
  "setup-rcm-large":
    "That file is larger than 5 MB. Remove unused sheets and upload it again.",
  "setup-rcm-incomplete":
    "The mapping is not complete yet. Resolve the listed items, save, and import again.",
  "setup-rcm-imported":
    "RCM imported. Tailor the controls, then confirm the workpaper templates again.",
};

const ROLE_LABELS: Record<string, string> = {
  LEAD: "Engagement lead",
  PREPARER: "Preparer",
  REVIEWER: "Independent reviewer",
};

const FREQUENCY_LABEL = Object.fromEntries(FREQUENCIES);
const NATURE_LABEL = Object.fromEntries(NATURES);
const AREA_LABEL: Record<string, string> = Object.fromEntries(DOMAINS);

function setupHref(
  model: Ready,
  step: SetupStep,
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams({
    organization: model.organization.id,
    section: "setup",
    step,
  });
  if (model.selectedProject !== null) {
    params.set("project", model.selectedProject.id);
  }
  for (const [key, value] of Object.entries(extra)) {
    params.set(key, value);
  }
  return `/?${params.toString()}`;
}

function Identity({
  model,
  onboarding,
  intent,
  step,
}: {
  model: Ready;
  onboarding: Onboarding;
  intent: string;
  step: SetupStep;
}) {
  return (
    <>
      <input
        type="hidden"
        name="organization_id"
        value={model.organization.id}
      />
      <input type="hidden" name="project_id" value={onboarding.projectId} />
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="step" value={step} />
    </>
  );
}

export function SetupMain({
  model,
  setup,
}: {
  model: Ready;
  setup: SetupState;
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
  const progress = setupProgress(onboarding);
  const editable =
    canManageProjects(model.organization.role) && !onboarding.started;
  return (
    <div className="page">
      <PageHeader
        context="Engagement setup"
        title={onboarding.projectName}
        badge={<StatusPill status={onboarding.projectStatus} />}
        description={
          onboarding.started
            ? "Setup is complete and the engagement is running. The agents are working from the approved plan."
            : "Set up everything the engagement needs once. When every step is ready, the planner proposes the work and you start the engagement."
        }
        actions={
          onboarding.started ? (
            <span className="pill pill-dot tone-success">Started</span>
          ) : (
            <span
              className={`pill pill-dot ${progress.done === progress.total ? "tone-success" : "tone-info"}`}
            >
              {progress.done} of {progress.total} steps ready
            </span>
          )
        }
      />
      {setup.notice !== null ? (
        <Banner
          tone={
            setup.notice === "setup-saved" ||
            setup.notice === "setup-launched" ||
            setup.notice === "setup-rcm-uploaded" ||
            setup.notice === "setup-rcm-imported"
              ? "info"
              : "warning"
          }
        >
          {NOTICES[setup.notice]}
        </Banner>
      ) : null}
      {!editable && !onboarding.started ? (
        <Banner>
          You can follow setup. A project manager, admin, or owner makes the
          changes.
        </Banner>
      ) : null}
      <div className="setup-layout">
        <SetupNav model={model} onboarding={onboarding} current={setup.step} />
        <div className="stack">
          {setup.step === "scope" ? (
            <ScopeStep
              model={model}
              onboarding={onboarding}
              editable={editable}
            />
          ) : setup.step === "team" ? (
            <TeamStep
              model={model}
              onboarding={onboarding}
              editable={canManageProjects(model.organization.role)}
            />
          ) : setup.step === "rcm" ? (
            <RcmStep
              model={model}
              onboarding={onboarding}
              editable={editable}
              selected={setup.control}
              category={setup.category}
              rcmImport={setup.rcmImport}
            />
          ) : setup.step === "workpapers" ? (
            <WorkpapersStep
              model={model}
              onboarding={onboarding}
              editable={editable}
              setup={setup}
            />
          ) : setup.step === "pbc" ? (
            <PbcStep
              model={model}
              onboarding={onboarding}
              editable={editable}
            />
          ) : (
            <StartStep
              model={model}
              onboarding={onboarding}
              editable={editable}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function stepState(
  onboarding: Onboarding,
  step: SetupStep,
): { complete: boolean; issues: number } {
  if (step === "start") {
    return { complete: onboarding.started, issues: 0 };
  }
  const item = onboarding.readiness.find((entry) => entry.step === step);
  return {
    complete: item?.complete ?? false,
    issues: item?.issues.length ?? 0,
  };
}

function SetupNav({
  model,
  onboarding,
  current,
}: {
  model: Ready;
  onboarding: Onboarding;
  current: SetupStep;
}) {
  return (
    <nav className="setup-nav card" aria-label="Setup steps">
      <ol>
        {SETUP_STEPS.map((step, index) => {
          const state = stepState(onboarding, step.id);
          return (
            <li key={step.id}>
              <a
                href={setupHref(model, step.id)}
                aria-current={current === step.id ? "step" : undefined}
                className={state.complete ? "setup-step-done" : undefined}
              >
                <span className="setup-step-mark" aria-hidden="true">
                  {state.complete ? (
                    <UiIcon name="check" size={13} />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="setup-step-copy">
                  <strong>{step.title}</strong>
                  <small>
                    {state.complete
                      ? step.id === "start"
                        ? "Engagement started"
                        : "Ready"
                      : state.issues > 0
                        ? `${state.issues} to do`
                        : step.detail}
                  </small>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepIssues({
  onboarding,
  step,
}: {
  onboarding: Onboarding;
  step: string;
}) {
  const item = onboarding.readiness.find((entry) => entry.step === step);
  if (item === undefined) {
    return null;
  }
  return (
    <>
      {!item.complete ? (
        <ul className="setup-issues">
          {item.issues.map((issue) => (
            <li key={issue}>
              <UiIcon name="info" size={14} />
              {issue}
            </li>
          ))}
        </ul>
      ) : null}
      {item.advisories.length > 0 ? (
        <ul className="setup-issues setup-advisories">
          {item.advisories.map((note) => (
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

function StepFooter({ model, step }: { model: Ready; step: SetupStep }) {
  const index = SETUP_STEPS.findIndex((item) => item.id === step);
  const next = SETUP_STEPS[index + 1];
  const previous = SETUP_STEPS[index - 1];
  return (
    <div className="setup-footer">
      {previous === undefined ? (
        <span />
      ) : (
        <a className="btn btn-secondary" href={setupHref(model, previous.id)}>
          Back
        </a>
      )}
      {next === undefined ? null : (
        <a className="btn" href={setupHref(model, next.id)}>
          Continue to {next.title.toLowerCase()}{" "}
          <UiIcon name="arrow" size={15} />
        </a>
      )}
    </div>
  );
}

// Step 1

function ScopeStep({
  model,
  onboarding,
  editable,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
}) {
  return (
    <>
      <section className="card" aria-labelledby="scope-title">
        <CardHeader
          title="Scope and period"
          titleId="scope-title"
          description="What this engagement covers, and the period end its controls are tested through."
        />
        <div className="card-body">
          <StepIssues onboarding={onboarding} step="scope" />
          <form method="post" action="/workspace/setup" className="form">
            <Identity
              model={model}
              onboarding={onboarding}
              intent="scope"
              step="scope"
            />
            <label htmlFor="setup-scope" className="field-wide">
              Scope
              <textarea
                id="setup-scope"
                name="scope"
                rows={4}
                maxLength={4000}
                defaultValue={onboarding.scope}
                disabled={!editable}
                placeholder="IT general controls over the systems that support financial reporting for fiscal year 2027."
              />
            </label>
            <label htmlFor="setup-period">
              Period end
              <input
                id="setup-period"
                name="period_end"
                type="date"
                defaultValue={onboarding.periodEnd ?? ""}
                disabled={!editable}
              />
            </label>
            {editable ? (
              <div className="form-actions">
                <button type="submit">Save scope</button>
              </div>
            ) : null}
          </form>
        </div>
      </section>
      <StepFooter model={model} step="scope" />
    </>
  );
}

// Step 2

function TeamStep({
  model,
  onboarding,
  editable,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
}) {
  return (
    <>
      <section className="card" aria-labelledby="team-title">
        <CardHeader
          title="Engagement team"
          titleId="team-title"
          description="People on the team can open this engagement. Owners and admins can open every engagement. The reviewer must be someone other than the preparers."
          aside={
            <span className="num">
              {onboarding.team.length} member
              {onboarding.team.length === 1 ? "" : "s"}
            </span>
          }
        />
        <div className="card-body">
          <StepIssues onboarding={onboarding} step="team" />
        </div>
        {onboarding.team.length === 0 ? (
          <EmptyState
            icon="agents"
            title="No one on the team yet"
            detail="Add an engagement lead and an independent reviewer to continue."
          />
        ) : (
          <ul className="rows team-rows">
            {onboarding.team.map((member) => (
              <li key={member.userId}>
                <span className="team-member">
                  <span className="avatar" aria-hidden="true">
                    {initials(member.email)}
                  </span>
                  <span className="row-text">
                    <span>{member.name}</span>
                    <small>{member.email}</small>
                  </span>
                </span>
                <span className="team-actions">
                  <span
                    className={`pill ${member.role === "LEAD" ? "tone-info" : member.role === "REVIEWER" ? "tone-success" : ""}`}
                  >
                    {ROLE_LABELS[member.role] ?? member.role}
                  </span>
                  {editable ? (
                    <form method="post" action="/workspace/setup">
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
                      <button type="submit" className="btn-secondary btn-sm">
                        Remove
                      </button>
                    </form>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {editable ? (
          <div className="card-footer">
            <form method="post" action="/workspace/setup" className="toolbar">
              <Identity
                model={model}
                onboarding={onboarding}
                intent="add-member"
                step="team"
              />
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
                  {[...onboarding.team, ...onboarding.candidates].map(
                    (person) => (
                      <option key={person.userId} value={person.userId}>
                        {person.name} · {person.email}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label htmlFor="setup-role">
                Role
                <select
                  id="setup-role"
                  name="engagement_role"
                  defaultValue="PREPARER"
                >
                  <option value="LEAD">Engagement lead</option>
                  <option value="PREPARER">Preparer</option>
                  <option value="REVIEWER">Independent reviewer</option>
                </select>
              </label>
              <button type="submit" className="btn-sm">
                <UiIcon name="plus" size={14} /> Add or change role
              </button>
            </form>
          </div>
        ) : null}
      </section>
      <section className="card" aria-labelledby="roles-title">
        <CardHeader title="What each role does" titleId="roles-title" />
        <div className="card-body">
          <ul className="guide">
            <li>
              <strong>Engagement lead</strong>
              Owns the engagement, approves the kickoff plan, and signs off the
              report. There is one lead.
            </li>
            <li>
              <strong>Preparer</strong>
              Works alongside the agents on walkthroughs and testing, and
              approves evidence requests.
            </li>
            <li>
              <strong>Independent reviewer</strong>
              Reviews completed workpapers. Kept separate from the people and
              agents who prepared them.
            </li>
          </ul>
        </div>
      </section>
      <StepFooter model={model} step="team" />
    </>
  );
}

// Step 3

function RcmStep({
  model,
  onboarding,
  editable,
  selected,
  category,
  rcmImport,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
  selected: string | null;
  category: string | null;
  rcmImport: RcmImport | null;
}) {
  if (rcmImport !== null && editable) {
    return (
      <RcmImportView model={model} onboarding={onboarding} upload={rcmImport} />
    );
  }
  const controls = onboarding.controls;
  if (controls.length === 0) {
    return (
      <>
        <div className="rcm-options">
          <section className="card rcm-option">
            <div className="setup-hero-body">
              <span className="agent-mark agent-mark-lg" aria-hidden="true">
                <UiIcon name="shield" size={22} />
              </span>
              <div>
                <h2>Start from the standard library</h2>
                <p>
                  {onboarding.library.reduce(
                    (sum, area) => sum + area.controls,
                    0,
                  )}{" "}
                  reviewed controls: IT general controls, application controls
                  and key reports, and starter controls for each business cycle,
                  each with its risk, test attributes, suggested evidence, and
                  workpaper templates. Choose the areas in scope.
                </p>
              </div>
            </div>
            {editable ? (
              <LibraryPicker model={model} onboarding={onboarding} />
            ) : null}
          </section>
          <section className="card rcm-option">
            <div className="setup-hero-body">
              <span className="agent-mark agent-mark-lg" aria-hidden="true">
                <UiIcon name="table" size={22} />
              </span>
              <div>
                <h2>Upload the client's RCM</h2>
                <p>
                  Use the client's own matrix, in their format and terminology.
                  You match their columns to what the agents need, and every
                  other column is kept under the client's heading.
                </p>
                <ul className="chips">
                  <li className="pill">Excel .xlsx</li>
                  <li className="pill">CSV</li>
                  <li className="pill">Any column names</li>
                </ul>
              </div>
            </div>
            {editable ? (
              <div className="card-footer">
                <RcmUploadForm model={model} onboarding={onboarding} />
              </div>
            ) : null}
          </section>
        </div>
        <StepFooter model={model} step="rcm" />
      </>
    );
  }
  const active = pickCategory(category, controls, selected);
  const tab = CONTROL_CATEGORIES.find((item) => item.id === active);
  const shown = controls.filter(
    (control) => categoryOf(control.domain) === active,
  );
  const included = shown.filter((control) => control.included);
  const missing = included.filter(
    (control) => control.ownerEmail === "",
  ).length;
  const editing = shown.find((control) => control.id === selected) ?? null;
  const uploaded = onboarding.rcmSource === "UPLOAD";
  const groups = uploaded
    ? [
        ...new Set(
          shown.map(
            (control) => control.domainLabel || AREA_LABEL[control.domain],
          ),
        ),
      ].map((label) => ({
        key: label ?? "",
        label: label ?? "",
        rows: shown.filter(
          (control) =>
            (control.domainLabel || AREA_LABEL[control.domain]) === label,
        ),
      }))
    : DOMAINS.map(([domain, label]) => ({
        key: domain,
        label,
        rows: shown.filter((control) => control.domain === domain),
      }));
  return (
    <>
      <RcmSource model={model} onboarding={onboarding} editable={editable} />
      <RcmTabs model={model} controls={controls} active={active} />
      {shown.length === 0 ? (
        <section className="card">
          <EmptyState
            icon={active === "reports" ? "table" : "shield"}
            title={`No ${tab?.label.toLowerCase() ?? "controls"} yet`}
            detail={
              uploaded
                ? `None of the uploaded controls is in ${tab?.detail.toLowerCase() ?? "this group"}. Upload a new version, or move a control here by changing its area.`
                : `Add ${tab?.detail.toLowerCase() ?? "these areas"} from the library above, or upload the client's RCM.`
            }
          />
        </section>
      ) : (
        <section className="kpis" aria-label={`${tab?.label ?? "RCM"} summary`}>
          <article className="kpi">
            <p className="kpi-label">In scope</p>
            <strong className="kpi-value">{included.length}</strong>
            <span className="kpi-detail">
              of {shown.length} {active === "reports" ? "reports" : "controls"}
            </span>
          </article>
          <article className="kpi">
            <p className="kpi-label">Key controls</p>
            <strong className="kpi-value">
              {included.filter((control) => control.keyControl).length}
            </strong>
            <span className="kpi-detail">Relied on for the opinion</span>
          </article>
          <article className={`kpi ${missing > 0 ? "" : "kpi-positive"}`}>
            <p className="kpi-label">Owners · optional</p>
            <strong className="kpi-value">{included.length - missing}</strong>
            <span className="kpi-detail">
              {missing === 0
                ? "Every control has one"
                : `${missing} go to the PBC coordinator`}
            </span>
          </article>
          <article className="kpi">
            <p className="kpi-label">Samples to test</p>
            <strong className="kpi-value">
              {included.reduce((sum, control) => sum + control.sampleSize, 0)}
            </strong>
            <span className="kpi-detail">
              Across {tab?.label.toLowerCase() ?? "these controls"}
            </span>
          </article>
        </section>
      )}
      <StepIssues onboarding={onboarding} step="rcm" />
      {editing !== null ? (
        <ControlEditor
          model={model}
          onboarding={onboarding}
          control={editing}
          editable={editable}
        />
      ) : null}
      <section className="card" aria-labelledby="systems-title">
        <CardHeader
          title="In-scope systems"
          titleId="systems-title"
          description={
            onboarding.rcmSource === "UPLOAD"
              ? "Identified from the client's RCM and confirmed at import. Each control is tagged with the systems it relies on."
              : "The systems the controls run on, such as the ERP, its database, and the directory. A system you add here applies to every in-scope control, and you can change that per control."
          }
          aside={
            <span className="num">
              {onboarding.applications.length} system
              {onboarding.applications.length === 1 ? "" : "s"}
            </span>
          }
        />
        {onboarding.applications.length === 0 ? (
          <EmptyState
            icon="grid"
            title="No systems yet"
            detail={
              onboarding.rcmSource === "UPLOAD"
                ? "The uploaded RCM named no system. Add the systems the controls run on."
                : "Add the systems the controls run on. Uploading the client's RCM finds them for you."
            }
          />
        ) : (
          <ul className="rows">
            {onboarding.applications.map((app) => (
              <li key={app.id}>
                <span className="row-text">
                  <span>{app.name}</span>
                  {app.description === "" ? null : (
                    <small>{app.description}</small>
                  )}
                </span>
                <span className="pill">
                  {LAYER_LABEL[app.layer] ?? "Application"}
                </span>
                {editable ? (
                  <form method="post" action="/workspace/setup">
                    <Identity
                      model={model}
                      onboarding={onboarding}
                      intent="remove-application"
                      step="rcm"
                    />
                    <input type="hidden" name="application_id" value={app.id} />
                    <button type="submit" className="btn-secondary btn-sm">
                      Remove
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {editable ? (
          <div className="card-footer">
            <form method="post" action="/workspace/setup" className="toolbar">
              <Identity
                model={model}
                onboarding={onboarding}
                intent="add-application"
                step="rcm"
              />
              <label htmlFor="setup-app-name">
                System
                <input
                  id="setup-app-name"
                  name="name"
                  required
                  maxLength={120}
                  placeholder="SAP ERP"
                />
              </label>
              <label htmlFor="setup-app-description">
                Notes
                <input
                  id="setup-app-description"
                  name="description"
                  maxLength={500}
                  placeholder="Database: Oracle 19c, hosted in Azure"
                />
              </label>
              <button type="submit" className="btn-sm">
                <UiIcon name="plus" size={14} /> Add
              </button>
            </form>
          </div>
        ) : null}
      </section>
      {editable ? <OwnerEmails model={model} onboarding={onboarding} /> : null}
      {editable && shown.length > 0 ? (
        <section className="card" aria-labelledby="owners-title">
          <CardHeader
            title="Assign owners by area"
            titleId="owners-title"
            description="Optional. A control owner gets the control's evidence request directly; without one, the request goes to the client's PBC coordinator. Set one per area, then adjust single controls below."
          />
          <div className="card-body">
            <form method="post" action="/workspace/setup" className="toolbar">
              <Identity
                model={model}
                onboarding={onboarding}
                intent="bulk-owner"
                step="rcm"
              />
              <label htmlFor="owner-domain">
                Area
                <select
                  id="owner-domain"
                  name="domain"
                  defaultValue={shown[0]?.domain ?? "ACCESS"}
                >
                  <DomainOptions only={active} />
                </select>
              </label>
              <label htmlFor="owner-name">
                Owner
                <input
                  id="owner-name"
                  name="owner_name"
                  required
                  maxLength={200}
                  placeholder="Dana Ruiz"
                />
              </label>
              <label htmlFor="owner-email">
                Email
                <input
                  id="owner-email"
                  name="owner_email"
                  type="email"
                  required
                  placeholder="dana@client.example"
                />
              </label>
              <label htmlFor="owner-missing">
                <select
                  id="owner-missing"
                  name="only_missing"
                  defaultValue="true"
                >
                  <option value="true">Only where missing</option>
                  <option value="false">Replace all in area</option>
                </select>
              </label>
              <button type="submit" className="btn-sm">
                Apply
              </button>
            </form>
          </div>
        </section>
      ) : null}
      {groups.map((group) => {
        if (group.rows.length === 0) {
          return null;
        }
        return (
          <section key={group.key} className="card" aria-label={group.label}>
            <CardHeader
              title={group.label}
              aside={
                <span className="num">
                  {group.rows.filter((control) => control.included).length} of{" "}
                  {group.rows.length} in scope
                </span>
              }
            />
            <div className="table-wrap">
              <table className="table table-links">
                <thead>
                  <tr>
                    <th scope="col">Control</th>
                    <th scope="col">Frequency</th>
                    <th scope="col">Owner</th>
                    <th scope="col">Scope</th>
                    <th scope="col" className="cell-end">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((control) => (
                    <tr
                      key={control.id}
                      aria-current={
                        control.id === selected ? "true" : undefined
                      }
                    >
                      <td>
                        <div className="cell-request">
                          <span className="mono item-ref">
                            {control.controlRef}
                            {control.keyControl ? " · Key" : ""}
                          </span>
                          <a
                            className="row-link"
                            href={setupHref(model, "rcm", {
                              category: active,
                              control: control.id,
                            })}
                          >
                            {control.title}
                          </a>
                          <small>
                            {clientTerm(
                              control.natureLabel,
                              NATURE_LABEL[control.nature],
                            )}
                          </small>
                        </div>
                      </td>
                      <td>
                        <span className="cell-stack">
                          <span>
                            {control.frequencyLabel ||
                              FREQUENCY_LABEL[control.frequency]}
                          </span>
                          <small className="cell-sub">
                            {control.frequencyLabel !== "" &&
                            control.frequencyLabel.toLowerCase() !==
                              (
                                FREQUENCY_LABEL[control.frequency] ?? ""
                              ).toLowerCase()
                              ? `${FREQUENCY_LABEL[control.frequency]} · `
                              : ""}
                            {control.sampleSize} sample
                            {control.sampleSize === 1 ? "" : "s"}
                          </small>
                        </span>
                      </td>
                      <td>
                        {control.ownerEmail === "" ? (
                          <span className="cell-stack">
                            <span className="pill pill-dot tone-warning">
                              No owner email
                            </span>
                            {control.ownerName !== "" ? (
                              <small className="cell-sub">
                                {control.ownerName}
                              </small>
                            ) : null}
                          </span>
                        ) : (
                          <span className="cell-stack">
                            <span>
                              {control.ownerName || control.ownerEmail}
                            </span>
                            <small className="cell-sub">
                              {control.ownerEmail}
                            </small>
                          </span>
                        )}
                      </td>
                      <td>
                        {control.included ? (
                          <span className="pill pill-dot tone-success">
                            In scope
                          </span>
                        ) : (
                          <span className="pill">Out of scope</span>
                        )}
                      </td>
                      <td className="cell-end">
                        <UiIcon name="chevron" size={16} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      <StepFooter model={model} step="rcm" />
    </>
  );
}

function RcmTabs({
  model,
  controls,
  active,
}: {
  model: Ready;
  controls: SetupControl[];
  active: ControlCategory;
}) {
  return (
    <nav className="rcm-tabs" aria-label="Control types">
      {CONTROL_CATEGORIES.map((item) => {
        const rows = controls.filter(
          (control) => categoryOf(control.domain) === item.id,
        );
        const inScope = rows.filter((control) => control.included).length;
        return (
          <a
            key={item.id}
            href={setupHref(model, "rcm", { category: item.id })}
            aria-current={item.id === active ? "page" : undefined}
            className="rcm-tab"
          >
            <span className="rcm-tab-head">
              <strong>{item.label}</strong>
              <span className="pill num">{inScope}</span>
            </span>
            <small>
              {rows.length === 0
                ? item.detail
                : `${inScope} of ${rows.length} in scope · ${item.detail}`}
            </small>
          </a>
        );
      })}
    </nav>
  );
}

function clientTerm(client: string, standard: string | undefined): string {
  const label = standard ?? "";
  if (client === "" || client.toLowerCase() === label.toLowerCase()) {
    return label;
  }
  return `${client} · ${label}`;
}

function RcmUploadForm({
  model,
  onboarding,
  compact = false,
}: {
  model: Ready;
  onboarding: Onboarding;
  compact?: boolean;
}) {
  return (
    <form
      method="post"
      action="/workspace/setup/rcm-upload"
      encType="multipart/form-data"
      className="rcm-upload"
    >
      <input
        type="hidden"
        name="organization_id"
        value={model.organization.id}
      />
      <input type="hidden" name="project_id" value={onboarding.projectId} />
      <input
        type="file"
        name="content"
        required
        accept=".xlsx,.xlsm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        aria-label="Client RCM file"
      />
      <button
        type="submit"
        className={compact ? "btn-secondary btn-sm" : undefined}
      >
        <UiIcon name="upload" size={15} />{" "}
        {compact ? "Upload a new version" : "Upload RCM"}
      </button>
    </form>
  );
}

function RcmSource({
  model,
  onboarding,
  editable,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
}) {
  const uploaded = onboarding.rcmSource === "UPLOAD";
  return (
    <section className="card rcm-source" aria-label="RCM source">
      <div className="rcm-source-body">
        <span className="agent-mark" aria-hidden="true">
          <UiIcon name={uploaded ? "table" : "shield"} size={18} />
        </span>
        <div className="row-text">
          <strong>
            {uploaded
              ? `Client RCM${onboarding.rcmFileName === "" ? "" : `: ${onboarding.rcmFileName}`}`
              : "Standard library"}
          </strong>
          <small>
            {uploaded
              ? "Imported in the client's terms. Area, frequency, and nature are mapped to standard values for testing."
              : "Reviewed controls, tailored for this engagement."}
          </small>
        </div>
        {editable ? (
          <div className="rcm-source-actions">
            <RcmUploadForm model={model} onboarding={onboarding} compact />
          </div>
        ) : null}
      </div>
      {editable &&
      (uploaded ||
        onboarding.library.some((area) => area.loaded < area.controls)) ? (
        <details className="rcm-library-more">
          <summary>
            {uploaded
              ? "Use the standard library instead"
              : "Add more areas from the library"}
          </summary>
          {uploaded ? (
            <p className="form-hint">
              Loading the library replaces the uploaded controls.
            </p>
          ) : null}
          <LibraryPicker
            model={model}
            onboarding={onboarding}
            adding={!uploaded}
          />
        </details>
      ) : null}
    </section>
  );
}

function OwnerEmails({
  model,
  onboarding,
}: {
  model: Ready;
  onboarding: Onboarding;
}) {
  const names = [
    ...new Set(
      onboarding.controls
        .filter((control) => control.ownerEmail === "" && control.ownerName)
        .map((control) => control.ownerName),
    ),
  ].slice(0, 200);
  if (names.length === 0) {
    return null;
  }
  return (
    <section className="card" aria-labelledby="owner-emails-title">
      <CardHeader
        title="Add owner emails"
        titleId="owner-emails-title"
        description="The RCM names these owners without an email. Add each once and every control they own gets it."
      />
      <form method="post" action="/workspace/setup" className="card-body">
        <Identity
          model={model}
          onboarding={onboarding}
          intent="owner-emails"
          step="rcm"
        />
        <div className="owner-emails">
          {names.map((name, index) => (
            <label key={name} htmlFor={`owner-email-${index}`}>
              <input type="hidden" name={`owner_name_${index}`} value={name} />
              <span>
                {name}
                <small className="cell-sub">
                  {
                    onboarding.controls.filter(
                      (control) =>
                        control.ownerName === name && control.ownerEmail === "",
                    ).length
                  }{" "}
                  controls
                </small>
              </span>
              <input
                id={`owner-email-${index}`}
                name={`owner_email_${index}`}
                type="email"
                placeholder="name@client.example"
              />
            </label>
          ))}
        </div>
        <div className="form-actions">
          <button type="submit" className="btn-sm">
            Save emails
          </button>
        </div>
      </form>
    </section>
  );
}

const VALUE_TITLES: Record<ValueField, { title: string; detail: string }> = {
  domain: {
    title: "Process or area",
    detail: "Decides which tester agent takes the control.",
  },
  frequency: {
    title: "Frequency",
    detail: "Decides the sample size.",
  },
  nature: {
    title: "Nature",
    detail: "Decides the testing workpaper and whether one sample is enough.",
  },
};

const TESTER_LABEL: Record<string, string> = Object.fromEntries(TESTERS);

/** Area options grouped into IT, application and data, and business cycles. */
function DomainOptions({ only }: { only?: ControlCategory }) {
  return (
    <>
      {CONTROL_CATEGORIES.filter(
        (group) => only === undefined || group.id === only,
      ).map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.domains.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

function LibraryPicker({
  model,
  onboarding,
  adding = false,
}: {
  model: Ready;
  onboarding: Onboarding;
  adding?: boolean;
}) {
  const areas = new Map(onboarding.library.map((area) => [area.domain, area]));
  const groups = DOMAIN_GROUPS.map((group) => ({
    label: group.label,
    domains: group.domains.filter(([key]) => {
      const area = areas.get(key);
      return area !== undefined && (!adding || area.loaded < area.controls);
    }),
  })).filter((group) => group.domains.length > 0);
  if (groups.length === 0) {
    return null;
  }
  return (
    <form method="post" action="/workspace/setup" className="library-picker">
      <Identity
        model={model}
        onboarding={onboarding}
        intent="load-library"
        step="rcm"
      />
      <div className="library-groups">
        {groups.map((group) => (
          <fieldset key={group.label}>
            <legend>{group.label}</legend>
            {group.domains.map(([key, label]) => (
              <label key={key} className="check" htmlFor={`library-${key}`}>
                <input
                  id={`library-${key}`}
                  type="checkbox"
                  name="domains"
                  value={key}
                  defaultChecked={
                    !adding &&
                    (key === "ACCESS" ||
                      key === "CHANGE" ||
                      key === "OPERATIONS")
                  }
                />
                {label}
                <small className="cell-sub">
                  {areas.get(key)?.controls ?? 0}
                </small>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="form-actions">
        <button
          type="submit"
          className={adding ? "btn-secondary btn-sm" : undefined}
        >
          <UiIcon name="plus" size={15} />{" "}
          {adding ? "Add selected areas" : "Load selected areas"}
        </button>
      </div>
    </form>
  );
}

function RcmImportView({
  model,
  onboarding,
  upload,
}: {
  model: Ready;
  onboarding: Onboarding;
  upload: RcmImport;
}) {
  const fieldLabel = Object.fromEntries(
    upload.fields.map((field) => [field.key, field.label]),
  );
  const mapped = new Set(upload.columns.map((column) => column.field));
  const missingRequired = upload.fields.filter(
    (field) => field.required && !mapped.has(field.key),
  );
  let valueIndex = 0;
  const preview = upload.preview;
  return (
    <>
      <section className="card rcm-source" aria-label="Uploaded file">
        <div className="rcm-source-body">
          <span className="agent-mark" aria-hidden="true">
            <UiIcon name="table" size={18} />
          </span>
          <div className="row-text">
            <strong>{upload.fileName}</strong>
            <small className="upload-owner">
              Uploaded to {onboarding.projectName}
              {upload.createdAt !== ""
                ? ` on ${formatDate(upload.createdAt)}`
                : ""}
              {upload.uploadedBy !== "" ? ` by ${upload.uploadedBy}` : ""}. Not
              imported yet: import it or discard it.
            </small>
            <small>
              {upload.fileKind === "XLSX" ? "Excel workbook" : "CSV"} ·{" "}
              {formatSize(upload.sizeBytes)} · {upload.dataRows} rows below the
              header · Only cell values were read. Formulas, macros, and links
              were not run.
            </small>
          </div>
          <form method="post" action="/workspace/setup">
            <Identity
              model={model}
              onboarding={onboarding}
              intent="rcm-discard"
              step="rcm"
            />
            <input type="hidden" name="import_id" value={upload.id} />
            <button type="submit" className="btn-secondary btn-sm">
              Discard upload
            </button>
          </form>
        </div>
        <form
          method="post"
          action="/workspace/setup"
          className="toolbar rcm-layout"
        >
          <Identity
            model={model}
            onboarding={onboarding}
            intent="rcm-layout"
            step="rcm"
          />
          <input type="hidden" name="import_id" value={upload.id} />
          <input type="hidden" name="version" value={upload.version} />
          {upload.sheets.length > 1 ? (
            <label htmlFor="rcm-sheet">
              Sheet
              <select
                id="rcm-sheet"
                name="sheet_index"
                defaultValue={String(upload.sheetIndex)}
              >
                {upload.sheets.map((sheet) => (
                  <option key={sheet.index} value={sheet.index}>
                    {sheet.name} ({sheet.rows} rows)
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <input type="hidden" name="sheet_index" value={upload.sheetIndex} />
          )}
          <label htmlFor="rcm-header">
            Headings are in row
            <input
              id="rcm-header"
              name="header_row"
              type="number"
              min={1}
              max={100}
              defaultValue={upload.headerRow}
            />
          </label>
          <button type="submit" className="btn-secondary btn-sm">
            Re-read the sheet
          </button>
          <span className="form-hint">
            Changing the sheet or heading row suggests the columns again.
          </span>
        </form>
      </section>

      <form method="post" action="/workspace/setup" className="stack">
        <Identity
          model={model}
          onboarding={onboarding}
          intent="rcm-mapping"
          step="rcm"
        />
        <input type="hidden" name="import_id" value={upload.id} />
        <input type="hidden" name="version" value={upload.version} />
        <section className="card" aria-labelledby="rcm-columns-title">
          <CardHeader
            title="1. Match the client's columns"
            titleId="rcm-columns-title"
            description="Suggested from the headings, and from how your firm mapped earlier RCMs. Columns you keep as client columns appear on each control and its workpapers under the client's heading."
            aside={<span className="num">{upload.columns.length} columns</span>}
          />
          {missingRequired.length > 0 ? (
            <div className="card-body">
              <ul className="setup-issues">
                {missingRequired.map((field) => (
                  <li key={field.key}>
                    <UiIcon name="info" size={14} />
                    Choose the column that holds the {field.label.toLowerCase()}
                    .
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="table-wrap">
            <table className="table rcm-map">
              <thead>
                <tr>
                  <th scope="col">Client column</th>
                  <th scope="col">Sample values</th>
                  <th scope="col">Use as</th>
                </tr>
              </thead>
              <tbody>
                {upload.columns.map((column) => (
                  <tr key={column.index}>
                    <td>
                      <strong>{column.header}</strong>
                    </td>
                    <td>
                      {column.samples.length === 0 ? (
                        <span className="muted">Empty</span>
                      ) : (
                        <ul className="rcm-samples">
                          {uniqueKeys(column.samples, (sample) => sample).map(
                            ([key, sample]) => (
                              <li key={key}>{sample}</li>
                            ),
                          )}
                        </ul>
                      )}
                    </td>
                    <td>
                      <select
                        name={`column_${column.index}`}
                        defaultValue={column.field}
                        aria-label={`Use ${column.header} as`}
                      >
                        <optgroup label="Platform field">
                          {upload.fields.map((field) => (
                            <option key={field.key} value={field.key}>
                              {field.label}
                              {field.required ? " (required)" : ""}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Other">
                          <option value="custom">Keep as client column</option>
                          <option value="ignore">Do not import</option>
                        </optgroup>
                      </select>
                      {column.field !== column.suggested &&
                      column.suggested !== "custom" ? (
                        <small className="cell-sub">
                          Suggested: {fieldLabel[column.suggested]}
                        </small>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card" aria-labelledby="rcm-values-title">
          <CardHeader
            title="2. Map the client's terms"
            titleId="rcm-values-title"
            description="The client's words are kept and shown on every control. The standard value next to each decides how the agents test it. The agent maps each term from the controls that use it, and you can change any of them."
            aside={<TermsStatus terms={upload.terms} />}
          />
          {upload.terms.status === "PENDING" ||
          upload.terms.status === "WORKING" ? (
            <div className="card-body systems-working" aria-live="polite">
              <AutoRefresh />
              <span className="spinner" aria-hidden="true" />
              <div>
                <strong>
                  {upload.terms.mode === "REMAP"
                    ? "The agent is mapping every term again."
                    : "The agent is mapping the terms that are still blank."}
                </strong>
                <p className="form-hint">
                  It reads the controls that use each term. This page updates by
                  itself.
                </p>
              </div>
            </div>
          ) : null}
          <div className="rcm-values">
            {VALUE_FIELDS.map((field) => {
              const items = upload.values[field];
              const column = upload.columns.find((c) => c.field === field);
              return (
                <div key={field} className="rcm-value-group">
                  <h3 className="card-subhead">{VALUE_TITLES[field].title}</h3>
                  <p className="form-hint">
                    {column === undefined
                      ? "No column is matched, so one value applies to every control. "
                      : `From "${column.header}". `}
                    {VALUE_TITLES[field].detail}
                  </p>
                  <table className="table rcm-value-table">
                    <thead>
                      <tr>
                        <th scope="col">Client term</th>
                        <th scope="col" className="cell-num">
                          Rows
                        </th>
                        <th scope="col">Standard value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const index = valueIndex;
                        valueIndex += 1;
                        return (
                          <tr key={`${field}-${item.value}`}>
                            <td>
                              <input
                                type="hidden"
                                name={`value_field_${index}`}
                                value={field}
                              />
                              <input
                                type="hidden"
                                name={`value_raw_${index}`}
                                value={item.value}
                              />
                              {item.value === "" ? (
                                <span className="muted">
                                  {column === undefined
                                    ? "Every control"
                                    : "(blank)"}
                                </span>
                              ) : (
                                item.value
                              )}
                            </td>
                            <td className="cell-num num">{item.count}</td>
                            <td>
                              <select
                                name={`value_mapped_${index}`}
                                defaultValue={item.mapped ?? ""}
                                aria-label={`Standard value for ${item.value || "blank"}`}
                                className={
                                  item.mapped === null ? "select-missing" : ""
                                }
                              >
                                <option value="">Choose…</option>
                                {field === "domain" ? (
                                  <DomainOptions />
                                ) : (
                                  VALUE_OPTIONS[field].map(([key, label]) => (
                                    <option key={key} value={key}>
                                      {label}
                                    </option>
                                  ))
                                )}
                              </select>
                              {item.alternative !== null ? (
                                <small className="term-reason term-alternative">
                                  Agent suggests{" "}
                                  {VALUE_OPTIONS[field].find(
                                    ([key]) => key === item.alternative,
                                  )?.[1] ?? item.alternative}
                                  {item.alternativeReason !== ""
                                    ? `: ${item.alternativeReason}`
                                    : ""}
                                </small>
                              ) : null}
                              {item.reason !== "" ? (
                                <small
                                  className={`term-reason ${item.mappedBy === "MODEL" ? "term-reason-agent" : ""}`}
                                >
                                  {item.mappedBy === "MODEL"
                                    ? "Agent: "
                                    : "Rules: "}
                                  {item.reason}
                                </small>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
          <div className="card-footer rcm-save">
            <span className="form-hint">
              After you change which column holds area, frequency, or nature,
              save to see that column's terms here.
            </span>
            <button type="submit">Save and preview</button>
          </div>
        </section>
      </form>

      <form method="post" action="/workspace/setup" className="terms-agent">
        <Identity
          model={model}
          onboarding={onboarding}
          intent="rcm-remap-terms"
          step="rcm"
        />
        <input type="hidden" name="import_id" value={upload.id} />
        <span className="form-hint">
          {upload.terms.modelAvailable
            ? "Have the agent map every term again from the controls that use it. This replaces the current choices; you review them before import."
            : "No model is configured, so remapping puts back the suggestions from the reviewed keyword rules. Set MODEL_PROVIDER and MODEL_API_KEY to let Claude map the terms."}
        </span>
        <button
          type="submit"
          className="btn-secondary btn-sm"
          disabled={
            upload.terms.status === "PENDING" ||
            upload.terms.status === "WORKING"
          }
        >
          <UiIcon name="sparkles" size={14} />{" "}
          {upload.terms.modelAvailable
            ? "Remap with agent"
            : "Reset to suggested"}
        </button>
      </form>

      <RcmSystemsCard
        model={model}
        onboarding={onboarding}
        importId={upload.id}
        systems={upload.systems}
      />

      <section className="card" aria-labelledby="rcm-preview-title">
        <CardHeader
          title="4. Preview and import"
          titleId="rcm-preview-title"
          description={
            upload.replaces > 0
              ? `Importing replaces the ${upload.replaces} controls in this engagement and asks for the workpaper templates to be confirmed again.`
              : "Importing creates the engagement's RCM. You can still tailor every control afterwards."
          }
        />
        <div className="card-body stack">
          <section className="kpis kpis-compact" aria-label="Import summary">
            <article className="kpi">
              <p className="kpi-label">Controls to import</p>
              <strong className="kpi-value">{preview.importable}</strong>
              <span className="kpi-detail">of {upload.dataRows} rows</span>
            </article>
            <article
              className={`kpi ${preview.skippedCount > 0 ? "kpi-risk" : ""}`}
            >
              <p className="kpi-label">Rows skipped</p>
              <strong className="kpi-value">{preview.skippedCount}</strong>
              <span className="kpi-detail">Listed below</span>
            </article>
            <article className="kpi">
              <p className="kpi-label">New applications</p>
              <strong className="kpi-value">
                {preview.newApplications.length}
              </strong>
              <span className="kpi-detail">
                {preview.newApplications.slice(0, 3).join(", ") ||
                  "None to add"}
              </span>
            </article>
          </section>
          {preview.problems.length > 0 ? (
            <ul className="setup-issues">
              {preview.problems.map((problem) => (
                <li key={problem}>
                  <UiIcon name="info" size={14} />
                  {problem}
                </li>
              ))}
            </ul>
          ) : null}
          {preview.warnings.map((warning) => (
            <Banner key={warning} tone="warning">
              {warning}
            </Banner>
          ))}
          {preview.controls.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Control</th>
                    <th scope="col">Area</th>
                    <th scope="col">Frequency</th>
                    <th scope="col">Nature</th>
                    <th scope="col">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.controls.map((control) => (
                    <tr key={control.row}>
                      <td>
                        <div className="cell-request">
                          <span className="mono item-ref">
                            {control.controlRef}
                            {control.keyControl ? " · Key" : ""}
                          </span>
                          <span>{control.title}</span>
                          <small>
                            Row {control.row}
                            {control.customFields > 0
                              ? ` · ${control.customFields} client column${control.customFields === 1 ? "" : "s"}`
                              : ""}
                          </small>
                        </div>
                      </td>
                      <td>
                        <MappedTerm
                          client={control.domainLabel}
                          standard={AREA_LABEL[control.domain] ?? ""}
                        />
                      </td>
                      <td>
                        <MappedTerm
                          client={control.frequencyLabel}
                          standard={FREQUENCY_LABEL[control.frequency] ?? ""}
                        />
                      </td>
                      <td>
                        <MappedTerm
                          client={control.natureLabel}
                          standard={NATURE_LABEL[control.nature] ?? ""}
                        />
                      </td>
                      <td>
                        <span className="cell-stack">
                          <span>{control.ownerName || "Not named"}</span>
                          <small className="cell-sub">
                            {control.ownerEmail || "No email"}
                          </small>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {preview.importable > preview.controls.length ? (
            <p className="form-hint">
              Showing the first {preview.controls.length} of{" "}
              {preview.importable} controls.
            </p>
          ) : null}
          {preview.skippedCount > 0 ? (
            <details className="rcm-skipped">
              <summary>
                {preview.skippedCount} row
                {preview.skippedCount === 1 ? " is" : "s are"} skipped
              </summary>
              <ul>
                {preview.skipped.map((item) => (
                  <li key={item.row}>
                    <span className="mono">Row {item.row}</span> {item.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
        <div className="card-footer rcm-save">
          <span className="form-hint">
            {upload.ready
              ? "Nothing is sent to the client. Owners, scope, and templates can be adjusted after import."
              : "Resolve the items above, then save the mapping."}
          </span>
          <form method="post" action="/workspace/setup">
            <Identity
              model={model}
              onboarding={onboarding}
              intent="rcm-import"
              step="rcm"
            />
            <input type="hidden" name="import_id" value={upload.id} />
            <input type="hidden" name="version" value={upload.version} />
            <button type="submit" disabled={!upload.ready}>
              <UiIcon name="check" size={15} /> Import {preview.importable}{" "}
              controls
            </button>
          </form>
        </div>
      </section>
    </>
  );
}

const LAYER_LABEL: Record<string, string> = Object.fromEntries(LAYERS);

function TermsStatus({ terms }: { terms: RcmImport["terms"] }) {
  if (terms.status === "PENDING" || terms.status === "WORKING") {
    return <span className="pill pill-dot tone-info">Agent is mapping</span>;
  }
  if (terms.status === "FAILED") {
    return (
      <span className="pill pill-dot tone-warning">Mapping did not finish</span>
    );
  }
  return terms.source === "MODEL" ? (
    <span className="pill pill-dot tone-success">Mapped with Claude</span>
  ) : (
    <span className="pill pill-dot">Suggested by rules</span>
  );
}

function RcmSystemsCard({
  model,
  onboarding,
  importId,
  systems,
}: {
  model: Ready;
  onboarding: Onboarding;
  importId: string;
  systems: RcmSystems;
}) {
  const working = systems.status === "PENDING" || systems.status === "SCANNING";
  const rescan = (
    <form method="post" action="/workspace/setup">
      <Identity
        model={model}
        onboarding={onboarding}
        intent="rcm-rescan"
        step="rcm"
      />
      <input type="hidden" name="import_id" value={importId} />
      <button type="submit" className="btn-secondary btn-sm">
        <UiIcon name="sparkles" size={14} /> Scan again
      </button>
    </form>
  );
  return (
    <section className="card" aria-labelledby="rcm-systems-title">
      <CardHeader
        title="3. Confirm the in-scope systems"
        titleId="rcm-systems-title"
        description="An agent read the systems column and the control text to find every system the controls rely on. Rename a system, set its layer, or leave it out. Importing makes these the engagement's in-scope applications, each tagged to its own controls."
        aside={
          systems.status === "READY" ? (
            <span
              className={`pill pill-dot ${systems.source === "MODEL" ? "tone-success" : ""}`}
            >
              {systems.source === "MODEL"
                ? "Identified with Claude"
                : "Identified from the RCM"}
            </span>
          ) : undefined
        }
      />
      {working ? (
        <div className="card-body systems-working" aria-live="polite">
          <AutoRefresh />
          <span className="spinner" aria-hidden="true" />
          <div>
            <strong>
              The agent is reading the RCM to identify the systems.
            </strong>
            <p className="form-hint">
              This page updates by itself. Importing now uses only the systems
              column.
            </p>
          </div>
        </div>
      ) : systems.status === "FAILED" ? (
        <div className="card-body stack">
          <Banner tone="warning">
            Identifying the systems did not finish. Scan again, or import using
            the systems column only.
          </Banner>
          {rescan}
        </div>
      ) : systems.proposals.length === 0 ? (
        <div className="card-body stack">
          <p className="form-hint">
            No system is named in this RCM. Map the column that lists them and
            save, or add the systems after import.
          </p>
          {rescan}
        </div>
      ) : (
        <form method="post" action="/workspace/setup">
          <Identity
            model={model}
            onboarding={onboarding}
            intent="rcm-systems"
            step="rcm"
          />
          <input type="hidden" name="import_id" value={importId} />
          <input type="hidden" name="systems_version" value={systems.version} />
          <div className="table-wrap">
            <table className="table rcm-systems">
              <thead>
                <tr>
                  <th scope="col">In scope</th>
                  <th scope="col">System</th>
                  <th scope="col">Layer</th>
                  <th scope="col">Found in</th>
                </tr>
              </thead>
              <tbody>
                {systems.proposals.map((system, index) => (
                  <tr key={system.key}>
                    <td>
                      <input
                        type="hidden"
                        name={`system_key_${index}`}
                        value={system.key}
                      />
                      <input
                        type="checkbox"
                        name={`system_included_${index}`}
                        defaultChecked={system.included}
                        aria-label={`Keep ${system.name} in scope`}
                      />
                    </td>
                    <td>
                      <input
                        name={`system_name_${index}`}
                        defaultValue={system.name}
                        maxLength={120}
                        required
                        aria-label={`Name for ${system.name}`}
                      />
                      {system.aliases.length > 0 ? (
                        <small className="cell-sub">
                          Also written as{" "}
                          {system.aliases.slice(0, 4).join(", ")}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <select
                        name={`system_layer_${index}`}
                        defaultValue={system.layer}
                        aria-label={`Layer for ${system.name}`}
                      >
                        {LAYERS.map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className="cell-stack">
                        <span>
                          {system.controls} control
                          {system.controls === 1 ? "" : "s"}
                          <span className="cell-sub">
                            {" "}
                            · {system.controlRefs.slice(0, 3).join(", ")}
                            {system.controlRefs.length > 3 ? "…" : ""}
                          </span>
                        </span>
                        <small className="cell-sub">
                          {system.foundIn === "column"
                            ? "Systems column"
                            : system.foundIn === "text"
                              ? "Control text only"
                              : "Systems column and control text"}
                          {system.evidence !== "" && system.foundIn !== "column"
                            ? ` · “${system.evidence}”`
                            : ""}
                        </small>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-footer rcm-save">
            <span className="form-hint">
              {systems.note !== "" ? `${systems.note} ` : ""}
              {systems.proposals.filter((system) => system.included).length} of{" "}
              {systems.proposals.length} systems in scope.
            </span>
            <span className="rcm-systems-actions">
              <button type="submit" formAction="/workspace/setup">
                Save systems
              </button>
            </span>
          </div>
        </form>
      )}
      {systems.status === "READY" && systems.proposals.length > 0 ? (
        <div className="card-footer rcm-rescan">{rescan}</div>
      ) : null}
    </section>
  );
}

function MappedTerm({
  client,
  standard,
}: {
  client: string;
  standard: string;
}) {
  if (client === "" || client.toLowerCase() === standard.toLowerCase()) {
    return <span>{standard}</span>;
  }
  return (
    <span className="cell-stack">
      <span>{client}</span>
      <small className="cell-sub">{standard}</small>
    </span>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ControlEditor({
  model,
  onboarding,
  control,
  editable,
}: {
  model: Ready;
  onboarding: Onboarding;
  control: SetupControl;
  editable: boolean;
}) {
  const designTemplates = onboarding.templates.filter(
    (t) => t.stage === "design",
  );
  const effectivenessTemplates = onboarding.templates.filter(
    (t) => t.stage === "effectiveness",
  );
  return (
    <section className="card control-editor" aria-labelledby="control-title">
      <CardHeader
        title={`${control.controlRef} ${control.title}`}
        titleId="control-title"
        description={control.activity}
        aside={
          <a
            className="text-link"
            href={setupHref(model, "rcm", {
              category: categoryOf(control.domain),
            })}
          >
            Close
          </a>
        }
      />
      <div className="card-body control-editor-body">
        <div className="stack">
          {control.risk !== "" ? (
            <div>
              <h3 className="card-subhead">Risk</h3>
              <p className="prose">{control.risk}</p>
            </div>
          ) : null}
          {control.source === "UPLOAD" ? (
            <div>
              <h3 className="card-subhead">In the client's terms</h3>
              <dl className="client-fields">
                {[
                  [
                    "Process or area",
                    control.domainLabel,
                    AREA_LABEL[control.domain],
                  ],
                  [
                    "Frequency",
                    control.frequencyLabel,
                    FREQUENCY_LABEL[control.frequency],
                  ],
                  ["Nature", control.natureLabel, NATURE_LABEL[control.nature]],
                ].map(([label, client, standard]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>
                      {client || "Not given"}
                      <small className="cell-sub">Tested as {standard}</small>
                    </dd>
                  </div>
                ))}
                {uniqueKeys(control.customFields, (field) => field.label).map(
                  ([key, field]) => (
                    <div key={key}>
                      <dt>{field.label}</dt>
                      <dd>{field.value}</dd>
                    </div>
                  ),
                )}
              </dl>
            </div>
          ) : null}
          <div>
            <h3 className="card-subhead">Test attributes</h3>
            <ol className="attribute-list">
              {uniqueKeys(control.testAttributes, (item) => item).map(
                ([key, attribute]) => (
                  <li key={key}>{attribute}</li>
                ),
              )}
            </ol>
          </div>
          <div>
            <h3 className="card-subhead">Evidence requested</h3>
            <ul className="attribute-list">
              {uniqueKeys(control.pbcItems, (entry) => entry).map(
                ([key, item]) => (
                  <li key={key}>{item}</li>
                ),
              )}
            </ul>
          </div>
        </div>
        <form method="post" action="/workspace/setup" className="form">
          <Identity
            model={model}
            onboarding={onboarding}
            intent="control"
            step="rcm"
          />
          <input type="hidden" name="control_id" value={control.id} />
          <input type="hidden" name="return_control" value={control.id} />
          <input type="hidden" name="version" value={control.version} />
          <label className="check field-wide" htmlFor="control-included">
            <input
              id="control-included"
              name="included"
              type="checkbox"
              defaultChecked={control.included}
              disabled={!editable}
            />
            In scope for this engagement
          </label>
          <label className="check field-wide" htmlFor="control-key">
            <input
              id="control-key"
              name="key_control"
              type="checkbox"
              defaultChecked={control.keyControl}
              disabled={!editable}
            />
            Key control
          </label>
          <label htmlFor="control-owner-name">
            Owner
            <input
              id="control-owner-name"
              name="owner_name"
              maxLength={200}
              defaultValue={control.ownerName}
              disabled={!editable}
            />
          </label>
          <label htmlFor="control-owner-email">
            Owner email
            <input
              id="control-owner-email"
              name="owner_email"
              type="email"
              defaultValue={control.ownerEmail}
              disabled={!editable}
            />
          </label>
          <label htmlFor="control-frequency">
            Frequency
            <select
              id="control-frequency"
              name="frequency"
              defaultValue={control.frequency}
              disabled={!editable}
            >
              {FREQUENCIES.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="control-nature">
            Nature
            <select
              id="control-nature"
              name="nature"
              defaultValue={control.nature}
              disabled={!editable}
            >
              {NATURES.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="control-domain">
            Area
            <select
              id="control-domain"
              name="domain"
              defaultValue={control.domain}
              disabled={!editable}
            >
              <DomainOptions />
            </select>
          </label>
          <label htmlFor="control-tester">
            Tester
            <select
              id="control-tester"
              name="agent_key"
              defaultValue={
                control.agentKey === domainTester(control.domain)
                  ? ""
                  : control.agentKey
              }
              disabled={!editable}
            >
              <option value="">Standard for the area</option>
              {TESTERS.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <span className="form-hint">
              Assigned to {TESTER_LABEL[control.agentKey] ?? control.agentKey}
            </span>
          </label>
          <label htmlFor="control-design">
            Design workpaper
            <select
              id="control-design"
              name="design_template_key"
              defaultValue={control.designTemplate}
              disabled={!editable}
            >
              {designTemplates.map((template) => (
                <option key={template.key} value={template.key}>
                  {template.title}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="control-effectiveness">
            Testing workpaper
            <select
              id="control-effectiveness"
              name="effectiveness_template_key"
              defaultValue={control.effectivenessTemplate}
              disabled={!editable}
            >
              {effectivenessTemplates.map((template) => (
                <option key={template.key} value={template.key}>
                  {template.title}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="field-wide app-picker" disabled={!editable}>
            <legend>Systems</legend>
            {onboarding.applications.length === 0 ? (
              <span className="form-hint">
                Add the in-scope systems above first.
              </span>
            ) : (
              onboarding.applications.map((app) => (
                <label key={app.id} className="check" htmlFor={`app-${app.id}`}>
                  <input
                    id={`app-${app.id}`}
                    type="checkbox"
                    name="application_ids"
                    value={app.id}
                    defaultChecked={control.applicationIds.includes(app.id)}
                  />
                  {app.name}
                </label>
              ))
            )}
          </fieldset>
          {editable ? (
            <div className="form-actions">
              <button type="submit">Save control</button>
              <a
                className="btn btn-secondary"
                href={setupHref(model, "workpapers", {
                  template: control.effectivenessTemplate,
                  control: control.id,
                })}
              >
                Preview workpaper
              </a>
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}

// Step 4

function WorkpapersStep({
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
  const included = onboarding.controls.filter((control) => control.included);
  const sampleFor = (key: string): SetupControl | undefined =>
    included.find(
      (control) =>
        control.designTemplate === key || control.effectivenessTemplate === key,
    ) ?? included[0];
  const previewControl =
    included.find((control) => control.id === setup.control) ?? null;
  return (
    <>
      <section className="card" aria-labelledby="templates-title">
        <CardHeader
          title="Workpaper templates"
          titleId="templates-title"
          description="Every control is documented with a design workpaper and a testing workpaper. Preview each one filled in with a real control from your RCM."
          aside={
            onboarding.templatesConfirmed ? (
              <span className="pill pill-dot tone-success">Confirmed</span>
            ) : undefined
          }
        />
        <div className="template-grid">
          {onboarding.templates.map((template) => {
            const control = sampleFor(template.key);
            const uses = included.filter(
              (item) =>
                item.designTemplate === template.key ||
                item.effectivenessTemplate === template.key,
            ).length;
            const active = setup.template === template.key;
            return (
              <article
                key={template.key}
                className={`template-card ${active ? "template-card-active" : ""}`}
              >
                <span className="pill">
                  {template.stage === "design" ? "Design" : "Testing"}
                </span>
                <h3>{template.title}</h3>
                <p>{template.purpose}</p>
                <ul className="template-sections">
                  {template.sections.map((section) => (
                    <li key={section}>{section}</li>
                  ))}
                </ul>
                <footer>
                  <span className="cell-sub">
                    Used by {uses} control{uses === 1 ? "" : "s"}
                  </span>
                  {control === undefined ? null : (
                    <a
                      className="btn btn-secondary btn-sm"
                      href={setupHref(model, "workpapers", {
                        template: template.key,
                        control: control.id,
                      })}
                    >
                      Preview
                    </a>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
        {included.length === 0 ? (
          <div className="card-body">
            <Banner tone="warning">
              Load the control library first. Previews use your controls.
            </Banner>
          </div>
        ) : null}
      </section>
      {setup.preview !== null && previewControl !== null ? (
        <PreviewPanel
          model={model}
          preview={setup.preview}
          controls={included}
          current={previewControl}
          template={setup.template ?? ""}
        />
      ) : null}
      <StepIssues onboarding={onboarding} step="workpapers" />
      {editable && included.length > 0 ? (
        <section className="card">
          <div className="card-body confirm-row">
            <div>
              <strong>
                {onboarding.templatesConfirmed
                  ? "Templates confirmed"
                  : "Happy with how testing will be documented?"}
              </strong>
              <p className="card-desc">
                Changing a control's template later asks for confirmation again.
              </p>
            </div>
            <form method="post" action="/workspace/setup">
              <Identity
                model={model}
                onboarding={onboarding}
                intent="confirm-templates"
                step="workpapers"
              />
              <button
                type="submit"
                className={onboarding.templatesConfirmed ? "btn-secondary" : ""}
              >
                <UiIcon name="check" size={15} />
                {onboarding.templatesConfirmed
                  ? "Confirm again"
                  : "Use these templates"}
              </button>
            </form>
          </div>
        </section>
      ) : null}
      <StepFooter model={model} step="workpapers" />
    </>
  );
}

function PreviewPanel({
  model,
  preview,
  controls,
  current,
  template,
}: {
  model: Ready;
  preview: WorkpaperPreview;
  controls: readonly SetupControl[];
  current: SetupControl;
  template: string;
}) {
  return (
    <section className="card" aria-labelledby="preview-title">
      <CardHeader
        title="Preview"
        titleId="preview-title"
        description="What the tester completes. Results are never filled in here."
        aside={
          <form method="get" action="/" className="toolbar">
            <input
              type="hidden"
              name="organization"
              value={model.organization.id}
            />
            <input
              type="hidden"
              name="project"
              value={model.selectedProject?.id ?? ""}
            />
            <input type="hidden" name="section" value="setup" />
            <input type="hidden" name="step" value="workpapers" />
            <input type="hidden" name="template" value={template} />
            <label htmlFor="preview-control">
              Control
              <select
                id="preview-control"
                name="control"
                defaultValue={current.id}
              >
                {controls.map((control) => (
                  <option key={control.id} value={control.id}>
                    {control.controlRef} {control.title}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn-secondary btn-sm">
              Show
            </button>
          </form>
        }
      />
      <div className="card-body">
        <article
          className="workpaper"
          aria-label={`Workpaper ${preview.reference}`}
        >
          <header className="workpaper-head">
            <div>
              <span className="mono">{preview.reference}</span>
              <h3>{preview.title}</h3>
              <p>{preview.templateTitle}</p>
            </div>
            <span className="pill">Template v{preview.templateVersion}</span>
          </header>
          {preview.sections.map((section) => (
            <WorkpaperSection key={section.title} section={section} />
          ))}
        </article>
      </div>
    </section>
  );
}

function WorkpaperSection({
  section,
}: {
  section: WorkpaperPreview["sections"][number];
}) {
  let body: ReactNode = null;
  if (section.kind === "fields") {
    body = (
      <dl className="workpaper-fields">
        {uniqueKeys(section.fields, (field) => field.label).map(
          ([key, field]) => (
            <div key={key}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ),
        )}
      </dl>
    );
  } else if (section.kind === "guidance") {
    body = <div className="workpaper-blank">{section.guidance}</div>;
  } else {
    body = (
      <>
        {section.guidance === "" ? null : (
          <p className="workpaper-guidance">{section.guidance}</p>
        )}
        <div className="table-wrap">
          <table className="workpaper-table">
            <thead>
              <tr>
                {section.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row, rowIndex) => (
                <tr
                  key={`${section.title}-${row[0] ?? ""}-${rowIndex.toString()}`}
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${section.columns[cellIndex] ?? cellIndex.toString()}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  return (
    <section className="workpaper-section">
      <h4>{section.title}</h4>
      {body}
    </section>
  );
}

// Step 5

function PbcStep({
  model,
  onboarding,
  editable,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
}) {
  const included = onboarding.controls.filter((control) => control.included);
  return (
    <>
      <section className="card" aria-labelledby="pbc-title">
        <CardHeader
          title="How evidence is requested"
          titleId="pbc-title"
          description="Requests go to each control's owner from the shared mailbox, copying nothing else. Each one waits for an approver before it is sent."
        />
        <div className="card-body">
          <StepIssues onboarding={onboarding} step="pbc" />
          <form method="post" action="/workspace/setup" className="form">
            <Identity
              model={model}
              onboarding={onboarding}
              intent="pbc"
              step="pbc"
            />
            <label htmlFor="pbc-coordinator">
              Client PBC coordinator
              <input
                id="pbc-coordinator"
                name="client_coordinator_name"
                maxLength={200}
                defaultValue={onboarding.coordinatorName}
                disabled={!editable}
                placeholder="Pat Lee"
              />
            </label>
            <label htmlFor="pbc-coordinator-email">
              Coordinator email
              <input
                id="pbc-coordinator-email"
                name="client_coordinator_email"
                type="email"
                defaultValue={onboarding.coordinatorEmail}
                disabled={!editable}
                placeholder="pbc@client.example"
              />
            </label>
            <label htmlFor="pbc-domains" className="field-wide">
              Client email domains
              <input
                id="pbc-domains"
                name="client_domains"
                defaultValue={onboarding.clientDomains.join(", ")}
                disabled={!editable}
                placeholder="client.example, client-it.example"
              />
              <span className="form-hint">
                Every control owner must use one of these domains.
              </span>
            </label>
            <label htmlFor="pbc-due">
              Due after (days)
              <input
                id="pbc-due"
                name="pbc_due_days"
                type="number"
                min={1}
                max={90}
                defaultValue={onboarding.dueDays}
                disabled={!editable}
              />
            </label>
            <label htmlFor="pbc-follow">
              Remind every (days)
              <input
                id="pbc-follow"
                name="pbc_follow_up_days"
                type="number"
                min={1}
                max={30}
                defaultValue={onboarding.followUpDays}
                disabled={!editable}
              />
            </label>
            <label htmlFor="pbc-max">
              Reminders before escalating
              <input
                id="pbc-max"
                name="pbc_max_follow_ups"
                type="number"
                min={0}
                max={10}
                defaultValue={onboarding.maxFollowUps}
                disabled={!editable}
              />
            </label>
            {editable ? (
              <div className="form-actions">
                <button type="submit">Save PBC plan</button>
              </div>
            ) : null}
          </form>
        </div>
      </section>
      <section className="card" aria-labelledby="pbc-preview-title">
        <CardHeader
          title="Requests drafted at kickoff"
          titleId="pbc-preview-title"
          description={`One request per in-scope control, due ${onboarding.dueDays} days after kickoff, with a reminder every ${onboarding.followUpDays} days and escalation after ${onboarding.maxFollowUps}.`}
          aside={<span className="num">{included.length} requests</span>}
        />
        {included.length === 0 ? (
          <EmptyState
            icon="inbox"
            title="No requests yet"
            detail="Requests appear here once controls are in scope."
          />
        ) : (
          <ul className="rows">
            {included.map((control) => (
              <li key={control.id}>
                <span className="row-text">
                  <span>
                    <span className="mono">{control.controlRef}</span>{" "}
                    {control.title}
                  </span>
                  <small>{control.pbcItems.join(" · ")}</small>
                </span>
                {control.ownerEmail === "" ? (
                  <span className="pill pill-dot tone-warning">
                    No recipient
                  </span>
                ) : (
                  <span className="row-meta">{control.ownerEmail}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <StepFooter model={model} step="pbc" />
    </>
  );
}

// Step 6

const KIND_LABELS: Record<string, string> = {
  walkthrough: "Walkthroughs",
  evidence: "Evidence requests",
  test: "Tests",
  review: "Reviews",
  report: "Report",
};

function DraftingProgress({ drafting }: { drafting: Onboarding["drafting"] }) {
  if (drafting.total === 0) {
    return null;
  }
  const done = drafting.drafted + drafting.failed;
  return (
    <div className="drafting-progress" aria-live="polite">
      {drafting.pending > 0 ? <AutoRefresh /> : null}
      <div className="setup-meter" aria-hidden="true">
        <span
          style={{ width: `${Math.round((done / drafting.total) * 100)}%` }}
        />
      </div>
      <small>
        {drafting.pending > 0
          ? `Drafting: ${drafting.drafted} of ${drafting.total} requests ready. Refresh to see progress.`
          : `${drafting.drafted} of ${drafting.total} requests drafted`}
        {drafting.byModel > 0 ? ` · ${drafting.byModel} with Claude` : ""}
        {drafting.failed > 0 ? ` · ${drafting.failed} need a redraft` : ""}
      </small>
    </div>
  );
}

function StartStep({
  model,
  onboarding,
  editable,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
}) {
  const plan = onboarding.plan;
  if (onboarding.started && plan !== null) {
    return (
      <section className="card setup-hero setup-launched">
        <div className="setup-hero-body">
          <span className="agent-mark agent-mark-lg" aria-hidden="true">
            <UiIcon name="check" size={24} />
          </span>
          <div>
            <h2>The engagement is running</h2>
            <p>
              {plan.createdTasks} tasks are assigned to the AI workforce in the
              order the work depends on. The evidence coordinator drafts one
              evidence request per control from the RCM: the population to
              sample from and the walkthrough evidence. Each request is sent
              only after an approver confirms it.
            </p>
            <DraftingProgress drafting={onboarding.drafting} />
            <div className="form-actions">
              <a className="btn" href={sectionHref(model, "overview")}>
                Open command center <UiIcon name="arrow" size={15} />
              </a>
              <a
                className="btn btn-secondary"
                href={sectionHref(model, "tasks")}
              >
                See the work
              </a>
              <a
                className="btn btn-secondary"
                href={sectionHref(model, "evidence")}
              >
                Review evidence requests
              </a>
            </div>
          </div>
        </div>
      </section>
    );
  }
  return (
    <>
      <section className="card" aria-labelledby="readiness-title">
        <CardHeader
          title="Readiness"
          titleId="readiness-title"
          description="Everything the engagement needs before the agents start."
          aside={
            onboarding.ready ? (
              <span className="pill pill-dot tone-success">Ready to start</span>
            ) : undefined
          }
        />
        <ul className="readiness">
          {onboarding.readiness.map((item) => (
            <li
              key={item.step}
              className={item.complete ? "readiness-done" : ""}
            >
              <span className="setup-step-mark" aria-hidden="true">
                {item.complete ? <UiIcon name="check" size={13} /> : "!"}
              </span>
              <span className="row-text">
                <span>{item.title}</span>
                <small>{item.complete ? "Ready" : item.issues.join(" ")}</small>
              </span>
              {item.complete || item.step === "agents" ? null : (
                <a
                  className="btn btn-secondary btn-sm"
                  href={setupHref(model, item.step as SetupStep)}
                >
                  Fix
                </a>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="card" aria-labelledby="crew-title">
        <CardHeader
          title="Who does the work"
          titleId="crew-title"
          description="The standard workforce is already on this engagement."
        />
        <div className="crew">
          {onboarding.agents.map((agent) => (
            <span key={agent.agentKey} className="crew-member">
              <span className="agent-mark" aria-hidden="true">
                {agentMonogram(agent.name)}
              </span>
              <span className="row-text">
                <span>{agent.name}</span>
                <small>
                  {agent.active && agent.staffed
                    ? "On the team"
                    : "Unavailable"}
                </small>
              </span>
            </span>
          ))}
        </div>
      </section>
      {plan === null || plan.status !== "PROPOSED" ? (
        <section className="card setup-hero">
          <div className="setup-hero-body">
            <span className="agent-mark agent-mark-lg" aria-hidden="true">
              EP
            </span>
            <div>
              <h2>Ask the planner for a kickoff plan</h2>
              <p>
                The engagement planner turns the RCM into the work: a
                walkthrough, an evidence request, a test, and an independent
                review for every in-scope control, then the report. You review
                the plan before anything starts.
              </p>
            </div>
          </div>
          {editable ? (
            <div className="card-footer">
              <form method="post" action="/workspace/setup">
                <Identity
                  model={model}
                  onboarding={onboarding}
                  intent="propose"
                  step="start"
                />
                <button type="submit" disabled={!onboarding.ready}>
                  <UiIcon name="sparkles" size={15} /> Propose kickoff plan
                </button>
              </form>
              {onboarding.ready ? null : (
                <span className="form-hint">Finish the steps above first.</span>
              )}
            </div>
          ) : null}
        </section>
      ) : (
        <PlanReview
          model={model}
          onboarding={onboarding}
          plan={plan}
          editable={editable}
        />
      )}
    </>
  );
}

function PlanReview({
  model,
  onboarding,
  plan,
  editable,
}: {
  model: Ready;
  onboarding: Onboarding;
  plan: NonNullable<Onboarding["plan"]>;
  editable: boolean;
}) {
  const agentName = (key: string) =>
    onboarding.agents.find((agent) => agent.agentKey === key)?.name ?? key;
  const byKind = Object.entries(KIND_LABELS).map(([kind, label]) => ({
    kind,
    label,
    count: plan.items.filter((item) => item.kind === kind).length,
  }));
  const byControl = new Map<string, PlanItem[]>();
  for (const item of plan.items) {
    const key = item.controlRef ?? "Engagement";
    byControl.set(key, [...(byControl.get(key) ?? []), item]);
  }
  return (
    <section className="card" aria-labelledby="plan-title">
      <CardHeader
        title="Kickoff plan"
        titleId="plan-title"
        description="Proposed by the engagement planner from your RCM. Approving it starts the engagement."
        aside={<span className="pill pill-dot tone-info">Waiting for you</span>}
      />
      <ul className="stage-strip" aria-label="Plan summary">
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
      {editable ? (
        <div className="card-footer confirm-row">
          <p className="card-desc">
            Starting activates the engagement, assigns these tasks, and drafts{" "}
            {plan.items.filter((item) => item.kind === "evidence").length}{" "}
            evidence requests. Nothing is emailed until an approver confirms
            each request.
          </p>
          <span className="page-actions">
            <form method="post" action="/workspace/setup">
              <Identity
                model={model}
                onboarding={onboarding}
                intent="propose"
                step="start"
              />
              <button type="submit" className="btn-secondary">
                Propose again
              </button>
            </form>
            <form method="post" action="/workspace/setup">
              <Identity
                model={model}
                onboarding={onboarding}
                intent="approve"
                step="start"
              />
              <input type="hidden" name="plan_id" value={plan.id} />
              <input
                type="hidden"
                name="fingerprint"
                value={plan.fingerprint}
              />
              <button type="submit">
                <UiIcon name="arrow" size={15} /> Approve plan and start
              </button>
            </form>
          </span>
        </div>
      ) : null}
    </section>
  );
}

/** Shown on the command center until the engagement starts. */
export function SetupCallout({
  model,
  onboarding,
}: {
  model: Ready;
  onboarding: Onboarding;
}) {
  const progress = setupProgress(onboarding);
  const next =
    onboarding.readiness.find(
      (item) => !item.complete && item.step !== "agents",
    ) ?? null;
  const percent = Math.round(
    (progress.done / Math.max(progress.total, 1)) * 100,
  );
  return (
    <section
      className="card setup-callout"
      aria-labelledby="setup-callout-title"
    >
      <div className="setup-callout-body">
        <div>
          <p className="page-context">Engagement setup</p>
          <h2 id="setup-callout-title">
            {onboarding.ready
              ? "Ready to start. Review the kickoff plan."
              : `Finish setup to start the agents: ${progress.done} of ${progress.total} steps ready`}
          </h2>
          <p className="card-desc">
            {next === null
              ? "Every step is ready. The planner will propose the work for your approval."
              : `Next: ${next.title}. ${next.issues[0] ?? ""}`}
          </p>
          <div className="setup-meter" aria-hidden="true">
            <span style={{ width: `${percent}%` }} />
          </div>
        </div>
        <a
          className="btn"
          href={setupHref(
            model,
            next === null ? "start" : (next.step as SetupStep),
          )}
        >
          {onboarding.ready ? "Review and start" : "Continue setup"}{" "}
          <UiIcon name="arrow" size={15} />
        </a>
      </div>
    </section>
  );
}
