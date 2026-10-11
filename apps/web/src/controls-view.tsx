import {
  byApplication,
  byArea,
  CATEGORIES,
  type ControlRow,
  DEFICIENCY_STATUSES,
  type Deficiency,
  type DetailTab,
  detailTab,
  type EngagementState,
  filterControls,
  inQueue,
  type Queue,
  SEVERITIES,
  STAGES,
  type WaitingOn,
} from "./engagement-model";
import { formatDate } from "./format";
import type { ShellModel } from "./shell-model";
import { testFor } from "./testing-model";
import { TestPlanCard } from "./testing-view";
import { UiIcon } from "./ui-icon";
import { canRequestEvidence } from "./workflow-model";
import { EmptyState, StatusPill } from "./workspace-view";

type Ready = Extract<ShellModel, { status: "ready" }>;
type Keep = Record<string, string | null>;

const STAGE_LABEL: Record<string, string> = Object.fromEntries(STAGES);
const SEVERITY_LABEL: Record<string, string> = Object.fromEntries(SEVERITIES);
const FINDING_STATUS: Record<string, string> =
  Object.fromEntries(DEFICIENCY_STATUSES);
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES);
const SEVERITY_TONE: Record<string, string> = {
  CONTROL_DEFICIENCY: "tone-warning",
  SIGNIFICANT_DEFICIENCY: "tone-danger",
  MATERIAL_WEAKNESS: "tone-critical",
};
const STAGE_TONE: Record<string, string> = {
  NOT_PLANNED: "",
  PLANNED: "",
  EVIDENCE_REQUESTED: "tone-info",
  WALKTHROUGH: "tone-info",
  EVIDENCE_RECEIVED: "tone-info",
  TESTING: "tone-warning",
  IN_REVIEW: "tone-warning",
  CONCLUDED: "tone-success",
};
const WAITING: Record<WaitingOn, { label: string; tone: string }> = {
  TEAM: { label: "You", tone: "waiting-team" },
  OWNER: { label: "Owner", tone: "waiting-owner" },
  AGENT: { label: "Agent", tone: "waiting-agent" },
  NONE: { label: "", tone: "" },
};
const REQUEST_STATUS: Record<string, string> = {
  DRAFT: "Draft",
  APPROVAL_PENDING: "Awaiting approval",
  SENT: "Sent",
  WAITING_FOR_RESPONSE: "Waiting for owner",
  PARTIALLY_RECEIVED: "Partly received",
  RECEIVED: "Received",
  OVERDUE: "Overdue",
  ESCALATED: "Escalated",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};
const REQUEST_KIND = {
  EVIDENCE: "Evidence",
  SAMPLES: "Samples",
  FOLLOW_UP: "Follow-up",
};
const QUEUE_LABELS: Array<[Queue | null, string]> = [
  [null, "All"],
  ["team", "Needs your action"],
  ["owner", "Waiting on owners"],
  ["overdue", "Overdue"],
  ["findings", "With findings"],
  ["concluded", "Concluded"],
];
const LIFECYCLE: ReadonlyArray<
  [keyof ControlRow["stages"] | "conclusion", string]
> = [
  ["walkthrough", "Walkthrough"],
  ["evidence", "Evidence"],
  ["test", "Testing"],
  ["review", "Review"],
  ["conclusion", "Conclusion"],
];
const STEP_WORD = {
  done: "Done",
  active: "In progress",
  todo: "Not started",
  issue: "Needs attention",
};

function href(model: Ready, extra: Keep = {}, section = "controls") {
  const params = new URLSearchParams({
    organization: model.organization.id,
    section,
  });
  if (model.selectedProject !== null) {
    params.set("project", model.selectedProject.id);
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== null && value !== "") {
      params.set(key, value);
    }
  }
  return `/?${params.toString()}`;
}

function initials(name: string): string {
  const parts = name.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function frequencyText(control: ControlRow): string {
  return (
    control.frequencyLabel ||
    control.frequency.replaceAll("_", " ").toLowerCase()
  );
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
  // The queue counts follow the type and search, so each is what a click shows.
  const typed = filterControls(inScope, {
    ...filters,
    queue: null,
    stage: null,
  });
  const byApp = filters.group === "application";
  const groups = byApp ? byApplication(shown) : byArea(shown);
  const categories = CATEGORIES.filter(([key]) =>
    inScope.some((control) => control.category === key),
  );
  const concluded = inScope.filter(
    (control) => control.conclusion !== "NOT_CONCLUDED",
  ).length;
  return (
    <div className="page register-page">
      <header className="register-head">
        <div>
          <p className="page-context">{project?.name}</p>
          <h1>Controls</h1>
        </div>
        <div className="register-progress">
          <span>
            <strong>{concluded}</strong> of {inScope.length} concluded
          </span>
          <span className="progress-track" aria-hidden="true">
            <span
              style={{
                width: `${inScope.length === 0 ? 0 : (concluded / inScope.length) * 100}%`,
              }}
            />
          </span>
        </div>
        <a
          className="btn btn-secondary"
          href={href(model, { step: "rcm" }, "setup")}
        >
          Edit the RCM
        </a>
      </header>
      <section className="card grid-card">
        <nav className="view-tabs" aria-label="Work queues">
          {QUEUE_LABELS.map(([queue, label]) => {
            const count = typed.filter((control) =>
              inQueue(control, queue),
            ).length;
            return (
              <a
                key={label}
                href={href(model, { ...keep, queue })}
                aria-current={filters.queue === queue ? "page" : undefined}
                className={
                  queue === "overdue" && count > 0 ? "is-alert" : undefined
                }
              >
                {label}
                <span className="view-count">{count}</span>
              </a>
            );
          })}
        </nav>
        <div className="grid-toolbar">
          <form method="get" action="/" className="grid-search">
            <input
              type="hidden"
              name="organization"
              value={model.organization.id}
            />
            <input type="hidden" name="project" value={project?.id ?? ""} />
            <input type="hidden" name="section" value="controls" />
            {filters.category !== null ? (
              <input type="hidden" name="category" value={filters.category} />
            ) : null}
            {filters.queue !== null ? (
              <input type="hidden" name="queue" value={filters.queue} />
            ) : null}
            {byApp ? (
              <input type="hidden" name="group" value="application" />
            ) : null}
            <label className="sr-only" htmlFor="controls-search">
              Search controls
            </label>
            <input
              id="controls-search"
              name="q"
              type="search"
              defaultValue={filters.query}
              placeholder="Search ID, control, owner, or system"
            />
          </form>
          {categories.length > 1 ? (
            <nav className="segmented" aria-label="Control type">
              <a
                href={href(model, { ...keep, category: null })}
                aria-current={filters.category === null ? "page" : undefined}
              >
                All types
              </a>
              {categories.map(([key, label]) => (
                <a
                  key={key}
                  href={href(model, { ...keep, category: key })}
                  aria-current={filters.category === key ? "page" : undefined}
                >
                  {label}
                </a>
              ))}
            </nav>
          ) : null}
          <nav className="segmented" aria-label="Group by">
            <a
              href={href(model, { ...keep, group: null })}
              aria-current={!byApp ? "page" : undefined}
            >
              By area
            </a>
            <a
              href={href(model, { ...keep, group: "application" })}
              aria-current={byApp ? "page" : undefined}
            >
              By application
            </a>
          </nav>
          <span className="grid-count">
            {shown.length} of {inScope.length}
          </span>
        </div>
        {shown.length === 0 ? (
          <EmptyState
            icon="shield"
            title={
              filters.queue === "team"
                ? "Nothing needs you right now"
                : "No controls match"
            }
            detail={
              filters.queue === "team"
                ? "Controls appear here when an approval, a review, or a request is yours to do."
                : "Clear the search or choose another view."
            }
          />
        ) : (
          <div className="grid-scroll">
            <table className="table data-grid is-fixed register-grid">
              <thead>
                <tr>
                  <th scope="col" className="col-id">
                    ID
                  </th>
                  <th scope="col">Control</th>
                  <th scope="col" className="col-freq">
                    Frequency
                  </th>
                  <th scope="col" className="col-owner">
                    Owner
                  </th>
                  <th scope="col" className="col-status">
                    Status
                  </th>
                  <th scope="col" className="col-next">
                    Next step
                  </th>
                  <th scope="col" className="col-num">
                    Evid.
                  </th>
                  <th scope="col" className="col-num">
                    Find.
                  </th>
                </tr>
              </thead>
              {groups.map((group) => {
                const yours = group.controls.filter(
                  (control) => control.waitingOn === "TEAM",
                ).length;
                return (
                  <tbody key={group.area}>
                    <tr className="group-row">
                      <th scope="colgroup" colSpan={8}>
                        <span>{group.area}</span>
                        <small>
                          {group.controls.length} control
                          {group.controls.length === 1 ? "" : "s"}
                          {yours > 0 ? ` · ${yours} need you` : ""}
                        </small>
                      </th>
                    </tr>
                    {group.controls.map((control) => (
                      <GridRow
                        key={`${group.area}-${control.id}`}
                        model={model}
                        control={control}
                        keep={keep}
                        byApp={byApp}
                      />
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function GridRow({
  model,
  control,
  keep,
  byApp,
}: {
  model: Ready;
  control: ControlRow;
  keep: Keep;
  byApp: boolean;
}) {
  const waiting = WAITING[control.waitingOn];
  const link = href(model, { ...keep, control: control.id });
  return (
    <tr className={control.overdue ? "is-overdue" : undefined}>
      <td className="col-id">
        <a className="id-link" href={link}>
          {control.controlRef}
        </a>
      </td>
      <td className="cell-title">
        <a href={link} title={control.title}>
          {control.title}
        </a>
        {control.keyControl ? null : <span className="key-tag">Non-key</span>}
        {byApp ? <span className="cell-muted"> · {control.area}</span> : null}
      </td>
      <td className="col-freq">
        {frequencyText(control)}
        <span className="cell-muted"> · {control.sampleSize}</span>
      </td>
      <td className="col-owner">
        {control.ownerName || control.ownerEmail ? (
          <span className="owner" title={control.ownerEmail}>
            <span className="avatar" aria-hidden="true">
              {initials(control.ownerName || control.ownerEmail)}
            </span>
            <span className="owner-name">
              {control.ownerName || control.ownerEmail}
            </span>
          </span>
        ) : (
          <span className="cell-muted">PBC coordinator</span>
        )}
      </td>
      <td className="col-status">
        <span className={`pill pill-dot ${STAGE_TONE[control.stage] ?? ""}`}>
          {STAGE_LABEL[control.stage] ?? control.stage}
        </span>
      </td>
      <td
        className={`col-next${control.overdue ? " is-late" : ""}`}
        title={control.nextStep}
      >
        {waiting.label !== "" ? (
          <span className={`waiting ${waiting.tone}`}>{waiting.label}</span>
        ) : null}
        {control.nextStep}
      </td>
      <td className="col-num">
        {control.evidenceRequests === 0
          ? "—"
          : `${control.evidenceReceived}/${control.evidenceRequests}`}
      </td>
      <td className="col-num">
        {control.deficiencies > 0 && control.worstSeverity !== null ? (
          <span className={`pill ${SEVERITY_TONE[control.worstSeverity]}`}>
            {control.deficiencies}
          </span>
        ) : (
          <span className="cell-muted">—</span>
        )}
      </td>
    </tr>
  );
}

// The control record

/** The one place a person goes to act on the next step. */
function primaryAction(
  model: Ready,
  control: ControlRow,
  keep: Keep,
): { label: string; href: string } | null {
  if (control.waitingOn !== "TEAM") {
    return null;
  }
  if (control.testStatus === "PROPOSED") {
    return {
      label: "Review samples",
      href: href(model, { ...keep, control: control.id, tab: "testing" }),
    };
  }
  return { label: "Open in Evidence", href: href(model, {}, "evidence") };
}

function stepState(
  control: ControlRow,
  step: string,
): "done" | "active" | "todo" | "issue" {
  if (step === "conclusion") {
    return control.conclusion === "EFFECTIVE"
      ? "done"
      : control.conclusion === "EXCEPTION"
        ? "issue"
        : "todo";
  }
  const value = control.stages[step as keyof ControlRow["stages"]];
  if (value === "SUCCEEDED" || value === "RECEIVED") {
    return "done";
  }
  if (value === "FAILED" || value === "OVERDUE" || value === "BLOCKED") {
    return "issue";
  }
  if (
    [
      "RUNNING",
      "QUEUED",
      "WAITING",
      "REVIEW",
      "REQUESTED",
      "PARTIAL",
      "DRAFTED",
    ].includes(value)
  ) {
    return "active";
  }
  return "todo";
}

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
  const index = siblings.findIndex((item) => item.id === control.id);
  const previous = index > 0 ? siblings[index - 1] : undefined;
  const next =
    index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : undefined;
  const action = primaryAction(model, control, keep);
  const waiting = WAITING[control.waitingOn];
  const tabs: Array<[DetailTab, string, number | null]> = [
    ["overview", "Overview", null],
    ["evidence", "Evidence", control.requests.length],
    ["testing", "Testing", test === null ? null : test.samples.length],
    ["findings", "Findings", findings.length],
    ["work", "Work", tasks.length],
  ];
  return (
    <div className="page record-page">
      <div className="record-nav">
        <a className="back-link" href={href(model, keep)}>
          <span aria-hidden="true">←</span> Controls
        </a>
        {index >= 0 ? (
          <span className="pager">
            <span>
              {index + 1} of {siblings.length}
            </span>
            {previous !== undefined ? (
              <a
                className="pager-button"
                href={href(model, { ...keep, control: previous.id })}
                aria-label={`Previous control, ${previous.controlRef}`}
              >
                ‹
              </a>
            ) : (
              <span className="pager-button is-disabled" aria-hidden="true">
                ‹
              </span>
            )}
            {next !== undefined ? (
              <a
                className="pager-button"
                href={href(model, { ...keep, control: next.id })}
                aria-label={`Next control, ${next.controlRef}`}
              >
                ›
              </a>
            ) : (
              <span className="pager-button is-disabled" aria-hidden="true">
                ›
              </span>
            )}
          </span>
        ) : null}
      </div>
      <header className="card record-head">
        <div className="record-title">
          <p className="record-ref">
            <span className="mono">{control.controlRef}</span>
            <span className="key-tag">
              {control.keyControl ? "Key" : "Non-key"}
            </span>
            <span
              className={`pill pill-dot ${STAGE_TONE[control.stage] ?? ""}`}
            >
              {STAGE_LABEL[control.stage] ?? control.stage}
            </span>
            {control.conclusion === "EFFECTIVE" ? (
              <span className="pill tone-success">Effective</span>
            ) : control.conclusion === "EXCEPTION" ? (
              <span className="pill tone-danger">Exception</span>
            ) : null}
          </p>
          <h1>{control.title}</h1>
          <p className="record-meta">
            {control.area} · {frequencyText(control)} · {natureText(control)} ·{" "}
            {control.sampleSize} sample{control.sampleSize === 1 ? "" : "s"}
            {" · "}
            {control.ownerName || "PBC coordinator"}
          </p>
        </div>
        <div className="record-actions">
          {action !== null ? (
            <a className="btn" href={action.href}>
              {action.label}
            </a>
          ) : null}
          <a
            className="btn btn-secondary"
            href={href(model, { new: control.id }, "deficiencies")}
          >
            Log deficiency
          </a>
        </div>
        <div className="record-strip">
          <div className={`record-next${control.overdue ? " is-late" : ""}`}>
            <span className="next-label">Next step</span>
            {waiting.label !== "" ? (
              <span className={`waiting ${waiting.tone}`}>{waiting.label}</span>
            ) : null}
            <strong>{control.nextStep}</strong>
          </div>
          <ol className="stepper" aria-label="Lifecycle">
            {LIFECYCLE.map(([step, label]) => {
              const state = stepState(control, step);
              return (
                <li key={step} className={`step-${state}`}>
                  <span className="step-dot" aria-hidden="true">
                    {state === "done" ? (
                      <UiIcon name="check" size={11} />
                    ) : null}
                  </span>
                  <span className="step-label">{label}</span>
                  <span className="sr-only">: {STEP_WORD[state]}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </header>
      <div className="record-body">
        <section className="card record-main">
          <nav className="record-tabs" aria-label="Control record">
            {tabs.map(([key, label, count]) => (
              <a
                key={key}
                href={href(model, { ...keep, control: control.id, tab: key })}
                aria-current={tab === key ? "page" : undefined}
              >
                {label}
                {count !== null && count > 0 ? (
                  <span className="view-count">{count}</span>
                ) : null}
              </a>
            ))}
          </nav>
          <div className="record-tab">
            {tab === "overview" ? <OverviewTab control={control} /> : null}
            {tab === "evidence" ? (
              <EvidenceTab model={model} control={control} />
            ) : null}
            {tab === "testing" ? (
              <TestPlanCard
                test={test}
                notice={engagement.testNotice}
                organizationId={model.organization.id}
                projectId={model.selectedProject?.id ?? ""}
                controlId={control.id}
                canAct={canRequestEvidence(model.organization.role)}
                sampled={control.nature !== "AUTOMATED"}
              />
            ) : null}
            {tab === "findings" ? (
              <FindingsTab
                model={model}
                control={control}
                findings={findings}
              />
            ) : null}
            {tab === "work" ? <WorkTab model={model} tasks={tasks} /> : null}
          </div>
        </section>
        <aside className="record-rail" aria-label="Control details">
          <section className="card rail-card">
            <h2>Details</h2>
            <dl className="rail-facts">
              <div>
                <dt>Type</dt>
                <dd>{CATEGORY_LABEL[control.category] ?? control.category}</dd>
              </div>
              <div>
                <dt>Area</dt>
                <dd>{control.area}</dd>
              </div>
              <div>
                <dt>Frequency</dt>
                <dd>{frequencyText(control)}</dd>
              </div>
              <div>
                <dt>Nature</dt>
                <dd>{natureText(control)}</dd>
              </div>
              <div>
                <dt>Sample size</dt>
                <dd>{control.sampleSize}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>
                  {control.ownerName || "PBC coordinator"}
                  {control.ownerEmail ? (
                    <small>{control.ownerEmail}</small>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>Applications</dt>
                <dd className="chips">
                  {control.systems.length === 0
                    ? "None"
                    : control.systems.map((system) => (
                        <span key={system} className="chip">
                          {system}
                        </span>
                      ))}
                </dd>
              </div>
            </dl>
          </section>
          <section className="card rail-card">
            <h2>Status</h2>
            <dl className="rail-facts">
              <div>
                <dt>Evidence</dt>
                <dd>
                  {control.evidenceReceived} of {control.evidenceRequests}{" "}
                  received
                </dd>
              </div>
              <div>
                <dt>Samples</dt>
                <dd>
                  {test === null
                    ? control.nature === "AUTOMATED"
                      ? "Test of one"
                      : "Not selected"
                    : test.status === "APPROVED"
                      ? `${test.samples.length} approved`
                      : `${test.samples.length} proposed`}
                </dd>
              </div>
              <div>
                <dt>Findings</dt>
                <dd>
                  {findings.length === 0 ? "None" : `${findings.length} open`}
                </dd>
              </div>
              <div>
                <dt>Conclusion</dt>
                <dd>
                  {control.conclusion === "EFFECTIVE"
                    ? "Effective"
                    : control.conclusion === "EXCEPTION"
                      ? "Exception"
                      : "Not concluded"}
                </dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

function OverviewTab({ control }: { control: ControlRow }) {
  return (
    <div className="overview">
      <section>
        <h3>Control activity</h3>
        <p>{control.activity}</p>
      </section>
      {control.risk !== "" ? (
        <section>
          <h3>Risk addressed</h3>
          <p>{control.risk}</p>
        </section>
      ) : null}
      {control.testAttributes.length > 0 ? (
        <section>
          <h3>Test attributes</h3>
          <table className="table data-grid attribute-grid">
            <tbody>
              {control.testAttributes.map((attribute, index) => (
                <tr key={attribute}>
                  <td className="col-id">{String.fromCharCode(65 + index)}</td>
                  <td>{attribute}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {control.pbcItems.length > 0 ? (
        <section>
          <h3>Evidence needed</h3>
          <ul className="attribute-list bullets">
            {control.pbcItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function EvidenceTab({
  model,
  control,
}: {
  model: Ready;
  control: ControlRow;
}) {
  if (control.requests.length === 0) {
    return (
      <p className="form-hint">
        No evidence requests yet. The evidence coordinator drafts them at
        kickoff.
      </p>
    );
  }
  return (
    <div className="stack">
      <table className="table data-grid">
        <thead>
          <tr>
            <th scope="col" className="col-kind">
              Type
            </th>
            <th scope="col">Request</th>
            <th scope="col" className="col-date">
              Due
            </th>
            <th scope="col" className="col-status">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {control.requests.map((request) => (
            <tr key={request.id}>
              <td className="col-kind cell-muted">
                {REQUEST_KIND[request.kind]}
              </td>
              <td className="cell-title" title={request.title}>
                {request.title}
              </td>
              <td className="col-date cell-muted">
                {formatDate(request.dueAt)}
              </td>
              <td className="col-status">
                <span
                  className={`pill pill-dot ${
                    request.status === "RECEIVED" || request.status === "CLOSED"
                      ? "tone-success"
                      : request.status === "OVERDUE" ||
                          request.status === "ESCALATED"
                        ? "tone-danger"
                        : request.status === "DRAFT"
                          ? ""
                          : "tone-info"
                  }`}
                >
                  {REQUEST_STATUS[request.status] ?? request.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <a className="text-link" href={href(model, {}, "evidence")}>
        Approve, send, and review replies on the Evidence page
      </a>
    </div>
  );
}

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

function WorkTab({
  model,
  tasks,
}: {
  model: Ready;
  tasks: NonNullable<EngagementState["plan"]>["tasks"];
}) {
  if (tasks.length === 0) {
    return <p className="form-hint">No tasks on this control yet.</p>;
  }
  return (
    <table className="table data-grid">
      <thead>
        <tr>
          <th scope="col">Task</th>
          <th scope="col" className="col-owner">
            Assigned to
          </th>
          <th scope="col" className="col-date">
            Due
          </th>
          <th scope="col" className="col-status">
            Status
          </th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          <tr key={task.id}>
            <td className="cell-title">
              <a href={href(model, { task: task.id }, "tasks")}>{task.title}</a>
            </td>
            <td className="cell-muted">
              {task.agent ?? task.assignee ?? "Unassigned"}
            </td>
            <td className="cell-muted">
              {task.deadline ? formatDate(task.deadline) : "—"}
            </td>
            <td>
              <StatusPill status={task.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
